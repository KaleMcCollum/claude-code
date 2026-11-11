import { type SQL, and, desc, eq, exists, ilike, inArray, isNull, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { Queryable } from "@/db/client";
import { comments, noteSections, notes, officialVersions, users } from "@/db/schema";
import type { BusinessTag } from "./business";
import { type NoteSectionLink, businessFilterTags, loadNoteSectionLinks } from "./notes";
import { type SectionNode, findNode, flattenTree } from "./sections";
import { TIME_ZONE } from "./time";

/**
 * Global search. So far it covers section names, current official text,
 * notes (which are also the Discussion) and comments. Proposals, to-dos,
 * quotes, vendors, payments and document names join as those parts are built.
 */

export type SearchHit = {
  sectionId: string;
  number: string;
  title: string;
  /** A short piece of the official text around the match, when the match is in the text. */
  excerpt: string | null;
};

export type NoteHit = {
  noteId: string;
  /** The Daily Log day the note is on, e.g. "2026-11-10". */
  logDate: string;
  createdAt: Date;
  authorName: string;
  excerpt: string;
  businessTag: BusinessTag | null;
  sections: NoteSectionLink[];
};

export type CommentHit = {
  commentId: string;
  noteId: string;
  logDate: string;
  createdAt: Date;
  authorName: string;
  excerpt: string;
};

export type SearchFilters = {
  /** First and last day to include, as "YYYY-MM-DD" in US Central time. */
  from?: string | null;
  to?: string | null;
  /** A section; its subsections are included. */
  sectionId?: string | null;
  business?: BusinessTag | null;
  /** Who wrote it. */
  authorId?: string | null;
};

export type SearchResults = {
  sections: SearchHit[];
  official: SearchHit[];
  /** The newest matching notes, at most MAX_PER_TYPE. */
  notes: NoteHit[];
  comments: CommentHit[];
  /** True when there were more matches than the list shows. */
  moreNotes: boolean;
  moreComments: boolean;
};

export const MAX_PER_TYPE = 50;
const EMPTY: SearchResults = {
  sections: [],
  official: [],
  notes: [],
  comments: [],
  moreNotes: false,
  moreComments: false,
};

const MAX_WORDS = 6;

/**
 * The words to look for. A record matches when every word appears in it,
 * in any order ("scanner line buster" finds "scanners ... for line busters").
 */
export function searchWords(rawQuery: string): string[] {
  const query = rawQuery.trim().slice(0, 100);
  if (query.length < 2) return [];
  return [...new Set(query.toLowerCase().split(/\s+/).filter(Boolean))].slice(0, MAX_WORDS);
}

/** Treat what the user typed as plain text, not as a search pattern. */
function likePattern(word: string): string {
  return `%${word.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

/** Every word must appear somewhere in the column. */
function containsAll(column: AnyPgColumn, words: string[]): SQL | undefined {
  return and(...words.map((word) => ilike(column, likePattern(word))));
}

/** A short piece of the text around the first place one of the words appears. */
function excerptAround(text: string, words: string[], radius = 90): string {
  const lower = text.toLowerCase();
  const places = words.map((word) => ({ at: lower.indexOf(word), length: word.length })).filter((p) => p.at >= 0);
  const first = places.sort((a, b) => a.at - b.at)[0];
  if (!first) return text.slice(0, radius * 2);
  const start = Math.max(0, first.at - radius);
  const end = Math.min(text.length, first.at + first.length + radius);
  return (start > 0 ? "…" : "") + text.slice(start, end).replace(/\s+/g, " ") + (end < text.length ? "…" : "");
}

/** The calendar day of a timestamp column, in US Central time. */
function centralDay(column: AnyPgColumn): SQL {
  return sql`(${column} at time zone ${sql.raw(`'${TIME_ZONE}'`)})::date`;
}

export async function search(
  q: Queryable,
  tree: SectionNode[],
  rawQuery: string,
  filters: SearchFilters = {},
): Promise<SearchResults> {
  const query = rawQuery.trim().slice(0, 100);
  const words = searchWords(query);
  if (words.length === 0) return EMPTY;
  const nodes = flattenTree(tree);
  const byId = new Map(nodes.map((node) => [node.id, node]));

  // A section filter covers the section and everything under it.
  let sectionIds: string[] | null = null;
  if (filters.sectionId) {
    const node = findNode(tree, filters.sectionId);
    if (!node) return EMPTY;
    sectionIds = [node, ...flattenTree(node.children)].map((n) => n.id);
  }
  const businessTags = filters.business ? businessFilterTags(filters.business) : null;
  const hasDateOrPerson = Boolean(filters.from || filters.to || filters.authorId);

  // Section names. They have no date, author or business tag, so they are
  // only listed when none of those filters is in use.
  const sectionHits: SearchHit[] =
    hasDateOrPerson || businessTags
      ? []
      : nodes
          .filter((n) => !sectionIds || sectionIds.includes(n.id))
          .filter((n) => {
            const title = n.title.toLowerCase();
            return words.every((word) => title.includes(word)) || n.number === query;
          })
          .map((n) => ({ sectionId: n.id, number: n.number, title: n.title, excerpt: null }));

  // Official text: only the current version of each section counts. It has
  // no business tag, so a business filter leaves it out.
  const officialHits: SearchHit[] = [];
  if (!businessTags) {
    const rows = await q
      .select({
        sectionId: officialVersions.sectionId,
        version: officialVersions.version,
        text: officialVersions.contentText,
      })
      .from(officialVersions)
      .where(
        and(
          containsAll(officialVersions.contentText, words),
          sectionIds ? inArray(officialVersions.sectionId, sectionIds) : undefined,
          filters.authorId ? eq(officialVersions.createdBy, filters.authorId) : undefined,
          filters.from ? sql`${centralDay(officialVersions.createdAt)} >= ${filters.from}::date` : undefined,
          filters.to ? sql`${centralDay(officialVersions.createdAt)} <= ${filters.to}::date` : undefined,
        ),
      )
      .orderBy(desc(officialVersions.version));
    const latest = new Map<string, number>();
    const all = await q
      .select({ sectionId: officialVersions.sectionId, version: officialVersions.version })
      .from(officialVersions);
    for (const row of all) {
      latest.set(row.sectionId, Math.max(latest.get(row.sectionId) ?? 0, row.version));
    }
    for (const row of rows) {
      const node = byId.get(row.sectionId);
      if (!node || latest.get(row.sectionId) !== row.version) continue;
      officialHits.push({
        sectionId: node.id,
        number: node.number,
        title: node.title,
        excerpt: excerptAround(row.text, words),
      });
    }
    officialHits.sort((a, b) => a.number.localeCompare(b.number, "en", { numeric: true }));
  }

  /** True for notes filed (right now) under one of the wanted sections. */
  const filedUnder = (ids: string[]) =>
    exists(
      q
        .select({ one: sql`1` })
        .from(noteSections)
        .where(
          and(
            eq(noteSections.noteId, notes.id),
            isNull(noteSections.removedAt),
            inArray(noteSections.sectionId, ids),
          ),
        ),
    );

  const noteRows = await q
    .select({
      noteId: notes.id,
      logDate: notes.logDate,
      createdAt: notes.createdAt,
      authorName: users.name,
      text: notes.bodyText,
      businessTag: notes.businessTag,
    })
    .from(notes)
    .innerJoin(users, eq(users.id, notes.createdBy))
    .where(
      and(
        containsAll(notes.bodyText, words),
        isNull(notes.removedAt),
        filters.from ? sql`${notes.logDate} >= ${filters.from}::date` : undefined,
        filters.to ? sql`${notes.logDate} <= ${filters.to}::date` : undefined,
        filters.authorId ? eq(notes.createdBy, filters.authorId) : undefined,
        businessTags ? inArray(notes.businessTag, businessTags) : undefined,
        sectionIds ? filedUnder(sectionIds) : undefined,
      ),
    )
    .orderBy(desc(notes.createdAt), desc(notes.id))
    .limit(MAX_PER_TYPE + 1);
  // One extra row was asked for, only to know whether there are more.
  const moreNotes = noteRows.length > MAX_PER_TYPE;
  noteRows.length = Math.min(noteRows.length, MAX_PER_TYPE);
  const links = await loadNoteSectionLinks(
    q,
    tree,
    noteRows.map((row) => row.noteId),
  );
  const noteHits: NoteHit[] = noteRows.map((row) => ({
    noteId: row.noteId,
    logDate: row.logDate,
    createdAt: row.createdAt,
    authorName: row.authorName,
    excerpt: excerptAround(row.text, words),
    businessTag: row.businessTag,
    sections: links.get(row.noteId) ?? [],
  }));

  // Comments are found by their own words, author and date; the section and
  // business filters look at the note the comment is on.
  const commentRows = await q
    .select({
      commentId: comments.id,
      noteId: comments.noteId,
      logDate: notes.logDate,
      createdAt: comments.createdAt,
      authorName: users.name,
      text: comments.bodyText,
    })
    .from(comments)
    .innerJoin(notes, eq(notes.id, comments.noteId))
    .innerJoin(users, eq(users.id, comments.createdBy))
    .where(
      and(
        containsAll(comments.bodyText, words),
        isNull(notes.removedAt),
        filters.from ? sql`${centralDay(comments.createdAt)} >= ${filters.from}::date` : undefined,
        filters.to ? sql`${centralDay(comments.createdAt)} <= ${filters.to}::date` : undefined,
        filters.authorId ? eq(comments.createdBy, filters.authorId) : undefined,
        businessTags ? inArray(notes.businessTag, businessTags) : undefined,
        sectionIds ? filedUnder(sectionIds) : undefined,
      ),
    )
    .orderBy(desc(comments.createdAt), desc(comments.id))
    .limit(MAX_PER_TYPE + 1);
  const moreComments = commentRows.length > MAX_PER_TYPE;
  commentRows.length = Math.min(commentRows.length, MAX_PER_TYPE);
  const commentHits: CommentHit[] = commentRows.map((row) => ({
    commentId: row.commentId,
    noteId: row.noteId,
    logDate: row.logDate,
    createdAt: row.createdAt,
    authorName: row.authorName,
    excerpt: excerptAround(row.text, words),
  }));

  return {
    sections: sectionHits,
    official: officialHits,
    notes: noteHits,
    comments: commentHits,
    moreNotes,
    moreComments,
  };
}
