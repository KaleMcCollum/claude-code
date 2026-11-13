import { type SQL, and, desc, eq, exists, ilike, inArray, isNull, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { Queryable } from "@/db/client";
import { comments, noteSections, notes, officialVersions, proposals, users } from "@/db/schema";
import type { BusinessTag } from "./business";
import { type NoteSectionLink, businessFilterTags, loadNoteSectionLinks } from "./notes";
import { type ProposalTitleFields, sectionAndBelow, titleFieldsFor } from "./proposals";
import { type SectionNode, findNode, flattenTree } from "./sections";
import { centralDay } from "./sqltime";
import { centralDateKey } from "./time";

/**
 * Global search. So far it covers section names, current official text,
 * notes (which are also the Discussion), comments (on notes and on
 * proposals) and proposals. To-dos, quotes, vendors, payments and document
 * names join as those parts are built.
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

/**
 * A comment that matched. It is on a note or on a proposal: exactly one of
 * `noteId` and `proposalId` is set, and that is where its link goes
 * (`/daily-log/<logDate>#note-<noteId>` or `/proposals/<proposalId>`).
 */
export type CommentHit = {
  commentId: string;
  /** The note it is on. Null for a comment on a proposal. */
  noteId: string | null;
  /** The proposal it is on (a direct edit counts). Null for a comment on a note. */
  proposalId: string | null;
  /**
   * A comment on a note: the Daily Log day that note is on, e.g.
   * "2026-11-10". A comment on a proposal has no such day; this is then the
   * (US Central) day the comment was written.
   */
  logDate: string;
  createdAt: Date;
  authorName: string;
  excerpt: string;
};

/**
 * A proposal that matched. `title` is the stored title, which is what was
 * searched. The fields of `ProposalTitleFields` are there so the screen can
 * show `displayTitle(hit, tree)`, the same title as every other list.
 */
export type ProposalHit = ProposalTitleFields & {
  proposalId: string;
  createdAt: Date;
  /** Empty when the AI proposed it (Phase 5). */
  proposedByName: string | null;
  /** A piece of the title, description, proposed text or decline reason around the match. */
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
  /** Written proposals (direct edits are found through the official text). */
  proposals: ProposalHit[];
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
  proposals: [],
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
  //  - Section names, official text and notes (with the comments on them)
  //    look at the sections as they are now: `sectionIds`. An archived
  //    subsection is not among them.
  //  - Proposals and the comments on them look at the stored sections,
  //    archived ones included: `proposalSectionIds`. What was proposed about
  //    a subsection stays under the section above it after the subsection
  //    is archived, as in the Decisions Log.
  let sectionIds: string[] | null = null;
  let proposalSectionIds: string[] | null = null;
  if (filters.sectionId) {
    const node = findNode(tree, filters.sectionId);
    if (!node) return EMPTY;
    sectionIds = [node, ...flattenTree(node.children)].map((n) => n.id);
    proposalSectionIds = await sectionAndBelow(q, node.id);
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

  /**
   * True for proposals about one of the wanted sections (or that created one
   * of them). Hand it `proposalSectionIds`, which keeps archived subsections.
   */
  const aboutSection = (ids: string[]) =>
    sql`(${inArray(proposals.sectionId, ids)} or ${inArray(proposals.createdSectionId, ids)})`;

  // Comments, on notes and on proposals alike, are found by their own words,
  // author and date. The section and business filters look at what the
  // comment is on: a note's business tag and where it is filed; a proposal's
  // business tag and the section it is about (the same test as for the
  // proposals themselves, below). A comment on a direct edit is found too:
  // it is on that edit's own page. A comment on a removed note is not.
  const commentRows = await q
    .select({
      commentId: comments.id,
      noteId: comments.noteId,
      proposalId: comments.proposalId,
      noteLogDate: notes.logDate,
      createdAt: comments.createdAt,
      authorName: users.name,
      text: comments.bodyText,
    })
    .from(comments)
    .leftJoin(notes, eq(notes.id, comments.noteId))
    .leftJoin(proposals, eq(proposals.id, comments.proposalId))
    .innerJoin(users, eq(users.id, comments.createdBy))
    .where(
      and(
        containsAll(comments.bodyText, words),
        isNull(notes.removedAt),
        filters.from ? sql`${centralDay(comments.createdAt)} >= ${filters.from}::date` : undefined,
        filters.to ? sql`${centralDay(comments.createdAt)} <= ${filters.to}::date` : undefined,
        filters.authorId ? eq(comments.createdBy, filters.authorId) : undefined,
        businessTags
          ? sql`(${inArray(notes.businessTag, businessTags)} or ${inArray(proposals.businessTag, businessTags)})`
          : undefined,
        sectionIds && proposalSectionIds
          ? sql`(${filedUnder(sectionIds)} or ${aboutSection(proposalSectionIds)})`
          : undefined,
      ),
    )
    .orderBy(desc(comments.createdAt), desc(comments.id))
    .limit(MAX_PER_TYPE + 1);
  const moreComments = commentRows.length > MAX_PER_TYPE;
  commentRows.length = Math.min(commentRows.length, MAX_PER_TYPE);
  const commentHits: CommentHit[] = commentRows.map((row) => ({
    commentId: row.commentId,
    noteId: row.noteId,
    proposalId: row.proposalId,
    logDate: row.noteLogDate ?? centralDateKey(row.createdAt),
    createdAt: row.createdAt,
    authorName: row.authorName,
    excerpt: excerptAround(row.text, words),
  }));

  // Proposals: found by their title, description, proposed text or the
  // reason they were declined for. The date filter uses the day it was
  // proposed, the author filter who proposed it.
  const proposalText = sql<string>`${proposals.title} || E'\n' || ${proposals.descriptionText} || E'\n' || coalesce(${proposals.proposedOfficialText}, '') || E'\n' || coalesce(${proposals.declineReason}, '')`;
  const proposalRows = await q
    .select({
      proposalId: proposals.id,
      createdAt: proposals.createdAt,
      proposedByName: users.name,
      text: proposalText,
    })
    .from(proposals)
    .leftJoin(users, eq(users.id, proposals.proposedBy))
    .where(
      and(
        eq(proposals.direct, false),
        and(...words.map((word) => sql`${proposalText} ilike ${likePattern(word)}`)),
        proposalSectionIds ? aboutSection(proposalSectionIds) : undefined,
        businessTags ? inArray(proposals.businessTag, businessTags) : undefined,
        filters.authorId ? eq(proposals.proposedBy, filters.authorId) : undefined,
        filters.from ? sql`${centralDay(proposals.createdAt)} >= ${filters.from}::date` : undefined,
        filters.to ? sql`${centralDay(proposals.createdAt)} <= ${filters.to}::date` : undefined,
      ),
    )
    .orderBy(desc(proposals.createdAt), desc(proposals.id))
    .limit(MAX_PER_TYPE);
  // What `displayTitle` needs to name each of them (one more query).
  const titleFields = await titleFieldsFor(
    q,
    proposalRows.map((row) => row.proposalId),
  );
  const proposalHits: ProposalHit[] = proposalRows.flatMap((row) => {
    const fields = titleFields.get(row.proposalId);
    if (!fields) return [];
    return [
      {
        ...fields,
        proposalId: row.proposalId,
        createdAt: row.createdAt,
        proposedByName: row.proposedByName,
        excerpt: excerptAround(row.text, words),
      },
    ];
  });

  return {
    sections: sectionHits,
    official: officialHits,
    notes: noteHits,
    comments: commentHits,
    proposals: proposalHits,
    moreNotes,
    moreComments,
  };
}
