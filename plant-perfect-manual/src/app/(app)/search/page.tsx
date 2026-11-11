import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { asUser } from "@/db/client";
import { requireUser } from "@/lib/auth/session";
import { BUSINESS_LABELS, isBusinessTag } from "@/lib/business";
import {
  type CommentHit,
  type NoteHit,
  type SearchFilters,
  type SearchHit,
  MAX_PER_TYPE,
  search,
  searchWords,
} from "@/lib/search";
import { findNode, flattenTree, isUuid, loadTree } from "@/lib/sections";
import { formatDateTime, isDateKey } from "@/lib/time";
import { loadUserNames } from "@/lib/users";

export const metadata: Metadata = { title: "Search" };

type Params = { [key: string]: string | string[] | undefined };

function one(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

/** Show `text` with every place one of the search words appears marked. */
function Highlight({ text, query }: { text: string; query: string }) {
  const lower = text.toLowerCase();
  const words = searchWords(query);
  const parts: React.ReactNode[] = [];
  let from = 0;
  while (from < text.length) {
    // The earliest next match of any word (the longest word wins a tie).
    let at = -1;
    let length = 0;
    for (const word of words) {
      const found = lower.indexOf(word, from);
      if (found >= 0 && (at < 0 || found < at || (found === at && word.length > length))) {
        at = found;
        length = word.length;
      }
    }
    if (at < 0) break;
    if (at > from) parts.push(text.slice(from, at));
    parts.push(<mark key={at}>{text.slice(at, at + length)}</mark>);
    from = at + length;
  }
  parts.push(text.slice(from));
  return <>{parts}</>;
}

function SectionHits({ title, hits, query }: { title: string; hits: SearchHit[]; query: string }) {
  if (hits.length === 0) return null;
  return (
    <section aria-label={title}>
      <h2 className="results-heading">
        {title} ({hits.length})
      </h2>
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

/** Said under a list that was cut short, so nobody takes it for the whole answer. */
function CutShort({ what }: { what: string }) {
  return (
    <p className="muted small">
      Showing the newest {MAX_PER_TYPE} {what}. There are more: add a word or use the filters to
      narrow it down.
    </p>
  );
}

function NoteHits({ hits, more, query }: { hits: NoteHit[]; more: boolean; query: string }) {
  if (hits.length === 0) return null;
  return (
    <section aria-label="Notes">
      <h2 className="results-heading">
        Notes ({hits.length}
        {more ? "+" : ""})
      </h2>
      {more && <CutShort what="notes" />}
      <ul className="results">
        {hits.map((hit) => (
          <li key={hit.noteId}>
            <Link href={`/daily-log/${hit.logDate}#note-${hit.noteId}`}>
              Note by {hit.authorName}, {formatDateTime(hit.createdAt)}
            </Link>
            <p className="excerpt">
              <Highlight text={hit.excerpt} query={query} />
            </p>
            {(hit.sections.length > 0 || hit.businessTag) && (
              <p className="muted small">
                {hit.businessTag && `${BUSINESS_LABELS[hit.businessTag]}. `}
                {hit.sections.length > 0 &&
                  `Filed under ${hit.sections.map((s) => (s.number ? `${s.number} ${s.title}` : s.title)).join(", ")}.`}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function CommentHits({ hits, more, query }: { hits: CommentHit[]; more: boolean; query: string }) {
  if (hits.length === 0) return null;
  return (
    <section aria-label="Comments">
      <h2 className="results-heading">
        Comments ({hits.length}
        {more ? "+" : ""})
      </h2>
      {more && <CutShort what="comments" />}
      <ul className="results">
        {hits.map((hit) => (
          <li key={hit.commentId}>
            <Link href={`/daily-log/${hit.logDate}#note-${hit.noteId}`}>
              Comment by {hit.authorName}, {formatDateTime(hit.createdAt)}
            </Link>
            <p className="excerpt">
              <Highlight text={hit.excerpt} query={query} />
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<Params> }) {
  const user = await requireUser();
  const params = await searchParams;
  const query = one(params.q).trim().slice(0, 100);

  const data = await asUser(user.id, async (tx) => {
    const tree = await loadTree(tx);
    const names = await loadUserNames(tx);
    // Only keep filter values that are real: a date, a section, a person.
    const from = one(params.from);
    const to = one(params.to);
    const sectionId = one(params.section);
    const business = one(params.business);
    const authorId = one(params.author);
    const filters: SearchFilters = {
      from: isDateKey(from) ? from : null,
      to: isDateKey(to) ? to : null,
      sectionId: isUuid(sectionId) && findNode(tree, sectionId) ? sectionId : null,
      business: isBusinessTag(business) ? business : null,
      authorId: isUuid(authorId) && names.has(authorId) ? authorId : null,
    };
    return { tree, names, filters, results: await search(tx, tree, query, filters) };
  });
  const { tree, names, filters, results } = data;
  const filtering = Object.values(filters).some(Boolean);
  const total =
    results.sections.length + results.official.length + results.notes.length + results.comments.length;
  const people = [...names.entries()].sort((a, b) => a[1].localeCompare(b[1]));

  return (
    <>
      <div className="page-head">
        <h1>Search</h1>
      </div>

      <Form action="/search" className="search-page-form" role="search">
        <div className="row">
          <input
            className="input"
            type="search"
            name="q"
            defaultValue={query}
            placeholder="Search notes, official text and sections"
            aria-label="Search for"
          />
          <button type="submit" className="btn btn-primary">
            Search
          </button>
        </div>
        <details className="filters" open={filtering}>
          <summary>Filters{filtering ? " (in use)" : ""}</summary>
          <div className="filter-grid">
            <label className="field">
              <span>From date</span>
              <input className="input" type="date" name="from" defaultValue={filters.from ?? ""} />
            </label>
            <label className="field">
              <span>To date</span>
              <input className="input" type="date" name="to" defaultValue={filters.to ?? ""} />
            </label>
            <label className="field">
              <span>Section</span>
              <select className="select" name="section" defaultValue={filters.sectionId ?? ""}>
                <option value="">Any section</option>
                {flattenTree(tree).map((node) => (
                  <option key={node.id} value={node.id}>
                    {node.number} {node.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Business</span>
              <select className="select" name="business" defaultValue={filters.business ?? ""}>
                <option value="">Any</option>
                <option value="garden_center">{BUSINESS_LABELS.garden_center}</option>
                <option value="coffee_shop">{BUSINESS_LABELS.coffee_shop}</option>
              </select>
            </label>
            <label className="field">
              <span>Written by</span>
              <select className="select" name="author" defaultValue={filters.authorId ?? ""}>
                <option value="">Anyone</option>
                {people.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="row">
            <button type="submit" className="btn">
              Apply filters
            </button>
            {filtering && <Link href={`/search?q=${encodeURIComponent(query)}`}>Clear filters</Link>}
          </div>
        </details>
      </Form>

      {query.length < 2 ? (
        <p className="muted">Type at least two letters to search.</p>
      ) : (
        <p className="meta" role="status">
          {total === 0
            ? "Nothing found"
            : `${total}${results.moreNotes || results.moreComments ? " or more" : ""} ${total === 1 ? "result" : "results"}`}{" "}
          for
          &ldquo;{query}&rdquo;{filtering ? " with these filters" : ""}
        </p>
      )}

      <SectionHits title="Sections" hits={results.sections} query={query} />
      <SectionHits title="Official text" hits={results.official} query={query} />
      <NoteHits hits={results.notes} more={results.moreNotes} query={query} />
      <CommentHits hits={results.comments} more={results.moreComments} query={query} />

      <p className="muted small" style={{ marginTop: 28 }}>
        Search covers section names, official text, notes and comments. Proposals, to-dos, quotes
        and documents are added as those parts are built.
      </p>
    </>
  );
}
