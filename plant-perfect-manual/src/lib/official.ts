import { asc, desc, eq } from "drizzle-orm";
import { type Queryable, asUser } from "@/db/client";
import { approvals, officialVersions, sections, users } from "@/db/schema";
import { logActivity } from "./activity";
import { type Actor, AppError, assertCan } from "./permissions";
import { type RichDoc, docToText, sameDoc, sanitizeDoc } from "./richtext";
import { formatDate } from "./time";

export type OfficialApproval = { userId: string; name: string; at: Date };

export type OfficialView = {
  id: string;
  version: number;
  content: RichDoc;
  savedAt: Date;
  approvals: OfficialApproval[];
};

/** The current (latest) official text of a section, or null if none was ever saved. */
export async function loadOfficial(q: Queryable, sectionId: string): Promise<OfficialView | null> {
  const [latest] = await q
    .select()
    .from(officialVersions)
    .where(eq(officialVersions.sectionId, sectionId))
    .orderBy(desc(officialVersions.version))
    .limit(1);
  if (!latest) return null;
  const approvedBy = await q
    .select({ userId: approvals.userId, name: users.name, at: approvals.createdAt })
    .from(approvals)
    .innerJoin(users, eq(users.id, approvals.userId))
    .where(eq(approvals.officialVersionId, latest.id))
    .orderBy(asc(approvals.createdAt));
  return {
    id: latest.id,
    version: latest.version,
    content: latest.content as RichDoc,
    savedAt: latest.createdAt,
    approvals: approvedBy,
  };
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

/**
 * Save new official text directly ("Edit official").
 *
 * Nothing becomes official without a recorded approval, so a direct edit is
 * recorded as a new version approved by the owner who saved it. Old versions
 * are kept forever.
 */
export async function saveOfficial(
  actor: Actor,
  sectionId: string,
  rawDoc: unknown,
): Promise<{ changed: boolean; version: number | null }> {
  assertCan(actor, "edit_official");
  assertCan(actor, "approve");
  const content = sanitizeDoc(rawDoc);
  const contentText = docToText(content);

  return asUser(actor.id, async (tx) => {
    const [section] = await tx.select().from(sections).where(eq(sections.id, sectionId));
    if (!section || section.archivedAt) {
      throw new AppError("That section no longer exists. Reload the page and try again.");
    }
    const current = await loadOfficial(tx, sectionId);
    if (current && sameDoc(current.content, content)) {
      return { changed: false, version: current.version };
    }
    if (!current && contentText.length === 0) {
      return { changed: false, version: null };
    }

    const now = new Date();
    const version = (current?.version ?? 0) + 1;
    const [saved] = await tx
      .insert(officialVersions)
      .values({ sectionId, version, content, contentText, createdAt: now, createdBy: actor.id })
      .returning({ id: officialVersions.id })
      .catch((error: unknown) => {
        // Two people saved the same section at the same moment.
        if (isUniqueViolation(error)) {
          throw new AppError(
            "Someone else saved this text a moment ago. Your changes are still here. Copy them, reload the page, and add them to the new version.",
          );
        }
        throw error;
      });
    await tx
      .insert(approvals)
      .values({ officialVersionId: saved.id, userId: actor.id, createdAt: now });
    await tx
      .update(sections)
      .set({ updatedAt: now, updatedBy: actor.id })
      .where(eq(sections.id, sectionId));
    await logActivity(tx, actor.id, {
      action: "official.saved",
      entityType: "section",
      entityId: sectionId,
      summary: `Saved official text for "${section.title}" (version ${version}), approved by ${actor.name}`,
      data: { officialVersionId: saved.id, version },
    });
    return { changed: true, version };
  });
}
