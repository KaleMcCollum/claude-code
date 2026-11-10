import { desc, ilike } from "drizzle-orm";
import type { Queryable } from "@/db/client";
import { officialVersions } from "@/db/schema";
import { type SectionNode, flattenTree } from "./sections";

export type SearchHit = {
  sectionId: string;
  number: string;
  title: string;
  /** A short piece of the official text around the match, when the match is in the text. */
  excerpt: string | null;
};

export type SearchResults = { sections: SearchHit[]; official: SearchHit[] };

/** Treat what the user typed as plain words, not as a search pattern. */
function likePattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

function excerptAround(text: string, query: string, radius = 90): string {
  const at = text.toLowerCase().indexOf(query.toLowerCase());
  if (at < 0) return text.slice(0, radius * 2);
  const start = Math.max(0, at - radius);
  const end = Math.min(text.length, at + query.length + radius);
  return (start > 0 ? "…" : "") + text.slice(start, end).replace(/\s+/g, " ") + (end < text.length ? "…" : "");
}

/**
 * Search section names and current official text.
 * (Notes, discussion, to-dos and the rest join in as those parts are built.)
 */
export async function search(q: Queryable, tree: SectionNode[], rawQuery: string): Promise<SearchResults> {
  const query = rawQuery.trim().slice(0, 100);
  if (query.length < 2) return { sections: [], official: [] };
  const nodes = flattenTree(tree);
  const byId = new Map(nodes.map((node) => [node.id, node]));

  const needle = query.toLowerCase();
  const sectionHits: SearchHit[] = nodes
    .filter((n) => n.title.toLowerCase().includes(needle) || n.number === query)
    .map((n) => ({ sectionId: n.id, number: n.number, title: n.title, excerpt: null }));

  const rows = await q
    .select({
      sectionId: officialVersions.sectionId,
      version: officialVersions.version,
      text: officialVersions.contentText,
    })
    .from(officialVersions)
    .where(ilike(officialVersions.contentText, likePattern(query)))
    .orderBy(desc(officialVersions.version));

  // Only the current version of each section counts.
  const latest = new Map<string, number>();
  const all = await q
    .select({ sectionId: officialVersions.sectionId, version: officialVersions.version })
    .from(officialVersions);
  for (const row of all) {
    latest.set(row.sectionId, Math.max(latest.get(row.sectionId) ?? 0, row.version));
  }

  const officialHits: SearchHit[] = [];
  for (const row of rows) {
    const node = byId.get(row.sectionId);
    if (!node || latest.get(row.sectionId) !== row.version) continue;
    officialHits.push({
      sectionId: node.id,
      number: node.number,
      title: node.title,
      excerpt: excerptAround(row.text, query),
    });
  }
  officialHits.sort((a, b) => a.number.localeCompare(b.number, "en", { numeric: true }));
  return { sections: sectionHits, official: officialHits };
}
