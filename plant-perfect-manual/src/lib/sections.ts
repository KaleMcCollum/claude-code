import { eq, isNotNull, isNull, max } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { type Queryable, type Tx, asUser } from "@/db/client";
import { sections, users } from "@/db/schema";
import { logActivity } from "./activity";
import { type Actor, AppError, assertCan } from "./permissions";

export const MAX_DEPTH = 3;
export const MAX_TITLE_LENGTH = 120;

export type SectionNode = {
  id: string;
  parentId: string | null;
  title: string;
  /** "2", "2.1", "2.1.3": worked out from the order, never stored. */
  number: string;
  depth: number;
  updatedAt: Date;
  updatedBy: string | null;
  children: SectionNode[];
};

type TreeRow = Pick<
  typeof sections.$inferSelect,
  "id" | "parentId" | "title" | "position" | "archivedAt" | "createdAt" | "updatedAt" | "updatedBy"
>;

/**
 * Turn section rows into the numbered tree. Archived sections, and
 * everything under them, are left out.
 */
export function buildTree(rows: TreeRow[]): SectionNode[] {
  const byParent = new Map<string | null, TreeRow[]>();
  for (const row of rows) {
    if (row.archivedAt) continue;
    const list = byParent.get(row.parentId) ?? [];
    list.push(row);
    byParent.set(row.parentId, list);
  }
  const build = (parentId: string | null, prefix: string, depth: number): SectionNode[] =>
    (byParent.get(parentId) ?? [])
      .sort(
        (a, b) =>
          a.position - b.position ||
          a.createdAt.getTime() - b.createdAt.getTime() ||
          a.id.localeCompare(b.id),
      )
      .map((row, index) => {
        const number = prefix ? `${prefix}.${index + 1}` : `${index + 1}`;
        return {
          id: row.id,
          parentId: row.parentId,
          title: row.title,
          number,
          depth,
          updatedAt: row.updatedAt,
          updatedBy: row.updatedBy,
          children: build(row.id, number, depth + 1),
        };
      });
  return build(null, "", 1);
}

export async function loadTree(q: Queryable): Promise<SectionNode[]> {
  const rows = await q
    .select({
      id: sections.id,
      parentId: sections.parentId,
      title: sections.title,
      position: sections.position,
      archivedAt: sections.archivedAt,
      createdAt: sections.createdAt,
      updatedAt: sections.updatedAt,
      updatedBy: sections.updatedBy,
    })
    .from(sections);
  return buildTree(rows);
}

/** The node with this id plus its ancestors, top level first. Empty if not in the tree. */
export function pathTo(tree: SectionNode[], id: string): SectionNode[] {
  for (const node of tree) {
    if (node.id === id) return [node];
    const below = pathTo(node.children, id);
    if (below.length > 0) return [node, ...below];
  }
  return [];
}

export function findNode(tree: SectionNode[], id: string): SectionNode | null {
  return pathTo(tree, id).at(-1) ?? null;
}

export function flattenTree(tree: SectionNode[]): SectionNode[] {
  return tree.flatMap((node) => [node, ...flattenTree(node.children)]);
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function cleanTitle(input: string): string {
  const title = input.replace(/\s+/g, " ").trim();
  if (!title) throw new AppError("Enter a name for the section.");
  if (title.length > MAX_TITLE_LENGTH) {
    throw new AppError(`Section names can be up to ${MAX_TITLE_LENGTH} characters.`);
  }
  return title;
}

function label(node: Pick<SectionNode, "number" | "title">): string {
  return `${node.number} ${node.title}`;
}

const GONE = "That section no longer exists. Reload the page and try again.";

async function nextPosition(tx: Tx, parentId: string | null): Promise<number> {
  const [row] = await tx
    .select({ last: max(sections.position) })
    .from(sections)
    .where(parentId ? eq(sections.parentId, parentId) : isNull(sections.parentId));
  return (row?.last ?? 0) + 1;
}

/**
 * The structure changes below each come in two forms: the plain one opens
 * its own transaction (used by the Edit sections page), and the "...In" one
 * runs inside a transaction that is already open (used when an approved
 * proposal is applied, so the approval and the change succeed or fail
 * together).
 */

/** Check a new section name without saving anything. */
export function checkSectionTitle(input: string): string {
  return cleanTitle(input);
}

export async function createSectionIn(
  tx: Tx,
  actor: Actor,
  input: { parentId: string | null; title: string },
): Promise<string> {
  assertCan(actor, "structure");
  const title = cleanTitle(input.title);
  let parent: SectionNode | null = null;
  if (input.parentId) {
    parent = findNode(await loadTree(tx), input.parentId);
    if (!parent) throw new AppError(GONE);
    if (parent.depth >= MAX_DEPTH) {
      throw new AppError("Sections can go three levels deep at most (for example 1.1.1).");
    }
  }
  const [created] = await tx
    .insert(sections)
    .values({
      parentId: parent?.id ?? null,
      title,
      position: await nextPosition(tx, parent?.id ?? null),
      createdBy: actor.id,
      updatedBy: actor.id,
    })
    .returning({ id: sections.id });
  await logActivity(tx, actor.id, {
    action: "section.created",
    entityType: "section",
    entityId: created.id,
    summary: parent ? `Added section "${title}" under ${label(parent)}` : `Added section "${title}"`,
    data: { title, parentId: parent?.id ?? null },
  });
  return created.id;
}

export async function createSection(
  actor: Actor,
  input: { parentId: string | null; title: string },
): Promise<string> {
  assertCan(actor, "structure");
  cleanTitle(input.title);
  return asUser(actor.id, (tx) => createSectionIn(tx, actor, input));
}

export async function renameSectionIn(tx: Tx, actor: Actor, id: string, newTitle: string): Promise<void> {
  assertCan(actor, "structure");
  const title = cleanTitle(newTitle);
  const [row] = await tx.select().from(sections).where(eq(sections.id, id));
  if (!row || row.archivedAt) throw new AppError(GONE);
  if (row.title === title) return;
  await tx
    .update(sections)
    .set({ title, updatedAt: new Date(), updatedBy: actor.id })
    .where(eq(sections.id, id));
  await logActivity(tx, actor.id, {
    action: "section.renamed",
    entityType: "section",
    entityId: id,
    summary: `Renamed section "${row.title}" to "${title}"`,
    data: { from: row.title, to: title },
  });
}

export async function renameSection(actor: Actor, id: string, newTitle: string): Promise<void> {
  assertCan(actor, "structure");
  cleanTitle(newTitle);
  await asUser(actor.id, (tx) => renameSectionIn(tx, actor, id, newTitle));
}

async function applyOrder(
  tx: Tx,
  actor: Actor,
  parent: SectionNode | null,
  current: SectionNode[],
  orderedIds: string[],
): Promise<void> {
  const currentIds = current.map((node) => node.id);
  const sameSet =
    orderedIds.length === currentIds.length &&
    new Set(orderedIds).size === orderedIds.length &&
    orderedIds.every((id) => currentIds.includes(id));
  if (!sameSet) {
    throw new AppError("The sections changed while you were reordering. Reload and try again.");
  }
  if (orderedIds.every((id, index) => id === currentIds[index])) return;
  // Order is not a content change, so "last updated" is left alone.
  for (const [index, id] of orderedIds.entries()) {
    await tx
      .update(sections)
      .set({ position: index + 1 })
      .where(eq(sections.id, id));
  }
  await logActivity(tx, actor.id, {
    action: "section.reordered",
    entityType: "section",
    entityId: parent?.id ?? null,
    summary: parent ? `Reordered the sections under ${label(parent)}` : "Reordered the top-level sections",
    data: { parentId: parent?.id ?? null, order: orderedIds },
  });
}

/** Set the order of all sections under one parent (null = top level). */
export async function reorderSections(
  actor: Actor,
  parentId: string | null,
  orderedIds: string[],
): Promise<void> {
  assertCan(actor, "structure");
  await asUser(actor.id, async (tx) => {
    const tree = await loadTree(tx);
    const parent = parentId ? findNode(tree, parentId) : null;
    if (parentId && !parent) throw new AppError(GONE);
    await applyOrder(tx, actor, parent, parent ? parent.children : tree, orderedIds);
  });
}

/** Move a section one place up or down among its siblings. */
export async function moveSection(actor: Actor, id: string, direction: "up" | "down"): Promise<void> {
  assertCan(actor, "structure");
  await asUser(actor.id, async (tx) => {
    const tree = await loadTree(tx);
    const path = pathTo(tree, id);
    const node = path.at(-1);
    if (!node) throw new AppError(GONE);
    const parent = path.at(-2) ?? null;
    const siblings = parent ? parent.children : tree;
    const index = siblings.findIndex((s) => s.id === id);
    const target = direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= siblings.length) return;
    const ids = siblings.map((s) => s.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    await applyOrder(tx, actor, parent, siblings, ids);
  });
}

/** Hide a section (and everything under it). Nothing is deleted; it can be restored. */
export async function archiveSectionIn(tx: Tx, actor: Actor, id: string): Promise<void> {
  assertCan(actor, "structure");
  const node = findNode(await loadTree(tx), id);
  if (!node) throw new AppError(GONE);
  await tx
    .update(sections)
    .set({ archivedAt: new Date(), archivedBy: actor.id })
    .where(eq(sections.id, id));
  await logActivity(tx, actor.id, {
    action: "section.archived",
    entityType: "section",
    entityId: id,
    summary: `Archived section ${label(node)}`,
    data: { title: node.title, number: node.number },
  });
}

export async function archiveSection(actor: Actor, id: string): Promise<void> {
  assertCan(actor, "structure");
  await asUser(actor.id, (tx) => archiveSectionIn(tx, actor, id));
}

/** How many levels a section and everything under it take up (1 = no subsections). */
function heightOf(node: SectionNode): number {
  return 1 + Math.max(0, ...node.children.map(heightOf));
}

/**
 * Why a section cannot be moved under `parentId` (null = top level), or null
 * if it can. Used when a move is proposed and again when it is approved.
 */
export function moveProblem(tree: SectionNode[], id: string, parentId: string | null): string | null {
  const path = pathTo(tree, id);
  const node = path.at(-1);
  if (!node) return GONE;
  const currentParentId = path.at(-2)?.id ?? null;
  if (currentParentId === parentId) return "That section is already there.";
  if (parentId === null) return null;
  const targetPath = pathTo(tree, parentId);
  const target = targetPath.at(-1);
  if (!target) return "The section to move it under no longer exists. Reload the page and choose again.";
  if (targetPath.some((step) => step.id === id)) {
    return "A section cannot be moved under itself or under one of its own subsections.";
  }
  if (target.depth + heightOf(node) > MAX_DEPTH) {
    return "That would put sections more than three levels deep (for example 1.1.1.1).";
  }
  return null;
}

/**
 * Move a section, with everything under it, to another parent (or to the top
 * level). It goes to the end of its new group. Like reordering, a move does
 * not count as a content update.
 */
export async function moveSectionToIn(tx: Tx, actor: Actor, id: string, parentId: string | null): Promise<void> {
  assertCan(actor, "structure");
  const tree = await loadTree(tx);
  const problem = moveProblem(tree, id, parentId);
  if (problem) throw new AppError(problem);
  const node = findNode(tree, id)!;
  const target = parentId ? findNode(tree, parentId) : null;
  await tx
    .update(sections)
    .set({ parentId, position: await nextPosition(tx, parentId) })
    .where(eq(sections.id, id));
  await logActivity(tx, actor.id, {
    action: "section.moved",
    entityType: "section",
    entityId: id,
    summary: target
      ? `Moved section ${label(node)} under ${label(target)}`
      : `Moved section ${label(node)} to the top level`,
    data: { title: node.title, fromParentId: node.parentId, toParentId: parentId },
  });
}

export async function moveSectionTo(actor: Actor, id: string, parentId: string | null): Promise<void> {
  assertCan(actor, "structure");
  await asUser(actor.id, (tx) => moveSectionToIn(tx, actor, id, parentId));
}

export async function restoreSection(actor: Actor, id: string): Promise<void> {
  assertCan(actor, "structure");
  await asUser(actor.id, async (tx) => {
    const [row] = await tx.select().from(sections).where(eq(sections.id, id));
    if (!row) throw new AppError(GONE);
    if (!row.archivedAt) return;
    await tx
      .update(sections)
      .set({
        archivedAt: null,
        archivedBy: null,
        // Comes back at the end of its group.
        position: await nextPosition(tx, row.parentId),
      })
      .where(eq(sections.id, id));
    await logActivity(tx, actor.id, {
      action: "section.restored",
      entityType: "section",
      entityId: id,
      summary: `Restored section "${row.title}"`,
      data: { title: row.title },
    });
  });
}

export type ArchivedSection = {
  id: string;
  title: string;
  parentTitle: string | null;
  archivedAt: Date;
  archivedByName: string | null;
};

export async function listArchivedSections(q: Queryable): Promise<ArchivedSection[]> {
  const parent = alias(sections, "parent");
  const rows = await q
    .select({
      id: sections.id,
      title: sections.title,
      parentTitle: parent.title,
      archivedAt: sections.archivedAt,
      archivedByName: users.name,
    })
    .from(sections)
    .leftJoin(parent, eq(parent.id, sections.parentId))
    .leftJoin(users, eq(users.id, sections.archivedBy))
    .where(isNotNull(sections.archivedAt));
  return rows
    .map((row) => ({ ...row, archivedAt: row.archivedAt as Date }))
    .sort((a, b) => b.archivedAt.getTime() - a.archivedAt.getTime());
}
