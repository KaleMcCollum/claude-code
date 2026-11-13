import { type SQL, and, asc, count, desc, eq, exists, inArray, isNull, max, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { type Queryable, type Tx, asUser, sqlState } from "@/db/client";
import {
  approvals,
  comments,
  endorsements,
  notes,
  officialVersions,
  proposalNotes,
  proposals,
  roles,
  sections,
  users,
} from "@/db/schema";
import { logActivity } from "./activity";
import { type BusinessTag, parseBusinessTag } from "./business";
import { type CommentView, businessFilterTags } from "./notes";
import { DIRECT_EDIT_TITLE, addVersion, approvalLine, joinNames, latestVersionRow, lockSection } from "./official";
import { type Actor, AppError, assertCan, can } from "./permissions";
import { type RichDoc, docToText, isEmptyDoc, sameDoc, sanitizeDoc } from "./richtext";
import {
  MAX_DEPTH,
  type SectionNode,
  archiveSectionIn,
  checkSectionTitle,
  createSectionIn,
  findNode,
  isUuid,
  loadTree,
  moveProblem,
  moveProblemKind,
  moveSectionToIn,
  renameSectionIn,
} from "./sections";
import { centralDay } from "./sqltime";
import { addDays, centralDateKey, formatDate } from "./time";

/**
 * Proposals and approvals.
 *
 * A proposal is a change waiting for (or holding) approval:
 *  - a text proposal ("decision" or "official_text") carries the complete
 *    new Official text of one section;
 *  - a structure proposal carries one change to the section tree.
 *
 * Rules, all enforced here and again by the database:
 *  - Proposing counts as approving: the proposer's approval is recorded
 *    with the proposal.
 *  - "Approve" records an Owner's approval. With two Owners' approvals the
 *    proposal is approved and its change is applied, in one step.
 *  - "Approve on my own" makes it official with a single approval. Such
 *    one-person decisions are flagged on Today for the other Owner, who can
 *    add "I approve too" at any time. Whether a decision was made by one
 *    person is worked out by the database at the moment of deciding
 *    (`decidedAlone`), from the people who can approve at that moment.
 *  - An approval or endorsement is tied to the wording it was given on: it
 *    carries the proposal's revision number, and the database refuses it if
 *    the proposal has been changed since.
 *  - A text proposal is also tied to the official text it was written
 *    against (`baseVersionId`). When that text changes while the proposal
 *    waits, the proposal is out of date: the proposer's approval was never
 *    given on top of the newer text, so two people cannot approve it until
 *    the proposer has checked it against the new text and saved it again
 *    (`editProposal` with the version their page showed). One person can
 *    still approve it alone, which is flagged like any one-person decision.
 *  - Only the proposer can change or withdraw a proposal, and can change it
 *    only until someone else has approved or endorsed it. Another Owner
 *    declines it instead.
 *  - A decided proposal never changes again.
 */

export type ProposalType = "decision" | "structure" | "official_text";
export type ProposalStatus = "open" | "approved" | "declined" | "withdrawn";

/** The owner's own words for the three kinds (spec section 10). */
export const PROPOSAL_TYPE_LABELS: Record<ProposalType, string> = {
  decision: "Decision",
  structure: "Structure",
  official_text: "Official text",
};

/** One change to the section tree. The section it is about is the proposal's `sectionId`. */
export type StructureChange =
  | { action: "add"; title: string }
  | { action: "rename"; title: string; fromTitle: string }
  | { action: "move"; parentId: string | null }
  | { action: "archive" };

export type PersonStamp = { userId: string; name: string; at: Date };

export type ProposalView = {
  id: string;
  type: ProposalType;
  title: string;
  description: RichDoc | null;
  /** The section it is about. For "add a section": the parent (null = top level). */
  sectionId: string | null;
  /**
   * That section's name as it is stored right now, whether the section is
   * archived or not (null when there is no section). Lists use it to name a
   * section that is no longer among the sections: "Hiring (archived)".
   */
  sectionTitle: string | null;
  /**
   * "Move a section" proposals: the stored name of the section it would go
   * under, archived or not. Null for a move to the top level and for every
   * other kind of proposal.
   */
  destinationTitle: string | null;
  businessTag: BusinessTag | null;
  proposedOfficial: RichDoc | null;
  /** The official version the text was written against (null if there was none). */
  baseVersionId: string | null;
  structureChange: StructureChange | null;
  /** For an approved "add a section": the section that was created. */
  createdSectionId: string | null;
  /**
   * Approved structure proposals: the sentence saying what the change would
   * do, as it read at the moment of approval (what the approver was shown).
   * Null for everything else, and for section changes approved before this
   * was recorded.
   */
  decidedTitle: string | null;
  /** True for "Edit official" saves and restores. */
  direct: boolean;
  proposedById: string | null;
  proposedByName: string | null;
  revision: number;
  status: ProposalStatus;
  createdAt: Date;
  decidedAt: Date | null;
  decidedById: string | null;
  decidedByName: string | null;
  declineReason: string | null;
  approvals: PersonStamp[];
  endorsements: PersonStamp[];
  /** The official version this proposal produced, once approved (text proposals). */
  resultVersion: { id: string; version: number } | null;
  /**
   * Approved by one person: at the moment it was approved, fewer than two
   * people who could approve had approved it. Recorded by the database.
   */
  decidedAlone: boolean;
  /**
   * A one-person decision nobody else has approved since: approved, decided
   * alone, and no one who can approve right now, other than the person who
   * decided it, has an approval on it.
   */
  soloOpen: boolean;
  /**
   * An approved text change that is no longer the current text: its section
   * has a newer official version. ("No longer the current text.")
   */
  superseded: boolean;
  /**
   * An open text proposal whose section's official text has changed since
   * it was proposed (or last checked by its proposer): `baseVersionId` is
   * not the section's current official version. False for structure
   * proposals and for anything that is not open.
   */
  outOfDate: boolean;
  /**
   * Open proposals: its proposer could still change it (and so could still
   * check it against new official text). They have not been removed, are
   * still allowed to propose, and nobody else has approved or endorsed it.
   * False for anything that is not open.
   */
  proposerCanChange: boolean;
};

/** What an open proposal is waiting for, and for whom. See `waitingOn`. */
export type Waiting = {
  /**
   * approve: waiting for approvals.
   * check: waiting for the proposer to check it against new official text.
   * stuck: out of date and its proposer can no longer change it.
   */
  step: "approve" | "check" | "stuck";
  /**
   * The people it is waiting for.
   *  - approve: the people who can approve now and have not. When two of
   *    them have already approved (it only needs one more press of Approve
   *    to become official): everyone who can approve now.
   *  - check: the proposer.
   *  - stuck: everyone who can approve now (any of them can decline it, or
   *    withdraw it if it is their own).
   */
  ids: string[];
  /** Their names, in the same order. */
  names: string[];
  /**
   * Step "approve": how many more approvals are needed (0, 1 or 2). With a
   * single Owner one approval is all there can be, so it is never more than
   * the number of people who can approve. 0 for the other two steps.
   */
  needed: number;
};

/** What the person had on screen when they pressed a button. */
export type Seen = {
  /** The proposal's revision number shown on the page. */
  revision: number;
  /**
   * Text proposals: the section's current official version the page compared
   * against (null if there was none). Leave out only where no page is involved.
   */
  currentVersionId?: string | null;
};

export type TextProposalInput = {
  kind: "decision" | "official_text";
  sectionId: string;
  title: string;
  description?: unknown;
  businessTag?: unknown;
  proposedOfficial: unknown;
  /**
   * A new proposal: the official version the form started from (null when
   * the section had no official text). When given, it must still be the
   * section's current version, or the proposal is refused: the person would
   * be proposing to replace text they have not seen. Leave it out only where
   * no page is involved; the current version is used then. Not used when a
   * proposal is edited (see `editProposal`).
   */
  baseVersionId?: string | null;
  /** Notes this proposal came from. */
  noteIds?: string[];
};

export type StructureProposalInput = {
  kind: "structure";
  change:
    | { action: "add"; parentId: string | null; title: string }
    | { action: "rename"; sectionId: string; title: string }
    | { action: "move"; sectionId: string; parentId: string | null }
    | { action: "archive"; sectionId: string };
  description?: unknown;
  noteIds?: string[];
};

export type ProposalInput = TextProposalInput | StructureProposalInput;

/** How long a one-person decision stays flagged on Today. */
export const SOLO_FLAG_DAYS = 14;
const MAX_TITLE_LENGTH = 160;
const MAX_REASON_LENGTH = 500;

const NOT_FOUND = "That proposal could not be found. Reload the page and try again.";
const SECTION_GONE =
  "The section this is about no longer exists (it may have been archived). Withdraw or decline this proposal.";
const UNREADABLE_CHANGE =
  "This proposal's change could not be read, so nothing was changed. Decline it and make a new one.";

const proposer = alias(users, "proposer");
const proposerRole = alias(roles, "proposer_role");
const decider = alias(users, "decider");
/** The section a proposal is about, and the one a "move" would put it under: read whether archived or not. */
const aboutSection = alias(sections, "about_section");
const destinationSection = alias(sections, "destination_section");
/**
 * Joins the section a "move" proposal would put its section under. The id
 * sits inside the stored change, so it is compared as text: a stored change
 * that holds something else there simply finds no section.
 */
const isDestinationOfMove = sql`${destinationSection.id}::text = ${proposals.structureChange} ->> 'parentId'`;

type ProposalRow = typeof proposals.$inferSelect;

// ---------------------------------------------------------------- reading

function selectProposals(q: Queryable) {
  return q
    .select({
      row: proposals,
      proposedByName: proposer.name,
      proposerRemovedAt: proposer.removedAt,
      proposerPermissions: proposerRole.permissions,
      decidedByName: decider.name,
      sectionTitle: aboutSection.title,
      destinationTitle: destinationSection.title,
    })
    .from(proposals)
    .leftJoin(proposer, eq(proposer.id, proposals.proposedBy))
    .leftJoin(proposerRole, eq(proposerRole.key, proposer.roleKey))
    .leftJoin(decider, eq(decider.id, proposals.decidedBy))
    .leftJoin(aboutSection, eq(aboutSection.id, proposals.sectionId))
    .leftJoin(destinationSection, isDestinationOfMove);
}

type Joined = {
  row: ProposalRow;
  proposedByName: string | null;
  proposerRemovedAt: Date | null;
  proposerPermissions: string[] | null;
  decidedByName: string | null;
  sectionTitle: string | null;
  destinationTitle: string | null;
};

/** The id of each of these sections' current official version (sections with no official text are left out). */
async function currentVersionIds(q: Queryable, sectionIds: string[]): Promise<Map<string, string>> {
  const current = new Map<string, string>();
  if (sectionIds.length === 0) return current;
  const rows = await q
    .selectDistinctOn([officialVersions.sectionId], { sectionId: officialVersions.sectionId, id: officialVersions.id })
    .from(officialVersions)
    .where(inArray(officialVersions.sectionId, sectionIds))
    .orderBy(officialVersions.sectionId, desc(officialVersions.version));
  for (const { sectionId, id } of rows) current.set(sectionId, id);
  return current;
}

async function toViews(q: Queryable, joined: Joined[]): Promise<ProposalView[]> {
  if (joined.length === 0) return [];
  const ids = joined.map((j) => j.row.id);
  const stamps = async (table: typeof approvals | typeof endorsements) =>
    q
      .select({ proposalId: table.proposalId, userId: table.userId, name: users.name, at: table.createdAt })
      .from(table)
      .innerJoin(users, eq(users.id, table.userId))
      .where(inArray(table.proposalId, ids))
      .orderBy(asc(table.createdAt), asc(table.id));
  const approvalRows = await stamps(approvals);
  const endorsementRows = await stamps(endorsements);
  const versionRows = await q
    .select({
      id: officialVersions.id,
      version: officialVersions.version,
      proposalId: officialVersions.proposalId,
      sectionId: officialVersions.sectionId,
    })
    .from(officialVersions)
    .where(inArray(officialVersions.proposalId, ids));
  // The newest version number of each section these versions belong to.
  const versionSections = [...new Set(versionRows.map((v) => v.sectionId))];
  const newest = new Map<string, number>();
  if (versionSections.length > 0) {
    const rows = await q
      .select({ sectionId: officialVersions.sectionId, version: max(officialVersions.version) })
      .from(officialVersions)
      .where(inArray(officialVersions.sectionId, versionSections))
      .groupBy(officialVersions.sectionId);
    for (const { sectionId, version } of rows) newest.set(sectionId, version ?? 0);
  }
  // Who can approve right now (only needed to say whether a one-person decision is still open).
  const approverIds = joined.some((j) => j.row.status === "approved" && j.row.decidedAlone)
    ? new Set((await activeApprovers(q)).map((owner) => owner.id))
    : new Set<string>();
  // The current official version of each section an open text proposal is
  // about, to say whether that proposal is out of date.
  const openTextSections = [
    ...new Set(
      joined
        .filter((j) => j.row.status === "open" && j.row.type !== "structure" && j.row.sectionId)
        .map((j) => j.row.sectionId as string),
    ),
  ];
  const current = await currentVersionIds(q, openTextSections);

  return joined.map(({ row, proposedByName, proposerRemovedAt, proposerPermissions, decidedByName, ...names }) => {
    const version = versionRows.find((v) => v.proposalId === row.id);
    const pick = (list: (PersonStamp & { proposalId: string })[]) =>
      list.filter((s) => s.proposalId === row.id).map(({ userId, name, at }) => ({ userId, name, at }));
    const approvedBy = pick(approvalRows);
    const endorsedBy = pick(endorsementRows);
    return {
      id: row.id,
      type: row.type,
      title: row.title,
      description: (row.description as RichDoc | null) ?? null,
      sectionId: row.sectionId,
      sectionTitle: names.sectionTitle,
      // (Only a move has a destination; a stored "add" or "rename" has no such field.)
      destinationTitle: names.destinationTitle,
      businessTag: row.businessTag,
      proposedOfficial: (row.proposedOfficial as RichDoc | null) ?? null,
      baseVersionId: row.baseVersionId,
      structureChange: (row.structureChange as StructureChange | null) ?? null,
      createdSectionId: row.createdSectionId,
      decidedTitle: row.decidedTitle,
      direct: row.direct,
      proposedById: row.proposedBy,
      proposedByName,
      revision: row.revision,
      status: row.status,
      createdAt: row.createdAt,
      decidedAt: row.decidedAt,
      decidedById: row.decidedBy,
      decidedByName,
      declineReason: row.declineReason,
      approvals: approvedBy,
      endorsements: endorsedBy,
      resultVersion: version ? { id: version.id, version: version.version } : null,
      decidedAlone: row.decidedAlone,
      soloOpen:
        row.status === "approved" &&
        row.decidedAlone &&
        !approvedBy.some((a) => a.userId !== row.decidedBy && approverIds.has(a.userId)),
      superseded:
        row.status === "approved" && version !== undefined && (newest.get(version.sectionId) ?? 0) > version.version,
      outOfDate:
        row.status === "open" &&
        row.type !== "structure" &&
        row.sectionId !== null &&
        (current.get(row.sectionId) ?? null) !== row.baseVersionId,
      proposerCanChange:
        row.status === "open" &&
        row.proposedBy !== null &&
        proposerRemovedAt === null &&
        (proposerPermissions ?? []).includes("propose") &&
        !approvedBy.some((a) => a.userId !== row.proposedBy) &&
        !endorsedBy.some((e) => e.userId !== row.proposedBy),
    };
  });
}

export async function loadProposal(q: Queryable, id: string): Promise<ProposalView | null> {
  if (!isUuid(id)) return null;
  const rows = await selectProposals(q).where(eq(proposals.id, id));
  return (await toViews(q, rows))[0] ?? null;
}

/** Proposals waiting for approval, oldest first (the one waiting longest on top). */
export async function listOpenProposals(q: Queryable): Promise<ProposalView[]> {
  const rows = await selectProposals(q)
    .where(eq(proposals.status, "open"))
    .orderBy(asc(proposals.createdAt), asc(proposals.id));
  return toViews(q, rows);
}

/** Open proposals about one section (shown as a notice on the section page). */
export async function listOpenProposalsForSection(q: Queryable, sectionId: string): Promise<ProposalView[]> {
  const rows = await selectProposals(q)
    .where(and(eq(proposals.status, "open"), eq(proposals.sectionId, sectionId)))
    .orderBy(asc(proposals.createdAt), asc(proposals.id));
  return toViews(q, rows);
}

/** Declined and withdrawn proposals, newest first. */
export async function listClosedProposals(q: Queryable, limit = 30): Promise<ProposalView[]> {
  const rows = await selectProposals(q)
    .where(inArray(proposals.status, ["declined", "withdrawn"]))
    .orderBy(desc(proposals.decidedAt), desc(proposals.id))
    .limit(limit);
  return toViews(q, rows);
}

/** People who can approve right now: not removed, with a role that includes "approve". */
export async function activeApprovers(q: Queryable): Promise<{ id: string; name: string }[]> {
  const rows = await q
    .select({ id: users.id, name: users.name, permissions: roles.permissions, createdAt: users.createdAt })
    .from(users)
    .innerJoin(roles, eq(roles.key, users.roleKey))
    .where(isNull(users.removedAt))
    .orderBy(asc(users.createdAt), asc(users.name));
  return rows.filter((r) => r.permissions.includes("approve")).map(({ id, name }) => ({ id, name }));
}

/**
 * The number shown after "Proposals" in the sidebar: for someone who can
 * approve, the open proposals that are waiting for them (`waitingOn`); for
 * anyone else, all open proposals.
 */
export async function countAwaiting(q: Queryable, actor: Actor): Promise<number> {
  if (!can(actor, "approve")) {
    const [{ n }] = await q.select({ n: count() }).from(proposals).where(eq(proposals.status, "open"));
    return n;
  }
  const open = await listOpenProposals(q);
  if (open.length === 0) return 0;
  const approvers = await activeApprovers(q);
  return open.filter((view) => waitingOn(view, approvers)?.ids.includes(actor.id)).length;
}

export type DecisionFilters = {
  /** A section; its subsections are included. */
  sectionId?: string | null;
  business?: BusinessTag | null;
  approverId?: string | null;
  /** First and last day to include, as "YYYY-MM-DD" in US Central time. */
  from?: string | null;
  to?: string | null;
};

/**
 * A section and everything under it, read from the stored sections, so
 * archived sections and sections under an archived one are included. Empty
 * when there is no such section.
 */
async function sectionAndBelow(q: Queryable, sectionId: string): Promise<string[]> {
  if (!isUuid(sectionId)) return [];
  const rows = await q.select({ id: sections.id, parentId: sections.parentId }).from(sections);
  if (!rows.some((row) => row.id === sectionId)) return [];
  const found = [sectionId];
  // (A section is found once, so this ends even if two sections named each other as parent.)
  for (let next = 0; next < found.length; next += 1) {
    for (const row of rows) {
      if (row.parentId === found[next] && !found.includes(row.id)) found.push(row.id);
    }
  }
  return found;
}

/**
 * The Decisions Log: every approved change, newest first. It is not a
 * separate record: it is the approved proposals themselves, including direct
 * edits and restores.
 *
 * The section filter covers the chosen section and everything under it,
 * archived sections included: a decision about a subsection stays in its
 * parent's list after the subsection is archived (the decision to archive
 * it too). `tree` is no longer needed for that and is not used; it is still
 * accepted so that existing callers keep working.
 */
export async function listDecisions(
  q: Queryable,
  tree: SectionNode[],
  filters: DecisionFilters = {},
  limit = 200,
): Promise<ProposalView[]> {
  void tree;
  let sectionIds: string[] | null = null;
  if (filters.sectionId) {
    sectionIds = await sectionAndBelow(q, filters.sectionId);
    if (sectionIds.length === 0) return [];
  }
  const conditions: (SQL | undefined)[] = [
    eq(proposals.status, "approved"),
    sectionIds
      ? sql`(${inArray(proposals.sectionId, sectionIds)} or ${inArray(proposals.createdSectionId, sectionIds)})`
      : undefined,
    filters.business ? inArray(proposals.businessTag, businessFilterTags(filters.business)) : undefined,
    filters.approverId
      ? exists(
          q
            .select({ one: sql`1` })
            .from(approvals)
            .where(and(eq(approvals.proposalId, proposals.id), eq(approvals.userId, filters.approverId))),
        )
      : undefined,
    filters.from ? sql`${centralDay(proposals.decidedAt)} >= ${filters.from}::date` : undefined,
    filters.to ? sql`${centralDay(proposals.decidedAt)} <= ${filters.to}::date` : undefined,
  ];
  const rows = await selectProposals(q)
    .where(and(...conditions))
    .orderBy(desc(proposals.decidedAt), desc(proposals.id))
    .limit(limit);
  return toViews(q, rows);
}

/**
 * Decisions made by one person that the other Owner(s) should see: approved
 * in the last 14 days (US Central days), decided by one person, and not yet
 * approved by anyone else who can approve now (`soloOpen`), while there is
 * at least one other person who can approve.
 *
 * A change to official text stays listed when the section has been saved
 * again since (`superseded` says so): saving a section a second time must
 * never take the first one-person change off the other Owner's list.
 */
export async function listOneOwnerDecisions(q: Queryable, now: Date = new Date()): Promise<ProposalView[]> {
  const since = addDays(centralDateKey(now), -SOLO_FLAG_DAYS);
  const rows = await selectProposals(q)
    .where(
      and(
        eq(proposals.status, "approved"),
        eq(proposals.decidedAlone, true),
        sql`${centralDay(proposals.decidedAt)} >= ${since}::date`,
      ),
    )
    .orderBy(desc(proposals.decidedAt), desc(proposals.id));
  const views = await toViews(q, rows);
  const owners = await activeApprovers(q);
  return views.filter((view) => view.soloOpen && owners.some((owner) => owner.id !== view.decidedById));
}

/**
 * True when `actor` could add "I approve too": it was approved by one
 * person, nobody else who can approve has approved it since, and `actor`
 * can approve and has not.
 */
export function canApproveToo(view: ProposalView, actor: Actor): boolean {
  return (
    view.status === "approved" &&
    view.soloOpen &&
    can(actor, "approve") &&
    !view.approvals.some((a) => a.userId === actor.id)
  );
}

export type OneOwnerGroup = { head: ProposalView; earlier: ProposalView[] };

/**
 * One-person decisions (`listOneOwnerDecisions`) put together for showing,
 * so that a section saved three times is one entry and not three. Nothing is
 * left out: every change is either a `head` or in an `earlier` list.
 *
 * Text changes are grouped by section: `head` is the newest still-flagged
 * change of that section, `earlier` the older ones, newest first. A section
 * change is always a group of its own. Groups are ordered by the head's
 * decision time, newest first.
 */
export function groupOneOwnerDecisions(views: ProposalView[]): OneOwnerGroup[] {
  const time = (view: ProposalView) => view.decidedAt?.getTime() ?? 0;
  // Newest first. Two saves of one section can carry the same time; their
  // version numbers always say which came later.
  const newestFirst = (a: ProposalView, b: ProposalView) =>
    (b.resultVersion?.version ?? 0) - (a.resultVersion?.version ?? 0) || time(b) - time(a);
  const bySection = new Map<string, ProposalView[]>();
  const groups: OneOwnerGroup[] = [];
  for (const view of views) {
    if (view.type === "structure" || !view.sectionId) {
      groups.push({ head: view, earlier: [] });
    } else {
      bySection.set(view.sectionId, [...(bySection.get(view.sectionId) ?? []), view]);
    }
  }
  for (const changes of bySection.values()) {
    const [head, ...earlier] = [...changes].sort(newestFirst);
    groups.push({ head, earlier });
  }
  // (Sorting keeps the order they came in for groups decided at the same moment.)
  return groups.sort((a, b) => time(b.head) - time(a.head));
}

export type UnapprovedChange = {
  versionId: string;
  version: number;
  /** When this version became official. */
  savedAt: Date;
  /** The proposal (or direct edit) behind it. */
  proposalId: string;
  /** That proposal's title as stored ("Edited directly" for a direct edit). */
  title: string;
  /** Everyone whose approval is on it, in the order they approved. */
  approvedBy: string[];
};

/** How many of a section's unapproved changes `changesNotApprovedBy` hands back. */
export const UNAPPROVED_CHANGES_SHOWN = 10;

/**
 * The changes to a section's official text that `actor` has never approved:
 * its versions, newest first, back to (but not including) the newest version
 * whose proposal `actor` approved. If they never approved any version of the
 * section, that is every version. At most 10 are handed back; `total` is how
 * many there are.
 *
 * The proposal page uses this to warn an Owner that the text a proposal is
 * compared with already contains changes they did not approve. Empty for
 * someone who cannot approve.
 */
export async function changesNotApprovedBy(
  q: Queryable,
  sectionId: string,
  actor: Actor,
): Promise<{ items: UnapprovedChange[]; total: number }> {
  if (!can(actor, "approve") || !isUuid(sectionId)) return { items: [], total: 0 };
  const versions = await q
    .select({
      versionId: officialVersions.id,
      version: officialVersions.version,
      savedAt: officialVersions.createdAt,
      proposalId: officialVersions.proposalId,
      title: proposals.title,
    })
    .from(officialVersions)
    .innerJoin(proposals, eq(proposals.id, officialVersions.proposalId))
    .where(eq(officialVersions.sectionId, sectionId))
    .orderBy(desc(officialVersions.version));
  if (versions.length === 0) return { items: [], total: 0 };
  const approvalRows = await q
    .select({ proposalId: approvals.proposalId, userId: approvals.userId, name: users.name })
    .from(approvals)
    .innerJoin(users, eq(users.id, approvals.userId))
    .where(
      inArray(
        approvals.proposalId,
        versions.map((v) => v.proposalId),
      ),
    )
    .orderBy(asc(approvals.createdAt), asc(approvals.id));
  const mine = new Set(approvalRows.filter((a) => a.userId === actor.id).map((a) => a.proposalId));
  const firstApproved = versions.findIndex((v) => mine.has(v.proposalId));
  const unapproved = firstApproved < 0 ? versions : versions.slice(0, firstApproved);
  return {
    items: unapproved.slice(0, UNAPPROVED_CHANGES_SHOWN).map((v) => ({
      ...v,
      approvedBy: approvalRows.filter((a) => a.proposalId === v.proposalId).map((a) => a.name),
    })),
    total: unapproved.length,
  };
}

/**
 * Which approve buttons an open proposal shows this person. `approvers` is
 * everyone who can approve right now (`activeApprovers`).
 *  - `approve` ("Approve"): pressing it does something. Either they have
 *    not approved yet and there is another Owner whose approval it can then
 *    wait for (or already has); or they have approved and so has another
 *    Owner, and this press makes it official. Never on a proposal that is
 *    out of date: two people cannot approve that until its proposer has
 *    checked it against the new official text.
 *  - `alone` ("Approve on my own"): nobody else who can approve has
 *    approved it, so they may make it official without waiting, as a
 *    one-person decision. For the proposer, and for a single Owner, this is
 *    the only one of the two.
 */
export function approveChoices(
  view: ProposalView,
  actor: Actor,
  approvers: { id: string }[],
): { approve: boolean; alone: boolean } {
  if (view.status !== "open" || !can(actor, "approve")) return { approve: false, alone: false };
  const approved = new Set(view.approvals.map((a) => a.userId));
  const mine = approved.has(actor.id);
  const otherOwners = approvers.filter((owner) => owner.id !== actor.id);
  const othersApproved = otherOwners.filter((owner) => approved.has(owner.id)).length;
  return {
    approve: !view.outOfDate && (mine ? othersApproved >= 1 : otherOwners.length >= 1),
    alone: othersApproved === 0,
  };
}

/**
 * What an open proposal is waiting for, and for whom. Null unless it is
 * open. `approvers` is everyone who can approve right now.
 */
export function waitingOn(view: ProposalView, approvers: { id: string; name: string }[]): Waiting | null {
  if (view.status !== "open") return null;
  const people = (list: { id: string; name: string }[]) => ({
    ids: list.map((person) => person.id),
    names: list.map((person) => person.name),
  });
  if (view.outOfDate) {
    return view.proposerCanChange && view.proposedById
      ? { step: "check", ids: [view.proposedById], names: [view.proposedByName ?? "Someone"], needed: 0 }
      : { step: "stuck", ...people(approvers), needed: 0 };
  }
  const approved = new Set(view.approvals.map((a) => a.userId));
  const haveApproved = approvers.filter((owner) => approved.has(owner.id));
  const haveNot = approvers.filter((owner) => !approved.has(owner.id));
  return {
    step: "approve",
    // With two approvals on it already, anyone's press of Approve completes it.
    ...people(haveApproved.length >= 2 ? approvers : haveNot),
    needed: Math.max(0, Math.min(2, approvers.length) - haveApproved.length),
  };
}

/** "Casey", "Casey or Dana", "Casey, Dana or Sam" */
function orNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} or ${names.at(-1)}`;
}

/**
 * One line saying who an open proposal is waiting for, as `viewerId` should
 * read it ("you" for themselves). Null unless it is open.
 *
 *  - "Waiting for you" / "Waiting for Casey" / "Waiting for Casey or Dana" /
 *    "Waiting for you or Dana": one more approval is needed (or one more
 *    press of Approve), and these are the people who could give it.
 *  - "Waiting for two Owners": two approvals are needed.
 *  - "No other Owner to wait for": there is nobody to wait for (a single
 *    Owner who has approved it; "Approve on my own" is the way forward).
 *  - "Waiting for you to check it against the new official text" /
 *    "Waiting for Kale to check ...": it is out of date.
 *  - "The official text changed and it can no longer be approved. Decline
 *    it.": it is out of date and its proposer can no longer change it.
 */
export function waitingText(
  view: ProposalView,
  approvers: { id: string; name: string }[],
  viewerId: string,
): string | null {
  const waiting = waitingOn(view, approvers);
  if (!waiting) return null;
  if (waiting.step === "stuck") return "The official text changed and it can no longer be approved. Decline it.";
  if (waiting.step === "check") {
    const who = waiting.ids.includes(viewerId) ? "you" : waiting.names[0];
    return `Waiting for ${who} to check it against the new official text`;
  }
  if (waiting.ids.length === 0) return "No other Owner to wait for";
  if (waiting.needed === 2) return "Waiting for two Owners";
  const others = waiting.names.filter((_, index) => waiting.ids[index] !== viewerId);
  return `Waiting for ${orNames(waiting.ids.includes(viewerId) ? ["you", ...others] : others)}`;
}

/** The names of the people an open proposal is waiting for (`waitingOn(...).names`). */
export function waitingFor(view: ProposalView, approvers: { id: string; name: string }[]): string[] {
  return waitingOn(view, approvers)?.names ?? [];
}

/** True when this person could endorse it: allowed to, and has neither approved nor endorsed it. */
export function canEndorse(view: ProposalView, actor: Actor): boolean {
  return (
    (view.status === "open" || view.status === "approved") &&
    can(actor, "endorse") &&
    !view.approvals.some((a) => a.userId === actor.id) &&
    !view.endorsements.some((e) => e.userId === actor.id)
  );
}

/** True while the proposer may still change it: open, and nobody else has approved or endorsed. */
export function canEditProposal(view: ProposalView, actor: Actor): boolean {
  return (
    view.status === "open" &&
    can(actor, "propose") &&
    view.proposedById === actor.id &&
    !view.approvals.some((a) => a.userId !== actor.id) &&
    !view.endorsements.some((e) => e.userId !== actor.id)
  );
}

export const PROPOSAL_STATUS_LABELS: Record<ProposalStatus, string> = {
  open: "Waiting for approval",
  approved: "Approved",
  declined: "Declined",
  withdrawn: "Withdrawn",
};

/**
 * One line saying where a proposal stands, e.g. "Waiting for approval",
 * "Approved by Kale and Casey, Nov 12, 2026", "Declined by Casey, Nov 12, 2026".
 */
export function statusLine(view: ProposalView): string {
  if (view.status === "open") return PROPOSAL_STATUS_LABELS.open;
  if (view.status === "approved") return approvalLine(view.approvals) ?? PROPOSAL_STATUS_LABELS.approved;
  const verb = view.status === "declined" ? "Declined" : "Withdrawn";
  const by = view.decidedByName ? ` by ${view.decidedByName}` : "";
  return `${verb}${by}${view.decidedAt ? `, ${formatDate(view.decidedAt)}` : ""}`;
}

/** What `displayTitle` needs to know about a proposal. A `ProposalView` has all of it. */
export type TitleParts = Pick<ProposalView, "title" | "direct" | "sectionId" | "type" | "status" | "structureChange"> &
  Partial<Pick<ProposalView, "decidedTitle" | "resultVersion" | "sectionTitle" | "destinationTitle">>;

/**
 * The title to show in lists.
 *  - A direct edit or restore has no written title, so its section is added,
 *    and the version it produced, because two saves of one section would
 *    otherwise read the same: "Edited directly: 2.1 Wages (version 3)",
 *    "Restored version 1: 3.1 Store Hours (as version 4)". (Without
 *    `resultVersion` the version is left out.)
 *  - A structure proposal that is still open is described from what it will
 *    actually do, with the sections' names and numbers as they are right
 *    now, never from its stored title.
 *  - An approved structure proposal shows the sentence it was approved
 *    under (`decidedTitle`): what it said, with the names and numbers of
 *    that moment, when the approver pressed the button. Section changes
 *    approved before that sentence was recorded, and declined or withdrawn
 *    ones, show the title stored when they were proposed or last changed.
 *
 * A section that is no longer among the sections (archived, or under an
 * archived one) is named by its stored name: "Hiring (archived)". That
 * needs `sectionTitle` (and `destinationTitle` for a move); without them it
 * reads "a section that has been archived".
 */
export function displayTitle(view: TitleParts, tree: SectionNode[]): string {
  const names = storedSectionNames(view);
  if (view.direct) {
    const section = sectionLabel(tree, view.sectionId, names);
    if (!view.resultVersion) return `${view.title}: ${section}`;
    // Told apart by the title the app itself gave it, never by reading the words.
    return view.title === DIRECT_EDIT_TITLE
      ? `${view.title}: ${section} (version ${view.resultVersion.version})`
      : `${view.title}: ${section} (as version ${view.resultVersion.version})`;
  }
  if (view.type === "structure") {
    if (view.status !== "open") return view.decidedTitle ?? view.title;
    if (view.structureChange) return describeStructure(tree, view.sectionId, view.structureChange, names);
  }
  return view.title;
}

/**
 * The section a proposal is about, to show next to it: its number and name
 * as they are now ("2.3 Hiring"), or its stored name when it is no longer
 * among the sections ("Hiring (archived)"). Null when the proposal has no
 * section (adding a top-level section).
 */
export function sectionText(
  view: Pick<ProposalView, "sectionId"> & Partial<Pick<ProposalView, "sectionTitle">>,
  tree: SectionNode[],
): string | null {
  return view.sectionId ? sectionLabel(tree, view.sectionId, storedSectionNames(view)) : null;
}

export type TextChange = {
  /** The official text the proposed text is compared with (null: there was none). */
  before: RichDoc | null;
  after: RichDoc;
  /**
   * What `before` is: the official text as it is now (open proposals), the
   * text this replaced (approved), or the text at the time it was proposed
   * (declined and withdrawn).
   */
  basis: "now" | "replaced" | "then";
  /** Open proposals: the official text has changed since this was proposed. */
  changedSince: boolean;
  /** The section's current official version, to send back as `seen.currentVersionId`. */
  currentVersionId: string | null;
};

/** What a text proposal changes. Null for structure proposals. */
export async function loadTextChange(q: Queryable, view: ProposalView): Promise<TextChange | null> {
  if (view.type === "structure" || !view.sectionId || !view.proposedOfficial) return null;
  const current = await latestVersionRow(q, view.sectionId);
  const currentVersionId = current?.id ?? null;
  const after = view.proposedOfficial;
  if (view.status === "open") {
    return {
      before: (current?.content as RichDoc | undefined) ?? null,
      after,
      basis: "now",
      changedSince: currentVersionId !== view.baseVersionId,
      currentVersionId,
    };
  }
  if (view.status === "approved" && view.resultVersion) {
    const [replaced] = await q
      .select({ content: officialVersions.content })
      .from(officialVersions)
      .where(
        and(
          eq(officialVersions.sectionId, view.sectionId),
          eq(officialVersions.version, view.resultVersion.version - 1),
        ),
      );
    return {
      before: (replaced?.content as RichDoc | undefined) ?? null,
      after,
      basis: "replaced",
      changedSince: false,
      currentVersionId,
    };
  }
  const [base] = view.baseVersionId
    ? await q
        .select({ content: officialVersions.content })
        .from(officialVersions)
        .where(eq(officialVersions.id, view.baseVersionId))
    : [];
  return {
    before: (base?.content as RichDoc | undefined) ?? null,
    after,
    basis: "then",
    changedSince: false,
    currentVersionId,
  };
}

/**
 * Everything `displayTitle` needs about a proposal, for the readers that do
 * not hand back whole `ProposalView`s (the proposal line on a note, search
 * results). `title` is the stored title: show `displayTitle(fields, tree)`.
 */
export type ProposalTitleFields = Pick<
  ProposalView,
  | "title"
  | "type"
  | "status"
  | "direct"
  | "sectionId"
  | "sectionTitle"
  | "destinationTitle"
  | "structureChange"
  | "decidedTitle"
  | "resultVersion"
>;

/** `ProposalTitleFields` for each of these proposals, by id (one query). */
export async function titleFieldsFor(q: Queryable, proposalIds: string[]): Promise<Map<string, ProposalTitleFields>> {
  const result = new Map<string, ProposalTitleFields>();
  const ids = [...new Set(proposalIds)].filter(isUuid);
  if (ids.length === 0) return result;
  const rows = await q
    .select({
      id: proposals.id,
      title: proposals.title,
      type: proposals.type,
      status: proposals.status,
      direct: proposals.direct,
      sectionId: proposals.sectionId,
      sectionTitle: aboutSection.title,
      destinationTitle: destinationSection.title,
      structureChange: proposals.structureChange,
      decidedTitle: proposals.decidedTitle,
      versionId: officialVersions.id,
      version: officialVersions.version,
    })
    .from(proposals)
    .leftJoin(aboutSection, eq(aboutSection.id, proposals.sectionId))
    .leftJoin(destinationSection, isDestinationOfMove)
    // (A proposal produces at most one official version.)
    .leftJoin(officialVersions, eq(officialVersions.proposalId, proposals.id))
    .where(inArray(proposals.id, ids));
  for (const { id, versionId, version, structureChange, ...row } of rows) {
    result.set(id, {
      ...row,
      structureChange: (structureChange as StructureChange | null) ?? null,
      resultVersion: versionId !== null && version !== null ? { id: versionId, version } : null,
    });
  }
  return result;
}

/** A proposal made from a note: its id and what `displayTitle` needs to name it. */
export type NoteProposalLine = { id: string } & ProposalTitleFields;

/**
 * Proposals (not direct edits) made from each of these notes, oldest first.
 * `title` is the stored title, as before; the other fields are there so the
 * note can show `displayTitle(line, tree)`, the same title as everywhere else.
 */
export async function proposalsForNotes(q: Queryable, noteIds: string[]): Promise<Map<string, NoteProposalLine[]>> {
  const result = new Map<string, NoteProposalLine[]>();
  if (noteIds.length === 0) return result;
  const rows = await q
    .select({ noteId: proposalNotes.noteId, id: proposals.id })
    .from(proposalNotes)
    .innerJoin(proposals, eq(proposals.id, proposalNotes.proposalId))
    .where(inArray(proposalNotes.noteId, noteIds))
    .orderBy(asc(proposals.createdAt), asc(proposals.id));
  const fields = await titleFieldsFor(
    q,
    rows.map((row) => row.id),
  );
  for (const { noteId, id } of rows) {
    const line = fields.get(id);
    if (line) result.set(noteId, [...(result.get(noteId) ?? []), { id, ...line }]);
  }
  return result;
}

/** The ids of the notes a proposal came from. */
export async function sourceNoteIds(q: Queryable, proposalId: string): Promise<string[]> {
  const rows = await q
    .select({ noteId: proposalNotes.noteId })
    .from(proposalNotes)
    .where(eq(proposalNotes.proposalId, proposalId));
  return rows.map((row) => row.noteId);
}

export async function loadProposalComments(q: Queryable, proposalId: string): Promise<CommentView[]> {
  const rows = await q
    .select({
      id: comments.id,
      body: comments.body,
      createdAt: comments.createdAt,
      authorId: comments.createdBy,
      authorName: users.name,
    })
    .from(comments)
    .innerJoin(users, eq(users.id, comments.createdBy))
    .where(eq(comments.proposalId, proposalId))
    .orderBy(asc(comments.createdAt), asc(comments.id));
  return rows.map((row) => ({ ...row, body: row.body as RichDoc }));
}

// ------------------------------------------------------------- describing

/** Stored names of sections by id, for naming one that is no longer among the sections. */
export type StoredSectionNames = ReadonlyMap<string, string>;

/**
 * The stored names a proposal carries: of the section it is about and, for
 * a move, of the section it would go under. For `describeStructure`.
 */
export function storedSectionNames(
  view: Pick<ProposalView, "sectionId"> &
    Partial<Pick<ProposalView, "sectionTitle" | "destinationTitle" | "structureChange">>,
): StoredSectionNames {
  const names = new Map<string, string>();
  if (view.sectionId && view.sectionTitle) names.set(view.sectionId, view.sectionTitle);
  const change = view.destinationTitle ? readStructureChange(view.structureChange) : null;
  if (change?.action === "move" && change.parentId) names.set(change.parentId, view.destinationTitle as string);
  return names;
}

/**
 * "2.3 Hiring" for a section that is among the sections now. For one that is
 * not (archived, or under an archived section): its stored name, "Hiring
 * (archived)", when `names` has it.
 */
function sectionLabel(tree: SectionNode[], id: string | null, names?: StoredSectionNames): string {
  if (!id) return "the top level";
  const node = findNode(tree, id);
  if (node) return `${node.number} ${node.title}`;
  const stored = names?.get(id);
  return stored ? `${stored} (archived)` : "a section that has been archived";
}

/**
 * One plain sentence saying what a structure proposal does, using the
 * sections' names and numbers as they are right now. `names` (see
 * `storedSectionNames`) lets it name a section that is no longer among the
 * sections: "Move 5.2 Signage under Marketing and Events (archived)".
 */
export function describeStructure(
  tree: SectionNode[],
  sectionId: string | null,
  change: StructureChange,
  names?: StoredSectionNames,
): string {
  const known = readStructureChange(change);
  if (!known) return UNREADABLE_CHANGE_SENTENCE;
  const label = (id: string | null) => sectionLabel(tree, id, names);
  switch (known.action) {
    case "add":
      return sectionId ? `Add a section "${known.title}" under ${label(sectionId)}` : `Add a top-level section "${known.title}"`;
    case "rename":
      return `Rename ${label(sectionId)} to "${known.title}"`;
    case "move":
      return known.parentId
        ? `Move ${label(sectionId)} under ${label(known.parentId)}`
        : `Move ${label(sectionId)} to the top level`;
    case "archive":
      return `Archive ${label(sectionId)}`;
  }
}

/** What is shown for a structure change the app does not know how to carry out. */
export const UNREADABLE_CHANGE_SENTENCE = "A change to the sections that this app cannot read (it will not be carried out)";

/**
 * A stored structure change, checked: one of the four the app can carry out,
 * with what each needs. Null for anything else. Stored changes are never
 * taken on trust and never guessed at.
 */
function readStructureChange(raw: unknown): StructureChange | null {
  if (typeof raw !== "object" || raw === null) return null;
  const change = raw as Record<string, unknown>;
  const hasTitle = typeof change.title === "string" && change.title.trim().length > 0;
  switch (change.action) {
    case "add":
      return hasTitle ? { action: "add", title: change.title as string } : null;
    case "rename":
      return hasTitle
        ? {
            action: "rename",
            title: change.title as string,
            fromTitle: typeof change.fromTitle === "string" ? change.fromTitle : "",
          }
        : null;
    case "move":
      return change.parentId === null || typeof change.parentId === "string"
        ? { action: "move", parentId: change.parentId }
        : null;
    case "archive":
      return { action: "archive" };
    default:
      return null;
  }
}

// --------------------------------------------------------------- checking

function cleanTitle(input: unknown): string {
  const title = typeof input === "string" ? input.replace(/\s+/g, " ").trim() : "";
  if (!title) throw new AppError("Say in a few words what is being decided.");
  if (title.length > MAX_TITLE_LENGTH) {
    throw new AppError(`Keep the title under ${MAX_TITLE_LENGTH} characters. Put the rest in the description.`);
  }
  return title;
}

function readDescription(raw: unknown): { description: RichDoc | null; descriptionText: string } {
  if (raw === undefined || raw === null) return { description: null, descriptionText: "" };
  const doc = sanitizeDoc(raw);
  return isEmptyDoc(doc)
    ? { description: null, descriptionText: "" }
    : { description: doc, descriptionText: docToText(doc) };
}

type Prepared = {
  type: ProposalType;
  title: string;
  description: RichDoc | null;
  descriptionText: string;
  sectionId: string | null;
  businessTag: BusinessTag | null;
  proposedOfficial: RichDoc | null;
  proposedOfficialText: string | null;
  /** Text proposals: the section's official version as it is right now (null if it has none). */
  baseVersionId: string | null;
  structureChange: StructureChange | null;
};

/**
 * Check a new or edited proposal against the sections and official text as
 * they are now.
 *
 * `shown` (text proposals): the official version the person's page showed
 * them. If that is no longer the section's current version, the proposal is
 * refused with the words in `otherwise`.
 */
async function prepare(
  tx: Tx,
  input: ProposalInput,
  shown?: { versionId: string | null; otherwise: string },
): Promise<Prepared> {
  const tree = await loadTree(tx);
  const { description, descriptionText } = readDescription(input.description);

  if (input.kind === "structure") {
    const change = input.change;
    let sectionId: string | null;
    let structureChange: StructureChange;
    if (change.action === "add") {
      const title = checkSectionTitle(change.title);
      if (change.parentId) {
        const parent = findNode(tree, change.parentId);
        if (!parent) throw new AppError("The section to add it under no longer exists. Choose again.");
        if (parent.depth >= MAX_DEPTH) {
          throw new AppError("Sections can go three levels deep at most (for example 1.1.1).");
        }
      }
      sectionId = change.parentId;
      structureChange = { action: "add", title };
    } else {
      const node = findNode(tree, change.sectionId);
      if (!node) throw new AppError("That section no longer exists. Reload the page and choose again.");
      sectionId = node.id;
      if (change.action === "rename") {
        const title = checkSectionTitle(change.title);
        if (title === node.title) throw new AppError("That is already the section's name.");
        structureChange = { action: "rename", title, fromTitle: node.title };
      } else if (change.action === "move") {
        const problem = moveProblem(tree, node.id, change.parentId);
        if (problem) throw new AppError(problem);
        structureChange = { action: "move", parentId: change.parentId };
      } else {
        structureChange = { action: "archive" };
      }
    }
    return {
      type: "structure",
      title: describeStructure(tree, sectionId, structureChange),
      description,
      descriptionText,
      sectionId,
      businessTag: null,
      proposedOfficial: null,
      proposedOfficialText: null,
      baseVersionId: null,
      structureChange,
    };
  }

  const title = cleanTitle(input.title);
  const businessTag = parseBusinessTag(input.businessTag);
  if (!isUuid(input.sectionId) || !findNode(tree, input.sectionId)) {
    throw new AppError("That section no longer exists. Reload the page and choose again.");
  }
  const proposedOfficial = sanitizeDoc(input.proposedOfficial);
  const current = await latestVersionRow(tx, input.sectionId);
  if (shown && (current?.id ?? null) !== shown.versionId) throw new AppError(shown.otherwise);
  if (current ? sameDoc(current.content as RichDoc, proposedOfficial) : isEmptyDoc(proposedOfficial)) {
    throw new AppError(
      "The proposed official text is the same as the current one. Change the text to what it should say if this is approved.",
    );
  }
  return {
    type: input.kind,
    title,
    description,
    descriptionText,
    sectionId: input.sectionId,
    businessTag,
    proposedOfficial,
    proposedOfficialText: docToText(proposedOfficial),
    baseVersionId: current?.id ?? null,
    structureChange: null,
  };
}

/** Lock the proposal row so two people acting at the same moment go one after the other. */
async function lockProposal(tx: Tx, id: string): Promise<ProposalRow> {
  if (!isUuid(id)) throw new AppError(NOT_FOUND);
  const [row] = await tx.select().from(proposals).where(eq(proposals.id, id)).for("update");
  if (!row) throw new AppError(NOT_FOUND);
  return row;
}

function requireOpen(row: ProposalRow): void {
  if (row.status === "open") return;
  const what =
    row.status === "approved" ? "approved" : row.status === "declined" ? "declined" : "withdrawn";
  throw new AppError(`This proposal has already been ${what}. Reload the page to see it.`);
}

async function nameOf(tx: Tx, userId: string | null): Promise<string> {
  if (!userId) return "Someone";
  const [row] = await tx.select({ name: users.name }).from(users).where(eq(users.id, userId));
  return row?.name ?? "Someone";
}

/**
 * The database's own error codes (SQLSTATE) for three of its refusals, so
 * that each can be told to the person in plain words:
 *  - an approval or endorsement that names an older revision of the proposal;
 *  - two people's approval of a proposal that is out of date;
 *  - an approval or endorsement of a proposal that has just been declined
 *    or withdrawn.
 */
const STALE_REVISION = "PPF01";
const OUT_OF_DATE = "PPF03";
const CLOSED_MEANWHILE = "PPF04";
/** What the database answers when a row breaks one of its permission rules. */
const BROKE_A_RULE = "42501";

const CLOSED_SO_NOT_ENDORSED = "This proposal was declined or withdrawn, so it can no longer be endorsed.";
const CLOSED_SO_NOT_APPROVED = "This proposal has already been declined or withdrawn. Reload the page to see it.";

function changedAfterOpening(who: string, verb: string): string {
  return `${who} changed this proposal after you opened it. Reload the page and read it again, then ${verb}.`;
}

function officialTextChangedAfterOpening(verb: string): string {
  return `The official text of this section changed after you opened this page. Reload the page and read it again, then ${verb}.`;
}

/** Refuse to act on a page that no longer shows what would be approved. */
async function checkSeen(tx: Tx, row: ProposalRow, seen: Seen, verb: string): Promise<void> {
  if (seen.revision !== row.revision) {
    throw new AppError(changedAfterOpening(await nameOf(tx, row.proposedBy), verb));
  }
  if (row.type !== "structure" && row.sectionId && seen.currentVersionId !== undefined) {
    const current = await latestVersionRow(tx, row.sectionId);
    if ((current?.id ?? null) !== seen.currentVersionId) {
      throw new AppError(officialTextChangedAfterOpening(verb));
    }
  }
}

async function approvalsOf(tx: Tx, proposalId: string): Promise<{ userId: string }[]> {
  return tx.select({ userId: approvals.userId }).from(approvals).where(eq(approvals.proposalId, proposalId));
}

/** True when anyone other than `userId` has approved or endorsed this proposal. */
async function othersHaveSigned(tx: Tx, proposalId: string, userId: string | null): Promise<boolean> {
  if ((await approvalsOf(tx, proposalId)).some((a) => a.userId !== userId)) return true;
  const endorsed = await tx
    .select({ userId: endorsements.userId })
    .from(endorsements)
    .where(eq(endorsements.proposalId, proposalId));
  return endorsed.some((e) => e.userId !== userId);
}

/**
 * True when a text proposal is out of date: the official text of its
 * section is no longer the version it was written against or last checked
 * against. Call it with the section locked (`lockSectionOf`), so the answer
 * holds until the transaction ends.
 */
async function isOutOfDate(tx: Tx, row: ProposalRow): Promise<boolean> {
  if (row.type === "structure" || !row.sectionId) return false;
  const current = await latestVersionRow(tx, row.sectionId);
  return (current?.id ?? null) !== row.baseVersionId;
}

/**
 * What a person is told when they try to approve a proposal that is out of
 * date. It depends on whether the proposer could still check it against the
 * new text: they have not been removed, may still propose, and nobody else
 * has approved or endorsed it (the same test as `proposerCanChange`).
 *
 * Worked out before anything is written, because once the database has
 * refused a row nothing more can be read in that transaction.
 */
async function outOfDateWords(tx: Tx, row: ProposalRow): Promise<string> {
  // (Only a text proposal can be out of date.)
  if (row.type === "structure") return "";
  const [who] = row.proposedBy
    ? await tx
        .select({ name: users.name, removedAt: users.removedAt, permissions: roles.permissions })
        .from(users)
        .innerJoin(roles, eq(roles.key, users.roleKey))
        .where(eq(users.id, row.proposedBy))
    : [];
  const canStillChange =
    who !== undefined &&
    who.removedAt === null &&
    who.permissions.includes("propose") &&
    !(await othersHaveSigned(tx, row.id, row.proposedBy));
  return canStillChange
    ? `The official text of this section has changed since ${who.name} proposed this. ${who.name} needs to check the proposal against the new text and save it again before it can be approved. You can comment on it or decline it.`
    : "The official text of this section has changed since this was proposed, and the person who proposed it can no longer change it. Decline it and make a new proposal.";
}

/**
 * Record an approval or an endorsement, tied to the proposal revision the
 * person had in front of them. The database checks that number against the
 * proposal while holding a lock on it, so even when the proposer saves a
 * change at the very same moment, nobody's name ends up on words they did
 * not see: whichever of the two comes second is refused.
 *
 * Under the same lock the database checks that the proposal has not just
 * been declined or withdrawn. An Advisor's endorsement cannot take that lock
 * beforehand, so for them this is the check that counts.
 *
 * Says whether a row was added. It is not when this person's approval or
 * endorsement is already there, which happens when the same button press
 * arrives twice at the same moment: the second is then simply not needed
 * (the database allows one per person, and the checks above have still been
 * made for it).
 */
async function addStamp(
  tx: Tx,
  table: typeof approvals | typeof endorsements,
  row: Pick<ProposalRow, "id" | "proposedBy">,
  stamp: { userId: string; revision: number; now: Date },
  verb: "approve" | "endorse",
): Promise<boolean> {
  // Looked up first: once the database has refused a row, nothing more can
  // be read in this transaction.
  const proposerName = await nameOf(tx, row.proposedBy);
  const added = await tx
    .insert(table)
    .values({ proposalId: row.id, userId: stamp.userId, revision: stamp.revision, createdAt: stamp.now })
    .onConflictDoNothing()
    .returning({ id: table.id })
    .catch((error: unknown) => {
      const refusedWith = sqlState(error);
      if (refusedWith === STALE_REVISION) throw new AppError(changedAfterOpening(proposerName, verb));
      // Declined or withdrawn at this very moment. (The second code is what
      // the older rule on these two tables answers for the same thing.)
      if (refusedWith === CLOSED_MEANWHILE || refusedWith === BROKE_A_RULE) {
        throw new AppError(verb === "endorse" ? CLOSED_SO_NOT_ENDORSED : CLOSED_SO_NOT_APPROVED);
      }
      throw error;
    });
  return added.length > 0;
}

/**
 * The title an activity log line about a proposal carries. A direct edit or
 * a restore has no written title of its own ("Edited directly"), so the line
 * names its section and version, in the same words lists use
 * (`displayTitle`): "Edited directly: 2.1 Wages (version 3)". Anything else
 * goes by its stored title.
 */
async function titleForLog(tx: Tx, row: ProposalRow): Promise<string> {
  if (!row.direct) return row.title;
  const fields = (await titleFieldsFor(tx, [row.id])).get(row.id);
  return fields ? displayTitle(fields, await loadTree(tx)) : row.title;
}

// -------------------------------------------------------------- proposing

/** Make a proposal. The proposer's own approval is recorded with it. */
export async function createProposal(
  actor: Actor,
  input: ProposalInput,
  options: { now?: Date } = {},
): Promise<string> {
  assertCan(actor, "propose");
  assertCan(actor, "approve");
  const now = options.now ?? new Date();
  return asUser(actor.id, async (tx) => {
    // A text proposal made from a page: the official text that page started
    // from must still be the current one, or the person would be proposing
    // to replace words they have never seen.
    const prepared = await prepare(
      tx,
      input,
      input.kind !== "structure" && input.baseVersionId !== undefined
        ? {
            versionId: input.baseVersionId,
            otherwise:
              "The official text of this section changed after you opened this page. Reload the page. What you typed is kept on this device.",
          }
        : undefined,
    );
    const noteIds = [...new Set(input.noteIds ?? [])];
    if (noteIds.length > 50 || !noteIds.every(isUuid)) {
      throw new AppError("The notes for this proposal could not be read. Reload the page and try again.");
    }
    if (noteIds.length > 0) {
      const found = await tx
        .select({ id: notes.id })
        .from(notes)
        .where(and(inArray(notes.id, noteIds), isNull(notes.removedAt)));
      if (found.length !== noteIds.length) {
        throw new AppError("A note this proposal comes from was removed. Reload the page and try again.");
      }
    }
    const [created] = await tx
      .insert(proposals)
      .values({ ...prepared, proposedBy: actor.id, createdAt: now, updatedAt: now, updatedBy: actor.id })
      .returning({ id: proposals.id });
    // Proposing counts as approving. The proposer's approval is given on
    // revision 1 and keeps that number even after they edit their proposal:
    // that is fine, the new words are their own.
    await tx.insert(approvals).values({ proposalId: created.id, userId: actor.id, revision: 1, createdAt: now });
    if (noteIds.length > 0) {
      await tx
        .insert(proposalNotes)
        .values(noteIds.map((noteId) => ({ proposalId: created.id, noteId, createdAt: now, createdBy: actor.id })));
    }
    await logActivity(tx, actor.id, {
      action: "proposal.created",
      entityType: "proposal",
      entityId: created.id,
      summary: `Proposed: ${prepared.title}`,
      data: { type: prepared.type, sectionId: prepared.sectionId, noteIds },
    });
    return created.id;
  });
}

/**
 * True when two structure changes say the same thing. Compared field by
 * field: the database hands a stored change back with its fields in any
 * order, so the two can never be compared as text.
 */
function sameStructureChange(a: StructureChange | null, storedRaw: unknown): boolean {
  const nothingStored = storedRaw === null || storedRaw === undefined;
  if (a === null || nothingStored) return a === null && nothingStored;
  const b = readStructureChange(storedRaw);
  if (!b) return false;
  switch (a.action) {
    case "add":
      return b.action === "add" && a.title === b.title;
    case "rename":
      return b.action === "rename" && a.title === b.title && a.fromTitle === b.fromTitle;
    case "move":
      return b.action === "move" && a.parentId === b.parentId;
    case "archive":
      return b.action === "archive";
  }
}

/**
 * Change an open proposal. Only its proposer can, and only until someone
 * else has approved or endorsed it (after that: withdraw and propose again,
 * so nobody's approval ends up on words they did not see).
 *
 * `seen.currentVersionId` (text proposals) is the section's official version
 * that the edit page showed the proposer, null if it showed none. Sending
 * it says "I have checked my proposal against this official text":
 *  - it must still be the section's current version, or the save is refused;
 *  - the proposal is then written against that version (`baseVersionId`),
 *    which is what brings an out-of-date proposal up to date again. That
 *    counts as a change even when nothing else was changed: the revision
 *    goes up and the activity log says the proposal was checked.
 * Without it, what the proposal was written against stays as it is: fixing
 * a typo in the title does not hide that the official text has moved on.
 *
 * A save that changes nothing writes nothing and logs nothing.
 */
export async function editProposal(
  actor: Actor,
  id: string,
  input: ProposalInput,
  seen?: { currentVersionId?: string | null },
): Promise<void> {
  assertCan(actor, "propose");
  await asUser(actor.id, async (tx) => {
    const row = await lockProposal(tx, id);
    requireOpen(row);
    if (row.proposedBy !== actor.id) {
      throw new AppError("Only the person who made a proposal can change it. You can comment on it, or decline it.");
    }
    if (await othersHaveSigned(tx, id, actor.id)) {
      throw new AppError(
        "Someone has already approved or endorsed this proposal, so it can no longer be changed. Withdraw it and make a new one.",
      );
    }
    const expectedKind = row.type === "structure" ? "structure" : row.type;
    if (input.kind !== expectedKind) {
      throw new AppError("The kind of a proposal cannot be changed. Withdraw it and make a new one.");
    }
    if (input.kind !== "structure" && input.sectionId !== row.sectionId) {
      throw new AppError("The section of a proposal cannot be changed. Withdraw it and make a new one.");
    }
    const checkedAgainst = input.kind !== "structure" && seen?.currentVersionId !== undefined;
    const prepared = await prepare(
      tx,
      input,
      checkedAgainst
        ? { versionId: seen.currentVersionId as string | null, otherwise: officialTextChangedAfterOpening("save") }
        : undefined,
    );
    if (prepared.type === "structure") {
      const before = row.structureChange as StructureChange;
      if (prepared.structureChange!.action !== before.action || prepared.sectionId !== row.sectionId) {
        throw new AppError("What a structure proposal is about cannot be changed. Withdraw it and make a new one.");
      }
    }
    // Checked against the current official text: written against that
    // version from now on. Otherwise left exactly as it was.
    const baseVersionId = checkedAgainst ? prepared.baseVersionId : row.baseVersionId;
    const sameContent =
      prepared.title === row.title &&
      prepared.descriptionText === row.descriptionText &&
      sameStructureChange(prepared.structureChange, row.structureChange) &&
      prepared.businessTag === row.businessTag &&
      (prepared.description === null
        ? row.description === null
        : row.description !== null && sameDoc(prepared.description, row.description as RichDoc)) &&
      (prepared.proposedOfficial === null ||
        (row.proposedOfficial !== null && sameDoc(prepared.proposedOfficial, row.proposedOfficial as RichDoc)));
    if (sameContent && baseVersionId === row.baseVersionId) return;
    const [saved] = await tx
      .update(proposals)
      .set({
        title: prepared.title,
        description: prepared.description,
        descriptionText: prepared.descriptionText,
        businessTag: prepared.businessTag,
        proposedOfficial: prepared.proposedOfficial,
        proposedOfficialText: prepared.proposedOfficialText,
        baseVersionId,
        structureChange: prepared.structureChange,
      })
      .where(eq(proposals.id, id))
      .returning({ revision: proposals.revision });
    // The database raises the revision whenever a proposal really changes.
    // If it did not, nothing was changed, and the log must not say so.
    if (!saved || saved.revision === row.revision) return;
    await logActivity(tx, actor.id, {
      action: sameContent ? "proposal.rechecked" : "proposal.edited",
      entityType: "proposal",
      entityId: id,
      summary: sameContent
        ? `Checked their proposal against the new official text: ${prepared.title}`
        : `Changed their proposal: ${prepared.title}`,
      data: { revision: saved.revision, baseVersionId },
    });
  });
}

// --------------------------------------------------------------- deciding

/**
 * Why a section change that was fine when it was proposed can no longer be
 * carried out, with the sections as they are now. A few plain words that
 * read on after "This can no longer be done as proposed: ". Null when it
 * still can. (The section itself being gone is told separately, before this
 * is asked.)
 *
 * Two sections with the same name under one parent are allowed everywhere
 * in the app, so an "add" is not refused for that.
 */
function noLongerPossible(tree: SectionNode[], sectionId: string | null, change: StructureChange): string | null {
  const section = sectionId ? findNode(tree, sectionId) : null;
  switch (change.action) {
    case "add":
      return section && section.depth >= MAX_DEPTH ? "it would put the new section more than three levels deep" : null;
    case "rename":
      return section && section.title === checkSectionTitle(change.title)
        ? `the section is already called "${section.title}"`
        : null;
    case "move":
      switch (sectionId ? moveProblemKind(tree, sectionId, change.parentId) : null) {
        case "already_there":
          return "the section is already there";
        case "destination_gone":
          return "the section it would go under no longer exists (it may have been archived)";
        case "under_itself":
          return "a section cannot go under itself or under one of its own subsections";
        case "too_deep":
          return "it would put sections more than three levels deep";
        default:
          return null;
      }
    case "archive":
      return null;
  }
}

/**
 * What the person approving is told when a section change can no longer be
 * carried out: why, and what they can do about it. They cannot choose again
 * (that was the proposer's form), so the way forward is to decline it, or
 * for its proposer to change or withdraw it.
 */
async function cannotBeDoneNow(tx: Tx, actor: Actor, row: ProposalRow, reason: string): Promise<string> {
  const [who] = row.proposedBy
    ? await tx.select({ name: users.name, removedAt: users.removedAt }).from(users).where(eq(users.id, row.proposedBy))
    : [];
  const whatNow =
    row.proposedBy === actor.id
      ? "Change it, or withdraw it."
      : who && who.removedAt === null
        ? `Decline it, or ask ${who.name} to change or withdraw it.`
        : "Decline it.";
  return `This can no longer be done as proposed: ${reason}. ${whatNow}`;
}

/**
 * Mark the proposal approved and apply its change, in the transaction that
 * is already open. If the change cannot be applied, the error undoes
 * everything, including the approval just recorded.
 *
 * `ifOutOfDate` is what to tell the person if the database refuses a text
 * proposal as out of date (see `outOfDateWords`). The callers check that
 * themselves first, with the section locked, so the database should never
 * have to; if it ever does, the person still gets plain words.
 */
async function finalize(tx: Tx, actor: Actor, row: ProposalRow, now: Date, ifOutOfDate: string): Promise<void> {
  const decided = { status: "approved" as const, decidedAt: now, decidedBy: actor.id };
  // The title this decision is recorded under in the activity log.
  let recordedTitle = row.title;

  if (row.type === "structure") {
    // Checked, never guessed: a change the app cannot read changes nothing.
    const change = readStructureChange(row.structureChange);
    if (!change) throw new AppError(UNREADABLE_CHANGE);
    const tree = await loadTree(tx);
    // The sentence the approver was shown: what the change does, with the
    // sections' names and numbers as they are just before it is carried
    // out. It is kept with the decision, because the title stored when it
    // was proposed may no longer say what is being approved.
    const decidedTitle = describeStructure(tree, row.sectionId, change);
    recordedTitle = decidedTitle;
    // The section it is about must still be there (for "add": the section
    // to add it under, unless it goes to the top level).
    if (change.action === "add" ? row.sectionId && !findNode(tree, row.sectionId) : !row.sectionId || !findNode(tree, row.sectionId)) {
      throw new AppError(SECTION_GONE);
    }
    // And the sections must not have changed, while it waited, in a way
    // that leaves nothing to carry out.
    const reason = noLongerPossible(tree, row.sectionId, change);
    if (reason) throw new AppError(await cannotBeDoneNow(tx, actor, row, reason));
    if (change.action === "add") {
      const createdSectionId = await createSectionIn(tx, actor, { parentId: row.sectionId, title: change.title });
      await tx.update(proposals).set({ ...decided, decidedTitle, createdSectionId }).where(eq(proposals.id, row.id));
    } else {
      const sectionId = row.sectionId as string;
      switch (change.action) {
        case "rename":
          await renameSectionIn(tx, actor, sectionId, change.title);
          break;
        case "move":
          await moveSectionToIn(tx, actor, sectionId, change.parentId);
          break;
        case "archive":
          await archiveSectionIn(tx, actor, sectionId);
          break;
        default: {
          // A kind of change added later must be handled here on purpose.
          const unhandled: never = change;
          void unhandled;
          throw new AppError(UNREADABLE_CHANGE);
        }
      }
      await tx.update(proposals).set({ ...decided, decidedTitle }).where(eq(proposals.id, row.id));
    }
  } else {
    const [section] = await tx.select().from(sections).where(eq(sections.id, row.sectionId!));
    if (!section || section.archivedAt || !findNode(await loadTree(tx), section.id)) {
      throw new AppError(SECTION_GONE);
    }
    await tx
      .update(proposals)
      .set(decided)
      .where(eq(proposals.id, row.id))
      .catch((error: unknown) => {
        if (sqlState(error) === OUT_OF_DATE) throw new AppError(ifOutOfDate);
        throw error;
      });
    await addVersion(tx, actor, {
      sectionId: section.id,
      proposalId: row.id,
      content: row.proposedOfficial as RichDoc,
      now,
    });
  }

  const approvers = await tx
    .select({ name: users.name })
    .from(approvals)
    .innerJoin(users, eq(users.id, approvals.userId))
    .where(eq(approvals.proposalId, row.id))
    .orderBy(asc(approvals.createdAt), asc(approvals.id));
  await logActivity(tx, actor.id, {
    action: "proposal.approved",
    entityType: "proposal",
    entityId: row.id,
    summary: `Approved by ${joinNames(approvers.map((a) => a.name))}: ${recordedTitle}`,
    data: { type: row.type, sectionId: row.sectionId, approvals: approvers.length },
  });
}

/**
 * Add `actor`'s approval, given on `revision`, unless they have approved
 * already. Says whether an approval was added.
 */
async function recordApproval(
  tx: Tx,
  actor: Actor,
  row: ProposalRow,
  revision: number,
  now: Date,
): Promise<boolean> {
  if ((await approvalsOf(tx, row.id)).some((a) => a.userId === actor.id)) return false;
  return addStamp(tx, approvals, row, { userId: actor.id, revision, now }, "approve");
}

/**
 * Before approving a text proposal: lock its section, so that an approval
 * and any other change to that section's official text go one after the
 * other. Always after the proposal's own lock, and before looking at which
 * version is current.
 */
async function lockSectionOf(tx: Tx, row: ProposalRow): Promise<void> {
  if (row.type !== "structure" && row.sectionId) await lockSection(tx, row.sectionId);
}

export type ApproveOutcome = { approved: boolean; waitingFor: string[] };

/**
 * "Approve": record this Owner's approval. With the approvals of two people
 * who can approve, the proposal is approved and its change applied.
 * Otherwise it stays open, waiting for the other Owner.
 *
 * Refused, with nothing recorded:
 *  - on a text proposal that is out of date (its section's official text
 *    changed after it was proposed or last checked): its proposer's approval
 *    was never given on top of the newer text, so it cannot count as the
 *    second one. The proposer checks it and saves it again first;
 *  - when nobody else can approve right now: there would be no one to wait
 *    for. "Approve on my own" is the way forward then.
 */
export async function approveProposal(
  actor: Actor,
  id: string,
  seen: Seen,
  options: { now?: Date } = {},
): Promise<ApproveOutcome> {
  assertCan(actor, "approve");
  const now = options.now ?? new Date();
  return asUser(actor.id, async (tx) => {
    const row = await lockProposal(tx, id);
    requireOpen(row);
    await lockSectionOf(tx, row);
    await checkSeen(tx, row, seen, "approve");
    const ifOutOfDate = await outOfDateWords(tx, row);
    if (await isOutOfDate(tx, row)) throw new AppError(ifOutOfDate);
    const owners = await activeApprovers(tx);
    if (!owners.some((owner) => owner.id !== actor.id)) {
      throw new AppError("There is no other Owner to wait for right now. Use Approve on my own.");
    }
    const added = await recordApproval(tx, actor, row, seen.revision, now);
    const approvedBy = new Set((await approvalsOf(tx, id)).map((a) => a.userId));
    const counted = owners.filter((owner) => approvedBy.has(owner.id));
    if (counted.length >= 2) {
      await finalize(tx, actor, row, now, ifOutOfDate);
      return { approved: true, waitingFor: [] };
    }
    const waitingFor = owners.filter((owner) => !approvedBy.has(owner.id)).map((owner) => owner.name);
    // The log says "approved" only when an approval was really added just
    // now: pressing Approve again on something you already approved (the
    // proposer always has) records nothing and so logs nothing.
    if (added) {
      await logActivity(tx, actor.id, {
        action: "proposal.approval_added",
        entityType: "proposal",
        entityId: id,
        // One more approval is needed, and any one of these people can give it.
        summary: `Approved, waiting for ${waitingFor.length > 0 ? orNames(waitingFor) : "another Owner"}: ${row.title}`,
      });
    }
    return { approved: false, waitingFor };
  });
}

/**
 * "Approve on my own": make it official now with this Owner's approval,
 * without waiting. It is flagged on Today so the other Owner sees it.
 *
 * On a proposal that is out of date this is allowed only when the result is
 * a one-person decision (which is flagged): if someone else who can approve
 * right now has approved it too, it would be recorded as approved by two
 * people, one of whom never saw the newer official text, so it is refused.
 */
export async function approveAlone(
  actor: Actor,
  id: string,
  seen: Seen,
  options: { now?: Date } = {},
): Promise<void> {
  assertCan(actor, "approve");
  const now = options.now ?? new Date();
  await asUser(actor.id, async (tx) => {
    const row = await lockProposal(tx, id);
    requireOpen(row);
    await lockSectionOf(tx, row);
    await checkSeen(tx, row, seen, "approve");
    const ifOutOfDate = await outOfDateWords(tx, row);
    if (await isOutOfDate(tx, row)) {
      const owners = await activeApprovers(tx);
      const approvedBy = new Set((await approvalsOf(tx, id)).map((a) => a.userId));
      // (Counted as it will stand once this person's own approval is on it.)
      const counted = owners.filter((owner) => owner.id === actor.id || approvedBy.has(owner.id));
      if (counted.length >= 2) throw new AppError(ifOutOfDate);
    }
    await recordApproval(tx, actor, row, seen.revision, now);
    await finalize(tx, actor, row, now, ifOutOfDate);
  });
}

/** "I approve too": add an approval to something another Owner decided alone. */
export async function addApproval(actor: Actor, id: string, options: { now?: Date } = {}): Promise<void> {
  assertCan(actor, "approve");
  const now = options.now ?? new Date();
  await asUser(actor.id, async (tx) => {
    const row = await lockProposal(tx, id);
    if (row.status !== "approved") {
      throw new AppError("This can only be added to something that has been approved. Reload the page.");
    }
    // A decided proposal never changes again, so its revision is the wording that was approved.
    if (!(await recordApproval(tx, actor, row, row.revision, now))) return;
    await logActivity(tx, actor.id, {
      action: "proposal.approval_added",
      entityType: "proposal",
      entityId: id,
      summary: `Added their approval: ${await titleForLog(tx, row)}`,
    });
  });
}

/**
 * Decline someone else's open proposal, with an optional reason. Nothing is
 * applied. The reason is kept exactly as typed, spaces at its ends and line
 * breaks included; one that is all blank counts as no reason. The length
 * limit is on what was typed.
 */
export async function declineProposal(
  actor: Actor,
  id: string,
  reason: unknown,
  options: { now?: Date } = {},
): Promise<void> {
  assertCan(actor, "approve");
  const typed = typeof reason === "string" ? reason : "";
  if (typed.length > MAX_REASON_LENGTH) {
    throw new AppError(`Keep the reason under ${MAX_REASON_LENGTH} characters, or leave a comment instead.`);
  }
  const text = typed.trim().length === 0 ? "" : typed;
  const now = options.now ?? new Date();
  await asUser(actor.id, async (tx) => {
    const row = await lockProposal(tx, id);
    requireOpen(row);
    if (row.proposedBy === actor.id) {
      throw new AppError("This is your own proposal. Withdraw it instead of declining it.");
    }
    await tx
      .update(proposals)
      .set({ status: "declined", decidedAt: now, decidedBy: actor.id, declineReason: text || null })
      .where(eq(proposals.id, id));
    await logActivity(tx, actor.id, {
      action: "proposal.declined",
      entityType: "proposal",
      entityId: id,
      summary: `Declined: ${row.title}`,
      data: text ? { reason: text } : undefined,
    });
  });
}

/** Take back your own open proposal. Nothing is applied. */
export async function withdrawProposal(actor: Actor, id: string, options: { now?: Date } = {}): Promise<void> {
  assertCan(actor, "propose");
  const now = options.now ?? new Date();
  await asUser(actor.id, async (tx) => {
    const row = await lockProposal(tx, id);
    requireOpen(row);
    if (row.proposedBy !== actor.id) {
      throw new AppError("Only the person who made a proposal can withdraw it. You can decline it instead.");
    }
    await tx
      .update(proposals)
      .set({ status: "withdrawn", decidedAt: now, decidedBy: actor.id })
      .where(eq(proposals.id, id));
    await logActivity(tx, actor.id, {
      action: "proposal.withdrawn",
      entityType: "proposal",
      entityId: id,
      summary: `Withdrew their proposal: ${row.title}`,
    });
  });
}

/**
 * "Endorse": a visible sign of support that never changes the proposal's
 * status. For Advisors, and for Owners who have not approved it.
 */
export async function endorseProposal(
  actor: Actor,
  id: string,
  seen: Seen,
  options: { now?: Date } = {},
): Promise<void> {
  assertCan(actor, "endorse");
  const now = options.now ?? new Date();
  await asUser(actor.id, async (tx) => {
    // Advisors cannot lock a proposal for change, so this reads it plainly.
    // The database takes the lock for them when the endorsement is added.
    const [row] = isUuid(id) ? await tx.select().from(proposals).where(eq(proposals.id, id)) : [];
    if (!row) throw new AppError(NOT_FOUND);
    if (row.status !== "open" && row.status !== "approved") {
      throw new AppError("This proposal was declined or withdrawn, so it can no longer be endorsed.");
    }
    if ((await approvalsOf(tx, id)).some((a) => a.userId === actor.id)) {
      throw new AppError("You have already approved this, which says more than an endorsement.");
    }
    const [already] = await tx
      .select({ id: endorsements.id })
      .from(endorsements)
      .where(and(eq(endorsements.proposalId, id), eq(endorsements.userId, actor.id)));
    if (already) return;
    // The friendly check first; the database then checks the same number
    // again under a lock (see addStamp), which is what holds if the proposer
    // saves a change at this very moment.
    await checkSeen(tx, row, { revision: seen.revision }, "endorse");
    const added = await addStamp(tx, endorsements, row, { userId: actor.id, revision: seen.revision, now }, "endorse");
    // Pressed twice at the same moment, and the other press got there first:
    // their endorsement is on it, once, and the log says so once.
    if (!added) return;
    await logActivity(tx, actor.id, {
      action: "proposal.endorsed",
      entityType: "proposal",
      entityId: id,
      summary: `Endorsed: ${await titleForLog(tx, row)}`,
    });
  });
}

/** Add a comment to a proposal. Owners and Advisors. Kept word for word. */
export async function addProposalComment(actor: Actor, id: string, rawBody: unknown): Promise<string> {
  assertCan(actor, "comment");
  const body = sanitizeDoc(rawBody);
  if (isEmptyDoc(body)) throw new AppError("Write something before saving the comment.");
  return asUser(actor.id, async (tx) => {
    const [row] = isUuid(id) ? await tx.select().from(proposals).where(eq(proposals.id, id)) : [];
    if (!row) throw new AppError(NOT_FOUND);
    const [created] = await tx
      .insert(comments)
      .values({ proposalId: id, body, bodyText: docToText(body), createdBy: actor.id })
      .returning({ id: comments.id });
    await logActivity(tx, actor.id, {
      action: "comment.added",
      entityType: "proposal",
      entityId: id,
      summary: `Commented on the proposal: ${await titleForLog(tx, row)}`,
      data: { commentId: created.id },
    });
    return created.id;
  });
}
