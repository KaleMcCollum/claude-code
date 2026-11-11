import { type SQL, and, asc, count, desc, eq, exists, inArray, isNull, ne, notExists, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { type Queryable, type Tx, asUser } from "@/db/client";
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
import { addVersion, joinNames, latestVersionRow } from "./official";
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
import { addDays, centralDateKey } from "./time";

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
 *    add "I approve too" at any time.
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
    .select({ id: officialVersions.id, version: officialVersions.version, proposalId: officialVersions.proposalId })
    .from(officialVersions)
    .where(inArray(officialVersions.proposalId, ids));

  return joined.map(({ row, proposedByName, decidedByName }) => {
    const version = versionRows.find((v) => v.proposalId === row.id);
    const pick = (list: (PersonStamp & { proposalId: string })[]) =>
      list.filter((s) => s.proposalId === row.id).map(({ userId, name, at }) => ({ userId, name, at }));
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
      approvals: pick(approvalRows),
      endorsements: pick(endorsementRows),
      resultVersion: version ? { id: version.id, version: version.version } : null,
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
 * in the last 14 days (US Central days), with exactly one approval, while at
 * least one other person who can approve has not approved. A change to
 * official text is listed only while it is still that section's current text.
 */
export async function listOneOwnerDecisions(q: Queryable, now: Date = new Date()): Promise<ProposalView[]> {
  const since = addDays(centralDateKey(now), -SOLO_FLAG_DAYS);
  const rows = await selectProposals(q)
    .where(and(eq(proposals.status, "approved"), sql`${centralDay(proposals.decidedAt)} >= ${since}::date`))
    .orderBy(desc(proposals.decidedAt), desc(proposals.id));
  const views = await toViews(q, rows);
  const owners = await activeApprovers(q);
  const latest = new Map<string, number>();
  for (const row of await q
    .select({ sectionId: officialVersions.sectionId, version: officialVersions.version })
    .from(officialVersions)) {
    latest.set(row.sectionId, Math.max(latest.get(row.sectionId) ?? 0, row.version));
  }
  return views.filter((view) => {
    if (view.approvals.length !== 1) return false;
    if (!owners.some((owner) => owner.id !== view.approvals[0].userId)) return false;
    if (view.type === "structure") return true;
    return (
      view.resultVersion !== null &&
      view.sectionId !== null &&
      latest.get(view.sectionId) === view.resultVersion.version
    );
  });
}

/** True when an approved proposal has one approval and `actor` could add theirs. */
export function canApproveToo(view: ProposalView, actor: Actor): boolean {
  return (
    view.status === "approved" &&
    can(actor, "approve") &&
    view.approvals.length === 1 &&
    !view.approvals.some((a) => a.userId === actor.id)
  );
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
  switch (change.action) {
    case "add":
      return sectionId
        ? `Add a section "${change.title}" under ${sectionLabel(tree, sectionId)}`
        : `Add a top-level section "${change.title}"`;
    case "rename":
      return `Rename ${sectionLabel(tree, sectionId)} to "${change.title}"`;
    case "move":
      return change.parentId
        ? `Move ${sectionLabel(tree, sectionId)} under ${sectionLabel(tree, change.parentId)}`
        : `Move ${sectionLabel(tree, sectionId)} to the top level`;
    case "archive":
      return `Archive ${sectionLabel(tree, sectionId)}`;
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

/** Refuse to act on a page that no longer shows what would be approved. */
async function checkSeen(tx: Tx, row: ProposalRow, seen: Seen, verb: string): Promise<void> {
  if (seen.revision !== row.revision) {
    throw new AppError(
      `${await nameOf(tx, row.proposedBy)} changed this proposal after you opened it. Reload the page and read it again, then ${verb}.`,
    );
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
    // Proposing counts as approving.
    await tx.insert(approvals).values({ proposalId: created.id, userId: actor.id, createdAt: now });
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
    const change = row.structureChange as StructureChange;
    const tree = await loadTree(tx);
    if (change.action === "add") {
      if (row.sectionId && !findNode(tree, row.sectionId)) throw new AppError(SECTION_GONE);
      const createdSectionId = await createSectionIn(tx, actor, { parentId: row.sectionId, title: change.title });
      await tx.update(proposals).set({ ...decided, createdSectionId }).where(eq(proposals.id, row.id));
    } else {
      if (!row.sectionId || !findNode(tree, row.sectionId)) throw new AppError(SECTION_GONE);
      if (change.action === "rename") await renameSectionIn(tx, actor, row.sectionId, change.title);
      else if (change.action === "move") await moveSectionToIn(tx, actor, row.sectionId, change.parentId);
      else await archiveSectionIn(tx, actor, row.sectionId);
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

async function recordApproval(tx: Tx, actor: Actor, proposalId: string, now: Date): Promise<boolean> {
  if ((await approvalsOf(tx, proposalId)).some((a) => a.userId === actor.id)) return false;
  await tx.insert(approvals).values({ proposalId, userId: actor.id, createdAt: now });
  return true;
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
    await checkSeen(tx, row, seen, "approve");
    await recordApproval(tx, actor, id, now);
    const owners = await activeApprovers(tx);
    const approvedBy = new Set((await approvalsOf(tx, id)).map((a) => a.userId));
    const counted = owners.filter((owner) => approvedBy.has(owner.id));
    if (counted.length >= 2) {
      await finalize(tx, actor, row, now);
      return { approved: true, waitingFor: [] };
    }
    const waitingFor = owners.filter((owner) => !approvedBy.has(owner.id)).map((owner) => owner.name);
    await logActivity(tx, actor.id, {
      action: "proposal.approval_added",
      entityType: "proposal",
      entityId: id,
      summary: `Approved, waiting for ${waitingFor.length > 0 ? joinNames(waitingFor) : "another Owner"}: ${row.title}`,
    });
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
    await checkSeen(tx, row, seen, "approve");
    await recordApproval(tx, actor, id, now);
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
    if (!(await recordApproval(tx, actor, id, now))) return;
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
    const [row] = isUuid(id) ? await tx.select().from(proposals).where(eq(proposals.id, id)) : [];
    if (!row) throw new AppError(NOT_FOUND);
    if (row.status !== "open" && row.status !== "approved") {
      throw new AppError("This proposal was declined or withdrawn, so it can no longer be endorsed.");
    }
    if (row.status === "open") await checkSeen(tx, row, { revision: seen.revision }, "endorse");
    if ((await approvalsOf(tx, id)).some((a) => a.userId === actor.id)) {
      throw new AppError("You have already approved this, which says more than an endorsement.");
    }
    const [already] = await tx
      .select({ id: endorsements.id })
      .from(endorsements)
      .where(and(eq(endorsements.proposalId, id), eq(endorsements.userId, actor.id)));
    if (already) return;
    await tx.insert(endorsements).values({ proposalId: id, userId: actor.id, createdAt: now });
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
