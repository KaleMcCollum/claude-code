import { asc, desc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { type Queryable, type Tx, asUser } from "@/db/client";
import { approvals, endorsements, officialVersions, proposals, sections, users } from "@/db/schema";
import { logActivity } from "./activity";
import { type Actor, AppError, assertCan } from "./permissions";
import { type RichDoc, docToText, sameDoc, sanitizeDoc } from "./richtext";
import { isUuid } from "./sections";
import { formatDate } from "./time";

/**
 * Official text.
 *
 * Every version of a section's Official block comes from exactly one
 * approved proposal. Who approved and who endorsed are read from that
 * proposal, never copied onto the version. A direct "Edit official" save,
 * and restoring an earlier version, are proposals approved on the spot by
 * the Owner who did it (one approval), so nothing ever becomes official
 * without a recorded approval.
 */

export type OfficialApproval = { userId: string; name: string; at: Date };

/** How a version came to be. */
export type VersionOrigin = "proposal" | "direct" | "restored";

export type OfficialView = {
  id: string;
  version: number;
  content: RichDoc;
  /** When this version became official. */
  savedAt: Date;
  /** The proposal behind this version (approvals and endorsements hang off it). */
  proposalId: string;
  proposalTitle: string;
  origin: VersionOrigin;
  /** For a restore: the number of the version whose text was brought back. */
  restoredFromVersion: number | null;
  /** Who proposed the change (for a direct edit or restore: who did it). */
  proposedByName: string | null;
  approvals: OfficialApproval[];
  endorsements: OfficialApproval[];
};

/** Titles the app gives to changes made without a written proposal. */
export const DIRECT_EDIT_TITLE = "Edited directly";
export const restoredTitle = (version: number) => `Restored version ${version}`;

const GONE = "That section no longer exists. Reload the page and try again.";
const CHANGED_MEANWHILE =
  "Someone else changed this official text after you opened it. Your text is still here. Copy what you need, reload the page to see the new text, and make your change again.";

type VersionRow = typeof officialVersions.$inferSelect;

async function toViews(q: Queryable, rows: VersionRow[]): Promise<OfficialView[]> {
  if (rows.length === 0) return [];
  const proposalIds = rows.map((row) => row.proposalId);
  const proposer = alias(users, "proposer");
  const proposalRows = await q
    .select({
      id: proposals.id,
      title: proposals.title,
      direct: proposals.direct,
      proposedByName: proposer.name,
    })
    .from(proposals)
    .leftJoin(proposer, eq(proposer.id, proposals.proposedBy))
    .where(inArray(proposals.id, proposalIds));
  const approvalRows = await q
    .select({
      proposalId: approvals.proposalId,
      userId: approvals.userId,
      name: users.name,
      at: approvals.createdAt,
    })
    .from(approvals)
    .innerJoin(users, eq(users.id, approvals.userId))
    .where(inArray(approvals.proposalId, proposalIds))
    .orderBy(asc(approvals.createdAt), asc(approvals.id));
  const endorsementRows = await q
    .select({
      proposalId: endorsements.proposalId,
      userId: endorsements.userId,
      name: users.name,
      at: endorsements.createdAt,
    })
    .from(endorsements)
    .innerJoin(users, eq(users.id, endorsements.userId))
    .where(inArray(endorsements.proposalId, proposalIds))
    .orderBy(asc(endorsements.createdAt), asc(endorsements.id));

  const restoredIds = rows.map((row) => row.restoredFromVersionId).filter((id): id is string => id !== null);
  const restoredNumbers =
    restoredIds.length === 0
      ? []
      : await q
          .select({ id: officialVersions.id, version: officialVersions.version })
          .from(officialVersions)
          .where(inArray(officialVersions.id, restoredIds));

  return rows.map((row) => {
    const proposal = proposalRows.find((p) => p.id === row.proposalId);
    const restoredFrom = restoredNumbers.find((r) => r.id === row.restoredFromVersionId)?.version ?? null;
    const pick = (list: (OfficialApproval & { proposalId: string })[]) =>
      list
        .filter((item) => item.proposalId === row.proposalId)
        .map(({ userId, name, at }) => ({ userId, name, at }));
    return {
      id: row.id,
      version: row.version,
      content: row.content as RichDoc,
      savedAt: row.createdAt,
      proposalId: row.proposalId,
      proposalTitle: proposal?.title ?? "",
      origin: row.restoredFromVersionId ? "restored" : proposal?.direct ? "direct" : "proposal",
      restoredFromVersion: restoredFrom,
      proposedByName: proposal?.proposedByName ?? null,
      approvals: pick(approvalRows),
      endorsements: pick(endorsementRows),
    };
  });
}

/** The newest version row of a section, if it has any official text. */
export async function latestVersionRow(q: Queryable, sectionId: string): Promise<VersionRow | null> {
  const [latest] = await q
    .select()
    .from(officialVersions)
    .where(eq(officialVersions.sectionId, sectionId))
    .orderBy(desc(officialVersions.version))
    .limit(1);
  return latest ?? null;
}

/** The current (latest) official text of a section, or null if none was ever saved. */
export async function loadOfficial(q: Queryable, sectionId: string): Promise<OfficialView | null> {
  const latest = await latestVersionRow(q, sectionId);
  return latest ? (await toViews(q, [latest]))[0] : null;
}

/** Every version a section's official text has had, newest first. */
export async function listVersions(q: Queryable, sectionId: string): Promise<OfficialView[]> {
  const rows = await q
    .select()
    .from(officialVersions)
    .where(eq(officialVersions.sectionId, sectionId))
    .orderBy(desc(officialVersions.version));
  return toViews(q, rows);
}

function isUniqueViolation(error: unknown): boolean {
  for (let e = error as { code?: string; cause?: unknown } | undefined, i = 0; e && i < 5; i += 1) {
    if (e.code === "23505") return true;
    e = e.cause as { code?: string; cause?: unknown } | undefined;
  }
  return false;
}

/** "Kale", "Kale and Casey", "Kale, Casey and Sam" */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** "Approved by Kale and Casey, Nov 12, 2026" (the date of the last approval). */
export function approvalLine(list: OfficialApproval[]): string | null {
  if (list.length === 0) return null;
  const latest = list.reduce((a, b) => (b.at > a.at ? b : a));
  return `Approved by ${joinNames(list.map((a) => a.name))}, ${formatDate(latest.at)}`;
}

/** "Endorsed by Karen, Nov 13, 2026" */
export function endorsementLine(endorsement: OfficialApproval): string {
  return `Endorsed by ${endorsement.name}, ${formatDate(endorsement.at)}`;
}

/**
 * Save the text of an approved proposal as the section's next official
 * version. The proposal must already be marked approved in this same
 * transaction: the database checks that, and that the text is exactly the
 * proposal's text.
 */
export async function addVersion(
  tx: Tx,
  actor: Actor,
  input: {
    sectionId: string;
    proposalId: string;
    content: RichDoc;
    now: Date;
    restoredFromVersionId?: string | null;
  },
): Promise<{ id: string; version: number }> {
  const latest = await latestVersionRow(tx, input.sectionId);
  const version = (latest?.version ?? 0) + 1;
  const [saved] = await tx
    .insert(officialVersions)
    .values({
      sectionId: input.sectionId,
      version,
      content: input.content,
      contentText: docToText(input.content),
      createdAt: input.now,
      createdBy: actor.id,
      proposalId: input.proposalId,
      restoredFromVersionId: input.restoredFromVersionId ?? null,
    })
    .returning({ id: officialVersions.id })
    .catch((error: unknown) => {
      // Two changes to the same section landed at the same moment.
      if (isUniqueViolation(error)) throw new AppError(CHANGED_MEANWHILE);
      throw error;
    });
  await tx
    .update(sections)
    .set({ updatedAt: input.now, updatedBy: actor.id })
    .where(eq(sections.id, input.sectionId));
  return { id: saved.id, version };
}

/**
 * Make `content` official at once, as a change approved by `actor` alone.
 * Used by "Edit official" and by restoring an earlier version.
 */
async function saveDirectly(
  tx: Tx,
  actor: Actor,
  input: {
    sectionId: string;
    title: string;
    content: RichDoc;
    baseVersionId: string | null;
    restoredFromVersionId?: string | null;
    now: Date;
  },
): Promise<{ id: string; version: number; proposalId: string }> {
  const { now } = input;
  const [proposal] = await tx
    .insert(proposals)
    .values({
      type: "official_text",
      title: input.title,
      sectionId: input.sectionId,
      proposedOfficial: input.content,
      proposedOfficialText: docToText(input.content),
      baseVersionId: input.baseVersionId,
      direct: true,
      proposedBy: actor.id,
      createdAt: now,
      updatedAt: now,
      updatedBy: actor.id,
    })
    .returning({ id: proposals.id });
  await tx.insert(approvals).values({ proposalId: proposal.id, userId: actor.id, createdAt: now });
  await tx
    .update(proposals)
    .set({ status: "approved", decidedAt: now, decidedBy: actor.id })
    .where(eq(proposals.id, proposal.id));
  const saved = await addVersion(tx, actor, {
    sectionId: input.sectionId,
    proposalId: proposal.id,
    content: input.content,
    now,
    restoredFromVersionId: input.restoredFromVersionId,
  });
  return { ...saved, proposalId: proposal.id };
}

/**
 * "Edit official": save new official text directly, approved by the Owner
 * who saves it (flagged on Today for the other Owner). Old versions are kept.
 *
 * `baseVersionId` is the version the person had on screen when they started
 * (null if there was none). If someone else has changed the text since, the
 * save is refused so their change is not silently undone.
 */
export async function saveOfficial(
  actor: Actor,
  sectionId: string,
  rawDoc: unknown,
  options: { baseVersionId?: string | null; now?: Date } = {},
): Promise<{ changed: boolean; version: number | null }> {
  assertCan(actor, "edit_official");
  assertCan(actor, "approve");
  const content = sanitizeDoc(rawDoc);
  const contentText = docToText(content);
  const now = options.now ?? new Date();

  return asUser(actor.id, async (tx) => {
    const [section] = isUuid(sectionId)
      ? await tx.select().from(sections).where(eq(sections.id, sectionId))
      : [];
    if (!section || section.archivedAt) throw new AppError(GONE);
    const current = await latestVersionRow(tx, sectionId);
    if (options.baseVersionId !== undefined && (current?.id ?? null) !== options.baseVersionId) {
      throw new AppError(CHANGED_MEANWHILE);
    }
    if (current && sameDoc(current.content as RichDoc, content)) {
      return { changed: false, version: current.version };
    }
    if (!current && contentText.length === 0) {
      return { changed: false, version: null };
    }

    const saved = await saveDirectly(tx, actor, {
      sectionId,
      title: DIRECT_EDIT_TITLE,
      content,
      baseVersionId: current?.id ?? null,
      now,
    });
    await logActivity(tx, actor.id, {
      action: "official.saved",
      entityType: "section",
      entityId: sectionId,
      summary: `Saved official text for "${section.title}" (version ${saved.version}), approved by ${actor.name}`,
      data: { officialVersionId: saved.id, version: saved.version, proposalId: saved.proposalId },
    });
    return { changed: true, version: saved.version };
  });
}

/**
 * Bring back the text of an earlier version. Nothing is overwritten: this
 * adds a new version with the old text, approved by the Owner who restores.
 *
 * `currentVersionId` is the newest version the person saw on the history
 * page; if a newer one exists by now, the restore is refused.
 */
export async function restoreVersion(
  actor: Actor,
  sectionId: string,
  versionId: string,
  options: { currentVersionId: string | null; now?: Date },
): Promise<{ version: number }> {
  assertCan(actor, "edit_official");
  assertCan(actor, "approve");
  const now = options.now ?? new Date();
  return asUser(actor.id, async (tx) => {
    const [section] = isUuid(sectionId)
      ? await tx.select().from(sections).where(eq(sections.id, sectionId))
      : [];
    if (!section || section.archivedAt) throw new AppError(GONE);
    const [old] = isUuid(versionId)
      ? await tx.select().from(officialVersions).where(eq(officialVersions.id, versionId))
      : [];
    if (!old || old.sectionId !== sectionId) {
      throw new AppError("That version could not be found. Reload the page and try again.");
    }
    const current = await latestVersionRow(tx, sectionId);
    if ((current?.id ?? null) !== options.currentVersionId) {
      throw new AppError(
        "The official text was changed after you opened this page. Reload it to see the newest version, then restore again if you still want to.",
      );
    }
    if (current && sameDoc(current.content as RichDoc, old.content as RichDoc)) {
      throw new AppError("That is already what the official text says.");
    }
    const saved = await saveDirectly(tx, actor, {
      sectionId,
      title: restoredTitle(old.version),
      content: old.content as RichDoc,
      baseVersionId: current?.id ?? null,
      restoredFromVersionId: old.id,
      now,
    });
    await logActivity(tx, actor.id, {
      action: "official.restored",
      entityType: "section",
      entityId: sectionId,
      summary: `Restored version ${old.version} of the official text for "${section.title}" as version ${saved.version}, approved by ${actor.name}`,
      data: {
        officialVersionId: saved.id,
        version: saved.version,
        restoredFromVersion: old.version,
        proposalId: saved.proposalId,
      },
    });
    return { version: saved.version };
  });
}
