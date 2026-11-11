import { and, asc, count, desc, eq, gt, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { type Queryable, type Tx, asUser } from "@/db/client";
import { comments, dailyLogs, noteRevisions, noteSections, notes, sections, users } from "@/db/schema";
import { logActivity } from "./activity";
import { BUSINESS_LABELS, type BusinessTag, parseBusinessTag } from "./business";
import { type Actor, AppError, assertCan } from "./permissions";
import { type RichDoc, docToText, isEmptyDoc, sameDoc, sanitizeDoc } from "./richtext";
import { type SectionNode, flattenTree, isUuid } from "./sections";
import { centralDateKey, formatDateKey } from "./time";

/**
 * Daily Log notes.
 *
 * A note is exactly what an Owner typed, kept word for word. It belongs to
 * the Daily Log of the US Central day it was written on. Sorting a note files
 * it under one or more manual sections; the same note (not a copy) then shows
 * in each of those sections' Discussion.
 *
 * Nothing is ever deleted: a removed note is hidden and can be restored, and
 * when an author edits a note the earlier wording is kept.
 */

export type NoteSectionLink = {
  id: string;
  /** "2.1", or null if the section has since been archived. */
  number: string | null;
  title: string;
  /** True when the AI filed it there (Phase 5). */
  byAi: boolean;
};

export type CommentView = {
  id: string;
  body: RichDoc;
  createdAt: Date;
  authorId: string;
  authorName: string;
};

/** Wording a note had before its author changed it. */
export type NoteRevision = { body: RichDoc; replacedAt: Date };

export type NoteView = {
  id: string;
  /** The Daily Log day, e.g. "2026-11-10". */
  logDate: string;
  body: RichDoc;
  createdAt: Date;
  authorId: string;
  authorName: string;
  /** When the author last changed the wording, if ever. */
  editedAt: Date | null;
  /** Earlier wordings, oldest first. Empty unless the note was edited. */
  revisions: NoteRevision[];
  businessTag: BusinessTag | null;
  sorted: boolean;
  sections: NoteSectionLink[];
  comments: CommentView[];
  /** Set when the note has been removed (it is then hidden from lists). */
  removedAt: Date | null;
  removedByName: string | null;
};

export type LogDay = { logDate: string; noteCount: number; unsortedCount: number };

const NOTE_GONE = "That note could not be found. Reload the page and try again.";
const NOTE_REMOVED = "That note was removed. Restore it first.";

const remover = alias(users, "remover");

const noteColumns = {
  id: notes.id,
  logDate: notes.logDate,
  body: notes.body,
  createdAt: notes.createdAt,
  authorId: notes.createdBy,
  authorName: users.name,
  editedAt: notes.editedAt,
  businessTag: notes.businessTag,
  sortedAt: notes.sortedAt,
  removedAt: notes.removedAt,
  removedByName: remover.name,
};

type NoteRow = {
  id: string;
  logDate: string;
  body: unknown;
  createdAt: Date;
  authorId: string;
  authorName: string;
  editedAt: Date | null;
  businessTag: BusinessTag | null;
  sortedAt: Date | null;
  removedAt: Date | null;
  removedByName: string | null;
};

/** Notes joined with who wrote them (and who removed them, if anyone). */
function selectNotes(q: Queryable) {
  return q
    .select(noteColumns)
    .from(notes)
    .innerJoin(users, eq(users.id, notes.createdBy))
    .leftJoin(remover, eq(remover.id, notes.removedBy));
}

/** The sections each of these notes is currently filed under, in manual order. */
export async function loadNoteSectionLinks(
  q: Queryable,
  tree: SectionNode[],
  noteIds: string[],
): Promise<Map<string, NoteSectionLink[]>> {
  const result = new Map<string, NoteSectionLink[]>();
  if (noteIds.length === 0) return result;
  const numbers = new Map(flattenTree(tree).map((node) => [node.id, node.number]));
  const links = await q
    .select({
      noteId: noteSections.noteId,
      sectionId: noteSections.sectionId,
      title: sections.title,
      byAi: noteSections.byAi,
    })
    .from(noteSections)
    .innerJoin(sections, eq(sections.id, noteSections.sectionId))
    .where(and(inArray(noteSections.noteId, noteIds), isNull(noteSections.removedAt)));
  for (const link of links) {
    const list = result.get(link.noteId) ?? [];
    list.push({
      id: link.sectionId,
      number: numbers.get(link.sectionId) ?? null,
      title: link.title,
      byAi: link.byAi,
    });
    result.set(link.noteId, list);
  }
  for (const list of result.values()) {
    // Archived sections (no number) go last.
    list.sort((a, b) =>
      a.number === null || b.number === null
        ? Number(a.number === null) - Number(b.number === null)
        : a.number.localeCompare(b.number, "en", { numeric: true }),
    );
  }
  return result;
}

/** Add each note's sections, comments and earlier wordings. Keeps the order of `rows`. */
async function withDetails(q: Queryable, tree: SectionNode[], rows: NoteRow[]): Promise<NoteView[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const links = await loadNoteSectionLinks(q, tree, ids);

  const commentRows = await q
    .select({
      id: comments.id,
      noteId: comments.noteId,
      body: comments.body,
      createdAt: comments.createdAt,
      authorId: comments.createdBy,
      authorName: users.name,
    })
    .from(comments)
    .innerJoin(users, eq(users.id, comments.createdBy))
    .where(inArray(comments.noteId, ids))
    .orderBy(asc(comments.createdAt), asc(comments.id));

  const editedIds = rows.filter((row) => row.editedAt !== null).map((row) => row.id);
  const revisionRows =
    editedIds.length === 0
      ? []
      : await q
          .select({
            noteId: noteRevisions.noteId,
            body: noteRevisions.body,
            replacedAt: noteRevisions.createdAt,
          })
          .from(noteRevisions)
          .where(inArray(noteRevisions.noteId, editedIds))
          .orderBy(asc(noteRevisions.createdAt), asc(noteRevisions.id));

  return rows.map((row) => ({
    id: row.id,
    logDate: row.logDate,
    body: row.body as RichDoc,
    createdAt: row.createdAt,
    authorId: row.authorId,
    authorName: row.authorName,
    editedAt: row.editedAt,
    revisions: revisionRows
      .filter((revision) => revision.noteId === row.id)
      .map((revision) => ({ body: revision.body as RichDoc, replacedAt: revision.replacedAt })),
    businessTag: row.businessTag,
    sorted: row.sortedAt !== null,
    sections: links.get(row.id) ?? [],
    comments: commentRows
      .filter((comment) => comment.noteId === row.id)
      .map(({ id, body, createdAt, authorId, authorName }) => ({
        id,
        body: body as RichDoc,
        createdAt,
        authorId,
        authorName,
      })),
    removedAt: row.removedAt,
    removedByName: row.removedByName,
  }));
}

/** Every day that has notes, newest first, with how many are still unsorted. */
export async function listLogDays(q: Queryable): Promise<LogDay[]> {
  return q
    .select({
      logDate: notes.logDate,
      noteCount: count(),
      unsortedCount: sql<number>`count(*) filter (where ${notes.sortedAt} is null)`.mapWith(Number),
    })
    .from(notes)
    .where(isNull(notes.removedAt))
    .groupBy(notes.logDate)
    .orderBy(desc(notes.logDate));
}

/** The nearest earlier and later days that have notes (for Previous / Next). */
export async function adjacentLogDays(
  q: Queryable,
  logDate: string,
): Promise<{ previous: string | null; next: string | null }> {
  const [before] = await q
    .select({ logDate: notes.logDate })
    .from(notes)
    .where(and(isNull(notes.removedAt), lt(notes.logDate, logDate)))
    .orderBy(desc(notes.logDate))
    .limit(1);
  const [after] = await q
    .select({ logDate: notes.logDate })
    .from(notes)
    .where(and(isNull(notes.removedAt), gt(notes.logDate, logDate)))
    .orderBy(asc(notes.logDate))
    .limit(1);
  return { previous: before?.logDate ?? null, next: after?.logDate ?? null };
}

/**
 * All notes of one day from all users, in the order they were written.
 * Removed notes are left out unless asked for (Owners see a one-line
 * reminder with a Restore button in their place).
 */
export async function loadDay(
  q: Queryable,
  tree: SectionNode[],
  logDate: string,
  options: { includeRemoved?: boolean } = {},
): Promise<NoteView[]> {
  const rows = await selectNotes(q)
    .where(and(eq(notes.logDate, logDate), options.includeRemoved ? undefined : isNull(notes.removedAt)))
    .orderBy(asc(notes.createdAt), asc(notes.id));
  return withDetails(q, tree, rows);
}

/**
 * Notes that have been removed, most recently removed first. This is where a
 * removed note can always be found again to restore it, even when it was the
 * only note of its day (that day then no longer shows in the list of days).
 */
export async function listRemovedNotes(q: Queryable, tree: SectionNode[], limit = 50): Promise<NoteView[]> {
  const rows = await selectNotes(q)
    .where(isNotNull(notes.removedAt))
    .orderBy(desc(notes.removedAt), desc(notes.id))
    .limit(limit);
  return withDetails(q, tree, rows);
}

/** Several notes by id, oldest first, whether or not they have been removed. */
export async function loadNotesByIds(q: Queryable, tree: SectionNode[], noteIds: string[]): Promise<NoteView[]> {
  const ids = noteIds.filter(isUuid);
  if (ids.length === 0) return [];
  const rows = await selectNotes(q)
    .where(inArray(notes.id, ids))
    .orderBy(asc(notes.createdAt), asc(notes.id));
  return withDetails(q, tree, rows);
}

/** One note, whether or not it has been removed (check `removedAt`). */
export async function loadNote(q: Queryable, tree: SectionNode[], noteId: string): Promise<NoteView | null> {
  if (!isUuid(noteId)) return null;
  const rows = await selectNotes(q).where(eq(notes.id, noteId));
  return (await withDetails(q, tree, rows))[0] ?? null;
}

/**
 * Which stored tags a business filter matches. A note tagged "Both" concerns
 * the garden center and the coffee shop, so it shows under either filter.
 */
export function businessFilterTags(filter: BusinessTag): BusinessTag[] {
  return filter === "both" ? ["both"] : [filter, "both"];
}

/**
 * A section's Discussion: every note filed there, in the order the notes
 * were written (newest first unless asked otherwise).
 */
export async function loadDiscussion(
  q: Queryable,
  tree: SectionNode[],
  sectionId: string,
  options: { order?: "newest" | "oldest"; business?: BusinessTag | null } = {},
): Promise<NoteView[]> {
  const oldestFirst = options.order === "oldest";
  const rows = await q
    .select(noteColumns)
    .from(noteSections)
    .innerJoin(notes, eq(notes.id, noteSections.noteId))
    .innerJoin(users, eq(users.id, notes.createdBy))
    .leftJoin(remover, eq(remover.id, notes.removedBy))
    .where(
      and(
        eq(noteSections.sectionId, sectionId),
        isNull(noteSections.removedAt),
        isNull(notes.removedAt),
        options.business ? inArray(notes.businessTag, businessFilterTags(options.business)) : undefined,
      ),
    )
    .orderBy(
      oldestFirst ? asc(notes.createdAt) : desc(notes.createdAt),
      oldestFirst ? asc(notes.id) : desc(notes.id),
    );
  return withDetails(q, tree, rows);
}

/** Notes not yet marked Sorted, newest first. `total` counts all of them. */
export async function listUnsortedNotes(
  q: Queryable,
  tree: SectionNode[],
  limit = 10,
): Promise<{ total: number; notes: NoteView[] }> {
  const unsorted = and(isNull(notes.sortedAt), isNull(notes.removedAt));
  const [{ total }] = await q.select({ total: count() }).from(notes).where(unsorted);
  const rows = await selectNotes(q)
    .where(unsorted)
    .orderBy(desc(notes.createdAt), desc(notes.id))
    .limit(limit);
  return { total, notes: await withDetails(q, tree, rows) };
}

function readBody(rawBody: unknown, emptyMessage: string): { body: RichDoc; bodyText: string } {
  const body = sanitizeDoc(rawBody);
  if (isEmptyDoc(body)) throw new AppError(emptyMessage);
  return { body, bodyText: docToText(body) };
}

/**
 * Save a new note to today's Daily Log (the day it is right now in US
 * Central time). The day's log is created with its first note.
 */
export async function addNote(
  actor: Actor,
  input: { body: unknown; now?: Date },
): Promise<{ id: string; logDate: string }> {
  assertCan(actor, "write_notes");
  const { body, bodyText } = readBody(input.body, "Write something before saving the note.");
  const now = input.now ?? new Date();
  const logDate = centralDateKey(now);

  return asUser(actor.id, async (tx) => {
    await tx
      .insert(dailyLogs)
      .values({ logDate, createdAt: now, createdBy: actor.id })
      .onConflictDoNothing();
    const [created] = await tx
      .insert(notes)
      .values({
        logDate,
        body,
        bodyText,
        createdAt: now,
        createdBy: actor.id,
        updatedAt: now,
        updatedBy: actor.id,
      })
      .returning({ id: notes.id });
    await logActivity(tx, actor.id, {
      action: "note.added",
      entityType: "note",
      entityId: created.id,
      summary: `Added a note to the Daily Log for ${formatDateKey(logDate)}`,
      data: { logDate },
    });
    return { id: created.id, logDate };
  });
}

/**
 * The database has the last word on permissions. If it changed no row (for
 * example the person's role changed a moment ago), say so instead of
 * recording a change that did not happen.
 */
function requireChanged(rows: unknown[]): void {
  if (rows.length === 0) throw new AppError("You don't have permission to do that.");
}

/** The note row, or a plain-English error if it is missing (or removed). */
async function requireNote(tx: Tx, noteId: string, options: { allowRemoved?: boolean } = {}) {
  if (!isUuid(noteId)) throw new AppError(NOTE_GONE);
  const [note] = await tx.select().from(notes).where(eq(notes.id, noteId));
  if (!note) throw new AppError(NOTE_GONE);
  if (note.removedAt && !options.allowRemoved) throw new AppError(NOTE_REMOVED);
  return note;
}

/**
 * Change the wording of a note. Only the person who wrote it may do this,
 * and the earlier wording is kept (the database stores it in note_revisions
 * by itself whenever a note's wording changes).
 */
export async function editNote(actor: Actor, noteId: string, rawBody: unknown): Promise<{ changed: boolean }> {
  assertCan(actor, "write_notes");
  const { body, bodyText } = readBody(rawBody, "A note can't be empty. Write something, or cancel.");
  return asUser(actor.id, async (tx) => {
    const note = await requireNote(tx, noteId);
    if (note.createdBy !== actor.id) {
      throw new AppError("Only the person who wrote a note can change its wording.");
    }
    if (sameDoc(note.body as RichDoc, body)) return { changed: false };
    // The database keeps the earlier wording and stamps the "edited" time
    // itself whenever the wording changes.
    await tx
      .update(notes)
      .set({ body, bodyText, updatedAt: new Date(), updatedBy: actor.id })
      .where(eq(notes.id, noteId));
    await logActivity(tx, actor.id, {
      action: "note.edited",
      entityType: "note",
      entityId: noteId,
      summary: `Edited their note from ${formatDateKey(note.logDate)}`,
      data: { logDate: note.logDate },
    });
    return { changed: true };
  });
}

/**
 * Sort a note by hand: choose the sections it belongs to, the business tag,
 * and whether it counts as Sorted. The note's words are not touched.
 *
 * `sectionIds` is the full list of sections the note should be filed under
 * after saving. Sections that have been archived cannot be chosen, and a
 * filing under a section that was archived later is left as it is (it shows
 * again if that section is restored).
 */
export async function sortNote(
  actor: Actor,
  noteId: string,
  tree: SectionNode[],
  input: { sectionIds: unknown; businessTag: unknown; sorted: unknown },
): Promise<void> {
  assertCan(actor, "write_notes");
  const businessTag = parseBusinessTag(input.businessTag);
  const sorted = input.sorted === true;
  if (!Array.isArray(input.sectionIds) || input.sectionIds.length > 100) {
    throw new AppError("The chosen sections could not be read. Reload the page and try again.");
  }
  const byId = new Map(flattenTree(tree).map((node) => [node.id, node]));
  const wanted = [...new Set(input.sectionIds as unknown[])].map((id) => {
    const node = typeof id === "string" ? byId.get(id) : undefined;
    if (!node) {
      throw new AppError("One of the chosen sections no longer exists. Reload the page and choose again.");
    }
    return node;
  });

  await asUser(actor.id, async (tx) => {
    const note = await requireNote(tx, noteId);
    const now = new Date();
    const changes: string[] = [];

    const live = (
      await tx
        .select()
        .from(noteSections)
        .where(and(eq(noteSections.noteId, noteId), isNull(noteSections.removedAt)))
    ).filter((link) => byId.has(link.sectionId));
    const wantedIds = new Set(wanted.map((node) => node.id));

    const added = wanted
      .filter((node) => !live.some((link) => link.sectionId === node.id))
      .sort((a, b) => a.number.localeCompare(b.number, "en", { numeric: true }));
    for (const node of added) {
      // Each filing is its own row, so who filed it and when is never lost.
      await tx
        .insert(noteSections)
        .values({ noteId, sectionId: node.id, createdAt: now, createdBy: actor.id });
      // New discussion is activity in that section.
      await tx
        .update(sections)
        .set({ updatedAt: now, updatedBy: actor.id })
        .where(eq(sections.id, node.id));
    }
    if (added.length > 0) {
      changes.push(`filed it under ${added.map((n) => `${n.number} ${n.title}`).join(", ")}`);
    }

    const removed = live.filter((link) => !wantedIds.has(link.sectionId));
    for (const link of removed) {
      await tx
        .update(noteSections)
        .set({ removedAt: now, removedBy: actor.id })
        .where(eq(noteSections.id, link.id));
    }
    if (removed.length > 0) {
      const names = removed.map((link) => {
        const node = byId.get(link.sectionId);
        return node ? `${node.number} ${node.title}` : "a section";
      });
      changes.push(`took it out of ${names.join(", ")}`);
    }

    if (note.businessTag !== businessTag) {
      changes.push(
        businessTag ? `tagged it ${BUSINESS_LABELS[businessTag]}` : "removed its business tag",
      );
    }
    const wasSorted = note.sortedAt !== null;
    if (wasSorted !== sorted) changes.push(sorted ? "marked it Sorted" : "marked it Unsorted");

    if (changes.length === 0) return;
    await tx
      .update(notes)
      .set({
        businessTag,
        sortedAt: sorted ? (note.sortedAt ?? now) : null,
        sortedBy: sorted ? (note.sortedBy ?? actor.id) : null,
        updatedAt: now,
        updatedBy: actor.id,
      })
      .where(eq(notes.id, noteId));
    await logActivity(tx, actor.id, {
      action: "note.sorted",
      entityType: "note",
      entityId: noteId,
      summary: `Sorted a note from ${formatDateKey(note.logDate)}: ${changes.join("; ")}`,
      data: {
        logDate: note.logDate,
        addedSectionIds: added.map((node) => node.id),
        removedSectionIds: removed.map((link) => link.sectionId),
        businessTag,
        sorted,
      },
    });
  });
}

/** Tick or untick a note's Sorted checkbox without changing anything else. */
export async function setNoteSorted(actor: Actor, noteId: string, sorted: boolean): Promise<void> {
  assertCan(actor, "write_notes");
  await asUser(actor.id, async (tx) => {
    const note = await requireNote(tx, noteId);
    if ((note.sortedAt !== null) === sorted) return;
    const now = new Date();
    requireChanged(
      await tx
        .update(notes)
        .set({
          sortedAt: sorted ? now : null,
          sortedBy: sorted ? actor.id : null,
          updatedAt: now,
          updatedBy: actor.id,
        })
        .where(eq(notes.id, noteId))
        .returning({ id: notes.id }),
    );
    await logActivity(tx, actor.id, {
      action: "note.sorted",
      entityType: "note",
      entityId: noteId,
      summary: `Sorted a note from ${formatDateKey(note.logDate)}: ${sorted ? "marked it Sorted" : "marked it Unsorted"}`,
      data: { logDate: note.logDate, sorted },
    });
  });
}

/**
 * Remove a note (any Owner). The note is hidden from the Daily Log, the
 * Discussion threads, Today and search, but nothing is deleted: it can be
 * restored with everything it had.
 */
export async function removeNote(actor: Actor, noteId: string): Promise<void> {
  assertCan(actor, "write_notes");
  await asUser(actor.id, async (tx) => {
    const note = await requireNote(tx, noteId, { allowRemoved: true });
    if (note.removedAt) return;
    const now = new Date();
    requireChanged(
      await tx
        .update(notes)
        .set({ removedAt: now, removedBy: actor.id, updatedAt: now, updatedBy: actor.id })
        .where(eq(notes.id, noteId))
        .returning({ id: notes.id }),
    );
    await logActivity(tx, actor.id, {
      action: "note.removed",
      entityType: "note",
      entityId: noteId,
      summary: `Removed a note from ${formatDateKey(note.logDate)}`,
      data: { logDate: note.logDate },
    });
  });
}

export async function restoreNote(actor: Actor, noteId: string): Promise<void> {
  assertCan(actor, "write_notes");
  await asUser(actor.id, async (tx) => {
    const note = await requireNote(tx, noteId, { allowRemoved: true });
    if (!note.removedAt) return;
    requireChanged(
      await tx
        .update(notes)
        .set({ removedAt: null, removedBy: null, updatedAt: new Date(), updatedBy: actor.id })
        .where(eq(notes.id, noteId))
        .returning({ id: notes.id }),
    );
    await logActivity(tx, actor.id, {
      action: "note.restored",
      entityType: "note",
      entityId: noteId,
      summary: `Restored a note from ${formatDateKey(note.logDate)}`,
      data: { logDate: note.logDate },
    });
  });
}

/** Add a comment to a note. Owners and Advisors. Kept word for word. */
export async function addComment(actor: Actor, noteId: string, rawBody: unknown): Promise<string> {
  assertCan(actor, "comment");
  const { body, bodyText } = readBody(rawBody, "Write something before saving the comment.");
  return asUser(actor.id, async (tx) => {
    const note = await requireNote(tx, noteId);
    const [created] = await tx
      .insert(comments)
      .values({ noteId, body, bodyText, createdBy: actor.id })
      .returning({ id: comments.id });
    await logActivity(tx, actor.id, {
      action: "comment.added",
      entityType: "note",
      entityId: noteId,
      summary: `Commented on a note from ${formatDateKey(note.logDate)}`,
      data: { commentId: created.id, logDate: note.logDate },
    });
    return created.id;
  });
}
