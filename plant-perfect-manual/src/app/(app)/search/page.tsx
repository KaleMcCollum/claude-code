import type { Metadata } from "next";
import Link from "next/link";
import { asUser } from "@/db/client";
import { requireUser } from "@/lib/auth/session";
import { type SearchHit, search } from "@/lib/search";
import { loadTree } from "@/lib/sections";

export const metadata: Metadata = { title: "Search" };

/** Show `text` with every place the search words appear marked. */
function Highlight({ text, query }: { text: string; query: string }) {
  const lower = text.toLowerCase();
  const needle = query.toLowerCase();
  const parts: React.ReactNode[] = [];
  let from = 0;
  for (let at = lower.indexOf(needle); needle && at >= 0; at = lower.indexOf(needle, from)) {
    if (at > from) parts.push(text.slice(from, at));
    parts.push(<mark key={at}>{text.slice(at, at + needle.length)}</mark>);
    from = at + needle.length;
  }
  parts.push(text.slice(from));
  return <>{parts}</>;
}

function Hits({ title, hits, query }: { title: string; hits: SearchHit[]; query: string }) {
  if (hits.length === 0) return null;
  return (
    <section aria-label={title}>
      <h2 style={{ marginTop: 24 }}>{title}</h2>
      <ul className="results">
        {hits.map((hit) => (
          <li key={hit.sectionId}>
            <Link href={`/sections/${hit.sectionId}`}>
              {hit.number} <Highlight text={hit.title} query={query} />
            </Link>
            {hit.excerpt && (
              <p className="excerpt">
                <Highlight text={hit.excerpt} query={query} />
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const user = await requireUser();
  const raw = (await searchParams).q;
  const query = (typeof raw === "string" ? raw : "").trim().slice(0, 100);
  const results = await asUser(user.id, async (tx) => search(tx, await loadTree(tx), query));
  const total = results.sections.length + results.official.length;

  return (
    <>
      <div className="page-head">
        <h1>Search</h1>
        {query.length >= 2 && (
          <p className="meta">
            {total === 0 ? "Nothing found" : `${total} ${total === 1 ? "result" : "results"}`} for
            &ldquo;{query}&rdquo;
          </p>
        )}
      </div>
      {query.length < 2 && <p className="muted">Type at least two letters in the search box.</p>}
      <Hits title="Sections" hits={results.sections} query={query} />
      <Hits title="Official text" hits={results.official} query={query} />
      <p className="muted small" style={{ marginTop: 28 }}>
        Search covers section names and official text for now. Notes, to-dos, quotes and documents
        are added to search as those parts are built.
      </p>
    </>
  );
}
