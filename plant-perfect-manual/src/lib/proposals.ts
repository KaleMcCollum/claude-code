import { type SQL, and, asc, count, desc, eq, exists, inArray, isNull, max, ne, notExists, sql } from "drizzle-orm";
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
import { addVersion, approvalLine, joinNames, latestVersionRow, lockSection } from "./official";
import { type Actor, AppError, assertCan, can } from "./permissions";
import { type RichDoc, docToText, isEmptyDoc, sameDoc, sanitizeDoc } from "./richtext";
import {
  MAX_DEPTH,
  type SectionNode,
  archiveSectionIn,
  checkSectionTitle,
  createSectionIn,
  findNode,
  flattenTree,
  isUuid,
  loadTree,
  moveProblem,
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
  businessTag: BusinessTag | null;
  proposedOfficial: RichDoc | null;
  /** The official version the text was written against (null if there was none). */
  baseVersionId: string | null;
  structureChange: StructureChange | null;
  /** For an approved "add a section": the section that was created. */
  createdSectionId: string | null;
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
const decider = alias(users, "decider");

type ProposalRow = typeof proposals.$inferSelect;

// ---------------------------------------------------------------- reading

function selectProposals(q: Queryable) {
  return q
    .select({ row: proposals, proposedByName: proposer.name, decidedByName: decider.name })
    .from(proposals)
    .leftJoin(proposer, eq(proposer.id, proposals.proposedBy))
    .leftJoin(decider, eq(decider.id, proposals.decidedBy));
}

type Joined = { row: ProposalRow; proposedByName: string | null; decidedByName: string | null };

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

  return joined.map(({ row, proposedByName, decidedByName }) => {
    const version = versionRows.find((v) => v.proposalId === row.id);
    const pick = (list: (PersonStamp & { proposalId: string })[]) =>
      list.filter((s) => s.proposalId === row.id).map(({ userId, name, at }) => ({ userId, name, at }));
    const approvedBy = pick(approvalRows);
    return {
      id: row.id,
      type: row.type,
      title: row.title,
      description: (row.description as RichDoc | null) ?? null,
      sectionId: row.sectionId,
      businessTag: row.businessTag,
      proposedOfficial: (row.proposedOfficial as RichDoc | null) ?? null,
      baseVersionId: row.baseVersionId,
      structureChange: (row.structureChange as StructureChange | null) ?? null,
      createdSectionId: row.createdSectionId,
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
      endorsements: pick(endorsementRows),
      resultVersion: version ? { id: version.id, version: version.version } : null,
      decidedAlone: row.decidedAlone,
      soloOpen:
        row.status === "approved" &&
        row.decidedAlone &&
        !approvedBy.some((a) => a.userId !== row.decidedBy && approverIds.has(a.userId)),
      superseded:
        row.status === "approved" && version !== undefined && (newest.get(version.sectionId) ?? 0) > version.version,
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
 * approve, the open proposals they have not approved yet; for anyone else,
 * all open proposals.
 */
export async function countAwaiting(q: Queryable, actor: Actor): Promise<number> {
  const mine = q
    .select({ one: sql`1` })
    .from(approvals)
    .where(and(eq(approvals.proposalId, proposals.id), eq(approvals.userId, actor.id)));
  const [{ n }] = await q
    .select({ n: count() })
    .from(proposals)
    .where(and(eq(proposals.status, "open"), can(actor, "approve") ? notExists(mine) : undefined));
  return n;
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
 * The Decisions Log: every approved change, newest first. It is not a
 * separate record: it is the approved proposals themselves, including direct
 * edits and restores.
 */
export async function listDecisions(
  q: Queryable,
  tree: SectionNode[],
  filters: DecisionFilters = {},
  limit = 200,
): Promise<ProposalView[]> {
  let sectionIds: string[] | null = null;
  if (filters.sectionId) {
    const node = findNode(tree, filters.sectionId);
    if (!node) return [];
    sectionIds = [node, ...flattenTree(node.children)].map((n) => n.id);
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
 * Which approve buttons an open proposal shows this person.
 *  - `approve`: they have not approved yet ("Approve").
 *  - `alone`: after their approval it would still be waiting for someone
 *    else, so they may also make it official without waiting
 *    ("Approve on my own"). For the proposer this is the only one of the two.
 */
export function approveChoices(
  view: ProposalView,
  actor: Actor,
  approvers: { id: string }[],
): { approve: boolean; alone: boolean } {
  if (view.status !== "open" || !can(actor, "approve")) return { approve: false, alone: false };
  const approved = new Set(view.approvals.map((a) => a.userId));
  const mine = approved.has(actor.id);
  const counted =
    approvers.filter((owner) => owner.id !== actor.id && approved.has(owner.id)).length + 1;
  return { approve: !mine, alone: counted < 2 };
}

/** The people an open proposal is still waiting for. */
export function waitingFor(view: ProposalView, approvers: { id: string; name: string }[]): string[] {
  if (view.status !== "open") return [];
  const approved = new Set(view.approvals.map((a) => a.userId));
  return approvers.filter((owner) => !approved.has(owner.id)).map((owner) => owner.name);
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

/**
 * The title to show in lists.
 *  - A direct edit or restore has no written title, so its section is added:
 *    "Edited directly: 2.1 Wages".
 *  - A structure proposal that is still open is described from what it will
 *    actually do, with the sections' names and numbers as they are right
 *    now, never from its stored title. Once decided it keeps the title it
 *    was decided under.
 */
export function displayTitle(
  view: Pick<ProposalView, "title" | "direct" | "sectionId" | "type" | "status" | "structureChange">,
  tree: SectionNode[],
): string {
  if (view.direct) return `${view.title}: ${sectionLabel(tree, view.sectionId)}`;
  if (view.type === "structure" && view.status === "open" && view.structureChange) {
    return describeStructure(tree, view.sectionId, view.structureChange);
  }
  return view.title;
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

/** Proposals (not direct edits) made from each of these notes. */
export async function proposalsForNotes(
  q: Queryable,
  noteIds: string[],
): Promise<Map<string, { id: string; title: string; status: ProposalStatus }[]>> {
  const result = new Map<string, { id: string; title: string; status: ProposalStatus }[]>();
  if (noteIds.length === 0) return result;
  const rows = await q
    .select({ noteId: proposalNotes.noteId, id: proposals.id, title: proposals.title, status: proposals.status })
    .from(proposalNotes)
    .innerJoin(proposals, eq(proposals.id, proposalNotes.proposalId))
    .where(inArray(proposalNotes.noteId, noteIds))
    .orderBy(asc(proposals.createdAt), asc(proposals.id));
  for (const { noteId, ...proposal } of rows) {
    result.set(noteId, [...(result.get(noteId) ?? []), proposal]);
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

function sectionLabel(tree: SectionNode[], id: string | null): string {
  if (!id) return "the top level";
  const node = findNode(tree, id);
  return node ? `${node.number} ${node.title}` : "a section that has been archived";
}

/**
 * One plain sentence saying what a structure proposal does, using the
 * sections' names and numbers as they are right now.
 */
export function describeStructure(
  tree: SectionNode[],
  sectionId: string | null,
  change: StructureChange,
): string {
  const known = readStructureChange(change);
  if (!known) return UNREADABLE_CHANGE_SENTENCE;
  switch (known.action) {
    case "add":
      return sectionId
        ? `Add a section "${known.title}" under ${sectionLabel(tree, sectionId)}`
        : `Add a top-level section "${known.title}"`;
    case "rename":
      return `Rename ${sectionLabel(tree, sectionId)} to "${known.title}"`;
    case "move":
      return known.parentId
        ? `Move ${sectionLabel(tree, sectionId)} under ${sectionLabel(tree, known.parentId)}`
        : `Move ${sectionLabel(tree, sectionId)} to the top level`;
    case "archive":
      return `Archive ${sectionLabel(tree, sectionId)}`;
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
  baseVersionId: string | null;
  structureChange: StructureChange | null;
};

/** Check a new or edited proposal against the sections and official text as they are now. */
async function prepare(tx: Tx, input: ProposalInput): Promise<Prepared> {
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

/** What the database answers (SQLSTATE) when an approval or endorsement names an out-of-date revision. */
const STALE_REVISION = "PPF01";

function changedAfterOpening(who: string, verb: string): string {
  return `${who} changed this proposal after you opened it. Reload the page and read it again, then ${verb}.`;
}

/** Refuse to act on a page that no longer shows what would be approved. */
async function checkSeen(tx: Tx, row: ProposalRow, seen: Seen, verb: string): Promise<void> {
  if (seen.revision !== row.revision) {
    throw new AppError(changedAfterOpening(await nameOf(tx, row.proposedBy), verb));
  }
  if (row.type !== "structure" && row.sectionId && seen.currentVersionId !== undefined) {
    const current = await latestVersionRow(tx, row.sectionId);
    if ((current?.id ?? null) !== seen.currentVersionId) {
      throw new AppError(
        `The official text of this section changed after you opened this page. Reload the page and read it again, then ${verb}.`,
      );
    }
  }
}

async function approvalsOf(tx: Tx, proposalId: string): Promise<{ userId: string }[]> {
  return tx.select({ userId: approvals.userId }).from(approvals).where(eq(approvals.proposalId, proposalId));
}

/**
 * Record an approval or an endorsement, tied to the proposal revision the
 * person had in front of them. The database checks that number against the
 * proposal while holding a lock on it, so even when the proposer saves a
 * change at the very same moment, nobody's name ends up on words they did
 * not see: whichever of the two comes second is refused.
 */
async function addStamp(
  tx: Tx,
  table: typeof approvals | typeof endorsements,
  row: Pick<ProposalRow, "id" | "proposedBy">,
  stamp: { userId: string; revision: number; now: Date },
  verb: string,
): Promise<void> {
  // Looked up first: once the database has refused a row, nothing more can
  // be read in this transaction.
  const proposerName = await nameOf(tx, row.proposedBy);
  await tx
    .insert(table)
    .values({ proposalId: row.id, userId: stamp.userId, revision: stamp.revision, createdAt: stamp.now })
    .catch((error: unknown) => {
      if (sqlState(error) === STALE_REVISION) throw new AppError(changedAfterOpening(proposerName, verb));
      throw error;
    });
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
    const prepared = await prepare(tx, input);
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
 * Change an open proposal. Only its proposer can, and only until someone
 * else has approved or endorsed it (after that: withdraw and propose again,
 * so nobody's approval ends up on words they did not see).
 */
export async function editProposal(actor: Actor, id: string, input: ProposalInput): Promise<void> {
  assertCan(actor, "propose");
  await asUser(actor.id, async (tx) => {
    const row = await lockProposal(tx, id);
    requireOpen(row);
    if (row.proposedBy !== actor.id) {
      throw new AppError("Only the person who made a proposal can change it. You can comment on it, or decline it.");
    }
    const others =
      (await approvalsOf(tx, id)).some((a) => a.userId !== actor.id) ||
      (
        await tx
          .select({ userId: endorsements.userId })
          .from(endorsements)
          .where(and(eq(endorsements.proposalId, id), ne(endorsements.userId, actor.id)))
      ).length > 0;
    if (others) {
      throw new AppError(
        "Someone has already approved or endorsed this proposal, so it can no longer be changed. Withdraw it and make a new one.",
      );
    }
    const expectedKind = row.type === "structure" ? "structure" : row.type;
    if (input.kind !== expectedKind) {
      throw new AppError("The kind of a proposal cannot be changed. Withdraw it and make a new one.");
    }
    const prepared = await prepare(tx, input);
    if (prepared.type !== "structure" && prepared.sectionId !== row.sectionId) {
      throw new AppError("The section of a proposal cannot be changed. Withdraw it and make a new one.");
    }
    if (prepared.type === "structure") {
      const before = row.structureChange as StructureChange;
      if (prepared.structureChange!.action !== before.action || prepared.sectionId !== row.sectionId) {
        throw new AppError("What a structure proposal is about cannot be changed. Withdraw it and make a new one.");
      }
    }
    const same =
      prepared.title === row.title &&
      prepared.descriptionText === row.descriptionText &&
      JSON.stringify(prepared.structureChange) === JSON.stringify(row.structureChange) &&
      prepared.businessTag === row.businessTag &&
      (prepared.description === null
        ? row.description === null
        : row.description !== null && sameDoc(prepared.description, row.description as RichDoc)) &&
      (prepared.proposedOfficial === null ||
        (row.proposedOfficial !== null && sameDoc(prepared.proposedOfficial, row.proposedOfficial as RichDoc)));
    if (same) return;
    await tx
      .update(proposals)
      .set({
        title: prepared.title,
        description: prepared.description,
        descriptionText: prepared.descriptionText,
        businessTag: prepared.businessTag,
        proposedOfficial: prepared.proposedOfficial,
        proposedOfficialText: prepared.proposedOfficialText,
        baseVersionId: prepared.baseVersionId,
        structureChange: prepared.structureChange,
      })
      .where(eq(proposals.id, id));
    await logActivity(tx, actor.id, {
      action: "proposal.edited",
      entityType: "proposal",
      entityId: id,
      summary: `Changed their proposal: ${prepared.title}`,
      data: { revision: row.revision + 1 },
    });
  });
}

// --------------------------------------------------------------- deciding

/**
 * Mark the proposal approved and apply its change, in the transaction that
 * is already open. If the change cannot be applied, the error undoes
 * everything, including the approval just recorded.
 */
async function finalize(tx: Tx, actor: Actor, row: ProposalRow, now: Date): Promise<void> {
  const decided = { status: "approved" as const, decidedAt: now, decidedBy: actor.id };

  if (row.type === "structure") {
    // Checked, never guessed: a change the app cannot read changes nothing.
    const change = readStructureChange(row.structureChange);
    if (!change) throw new AppError(UNREADABLE_CHANGE);
    const tree = await loadTree(tx);
    if (change.action === "add") {
      if (row.sectionId && !findNode(tree, row.sectionId)) throw new AppError(SECTION_GONE);
      const createdSectionId = await createSectionIn(tx, actor, { parentId: row.sectionId, title: change.title });
      await tx.update(proposals).set({ ...decided, createdSectionId }).where(eq(proposals.id, row.id));
    } else {
      if (!row.sectionId || !findNode(tree, row.sectionId)) throw new AppError(SECTION_GONE);
      switch (change.action) {
        case "rename":
          await renameSectionIn(tx, actor, row.sectionId, change.title);
          break;
        case "move":
          await moveSectionToIn(tx, actor, row.sectionId, change.parentId);
          break;
        case "archive":
          await archiveSectionIn(tx, actor, row.sectionId);
          break;
        default: {
          // A kind of change added later must be handled here on purpose.
          const unhandled: never = change;
          void unhandled;
          throw new AppError(UNREADABLE_CHANGE);
        }
      }
      await tx.update(proposals).set(decided).where(eq(proposals.id, row.id));
    }
  } else {
    const [section] = await tx.select().from(sections).where(eq(sections.id, row.sectionId!));
    if (!section || section.archivedAt || !findNode(await loadTree(tx), section.id)) {
      throw new AppError(SECTION_GONE);
    }
    await tx.update(proposals).set(decided).where(eq(proposals.id, row.id));
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
    summary: `Approved by ${joinNames(approvers.map((a) => a.name))}: ${row.title}`,
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
  await addStamp(tx, approvals, row, { userId: actor.id, revision, now }, "approve");
  return true;
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
    const added = await recordApproval(tx, actor, row, seen.revision, now);
    const owners = await activeApprovers(tx);
    const approvedBy = new Set((await approvalsOf(tx, id)).map((a) => a.userId));
    const counted = owners.filter((owner) => approvedBy.has(owner.id));
    if (counted.length >= 2) {
      await finalize(tx, actor, row, now);
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
        summary: `Approved, waiting for ${waitingFor.length > 0 ? joinNames(waitingFor) : "another Owner"}: ${row.title}`,
      });
    }
    return { approved: false, waitingFor };
  });
}

/**
 * "Approve on my own": make it official now with this Owner's approval,
 * without waiting. It is flagged on Today so the other Owner sees it.
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
    await recordApproval(tx, actor, row, seen.revision, now);
    await finalize(tx, actor, row, now);
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
      summary: `Added their approval: ${row.title}`,
    });
  });
}

/** Decline someone else's open proposal, with an optional reason. Nothing is applied. */
export async function declineProposal(
  actor: Actor,
  id: string,
  reason: unknown,
  options: { now?: Date } = {},
): Promise<void> {
  assertCan(actor, "approve");
  const text = typeof reason === "string" ? reason.trim() : "";
  if (text.length > MAX_REASON_LENGTH) {
    throw new AppError(`Keep the reason under ${MAX_REASON_LENGTH} characters, or leave a comment instead.`);
  }
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
    await addStamp(tx, endorsements, row, { userId: actor.id, revision: seen.revision, now }, "endorse");
    await logActivity(tx, actor.id, {
      action: "proposal.endorsed",
      entityType: "proposal",
      entityId: id,
      summary: `Endorsed: ${row.title}`,
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
      summary: `Commented on the proposal: ${row.title}`,
      data: { commentId: created.id },
    });
    return created.id;
  });
}
