import { and, eq, isNull } from "drizzle-orm";
import { type Queryable, asUser } from "@/db/client";
import { noteSections, notes, officialVersions } from "@/db/schema";
import { type NoteView, listUnsortedNotes } from "./notes";
import type { Actor } from "./permissions";
import { type ProposalView, activeApprovers, listOneOwnerDecisions, listOpenProposals } from "./proposals";
import { flattenTree, loadTree } from "./sections";
import { loadSettings } from "./settings";
import { centralDateKey, daysBetween } from "./time";

export type StaleSection = {
  id: string;
  number: string;
  title: string;
  updatedAt: Date;
  /** Whole days since the last update. */
  daysAgo: number;
};

export type TodayView = {
  /** Today's date in US Central time, e.g. "2026-11-10". */
  todayKey: string;
  opening: {
    date: string;
    /** Days from today until the opening date (0 = today, negative = past). */
    days: number;
  };
  /** Open proposals, the one waiting longest first. */
  awaiting: ProposalView[];
  /** Approved by one person in the last 14 days (see listOneOwnerDecisions). */
  decidedAlone: ProposalView[];
  /** People who can approve, to say whose approval a proposal is waiting for. */
  approvers: { id: string; name: string }[];
  unsorted: { total: number; notes: NoteView[] };
  stale: { afterDays: number; sections: StaleSection[] };
};

/**
 * Sections that have something in them: official text, or at least one note
 * filed in their Discussion. Only these can go stale. An empty section has
 * nothing to ask "are we still good with this?" about.
 */
async function sectionsWithContent(q: Queryable): Promise<Set<string>> {
  const withContent = new Set<string>();
  const versions = await q
    .select({
      sectionId: officialVersions.sectionId,
      version: officialVersions.version,
      text: officialVersions.contentText,
    })
    .from(officialVersions);
  const latest = new Map<string, { version: number; text: string }>();
  for (const row of versions) {
    const seen = latest.get(row.sectionId);
    if (!seen || row.version > seen.version) latest.set(row.sectionId, row);
  }
  for (const [sectionId, row] of latest) {
    if (row.text.trim().length > 0) withContent.add(sectionId);
  }
  const filed = await q
    .selectDistinct({ sectionId: noteSections.sectionId })
    .from(noteSections)
    .innerJoin(notes, eq(notes.id, noteSections.noteId))
    .where(and(isNull(noteSections.removedAt), isNull(notes.removedAt)));
  for (const row of filed) withContent.add(row.sectionId);
  return withContent;
}

/**
 * Everything the Today page shows so far. Each part reads the live records
 * (notes, sections, settings); nothing is copied or stored for this page.
 * To-dos and deadlines join in Phase 4.
 */
export async function loadToday(actor: Actor, now: Date = new Date()): Promise<TodayView> {
  return asUser(actor.id, async (tx) => {
    const tree = await loadTree(tx);
    const settings = await loadSettings(tx);
    const todayKey = centralDateKey(now);

    // A section is stale when it has content and that section has not been
    // updated (official text saved, renamed, or a note filed in it) for the
    // set number of days. Archived sections are not in the tree at all.
    const hasContent = await sectionsWithContent(tx);
    const staleSections = flattenTree(tree)
      .filter((node) => hasContent.has(node.id))
      .map((node) => ({
        id: node.id,
        number: node.number,
        title: node.title,
        updatedAt: node.updatedAt,
        daysAgo: daysBetween(centralDateKey(node.updatedAt), todayKey),
      }))
      .filter((section) => section.daysAgo >= settings.staleDays)
      .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime() || a.number.localeCompare(b.number, "en", { numeric: true }));

    return {
      todayKey,
      opening: { date: settings.openingDate, days: daysBetween(todayKey, settings.openingDate) },
      awaiting: await listOpenProposals(tx),
      decidedAlone: await listOneOwnerDecisions(tx, now),
      approvers: await activeApprovers(tx),
      unsorted: await listUnsortedNotes(tx, tree, 10),
      stale: { afterDays: settings.staleDays, sections: staleSections },
    };
  });
}
