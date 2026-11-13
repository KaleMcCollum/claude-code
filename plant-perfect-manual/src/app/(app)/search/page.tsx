import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { asUser } from "@/db/client";
import { requireUser } from "@/lib/auth/session";
import { BUSINESS_LABELS, isBusinessTag } from "@/lib/business";
import { PROPOSAL_STATUS_LABELS, displayTitle } from "@/lib/proposals";
import {
  type CommentHit,
  type NoteHit,
  type ProposalHit,
  type SearchFilters,
  type SearchHit,
  MAX_PER_TYPE,
  search,
  searchWords,
} from "@/lib/search";
import { type SectionNode, findNode, flattenTree, isUuid, loadTree } from "@/lib/sections";
import { formatDate, formatDateTime, isDateKey } from "@/lib/time";
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
            {/* A comment is on a note or on a proposal: the link goes to whichever it is. */}
            <Link href={hit.proposalId ? `/proposals/${hit.proposalId}` : `/daily-log/${hit.logDate}#note-${hit.noteId}`}>
              Comment by {hit.authorName}, {formatDateTime(hit.createdAt)}
            </Link>
            {hit.proposalId && <span className="muted small"> (on a proposal)</span>}
            <p className="excerpt">
              <Highlight text={hit.excerpt} query={query} />
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Proposals are named as in every other list (`displayTitle`): a section
 * proposal by what it does with the sections as they are named now. What was
 * searched is the title as stored, so the marked words can be in the line
 * under the title only.
 */
function ProposalHits({ hits, query, tree }: { hits: ProposalHit[]; query: string; tree: SectionNode[] }) {
  if (hits.length === 0) return null;
  return (
    <section aria-label="Proposals">
      <h2 className="results-heading">Proposals ({hits.length})</h2>
      <ul className="results">
        {hits.map((hit) => (
          <li key={hit.proposalId}>
            <Link href={`/proposals/${hit.proposalId}`}>
              <Highlight text={displayTitle(hit, tree)} query={query} />
            </Link>
            <p className="muted small" style={{ margin: "2px 0 0" }}>
              {PROPOSAL_STATUS_LABELS[hit.status]} · proposed
              {hit.proposedByName ? ` by ${hit.proposedByName}` : ""}, {formatDate(hit.createdAt)}
            </p>
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
    results.sections.length +
    results.official.length +
    results.proposals.length +
    results.notes.length +
    results.comments.length;
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
          {/* A new set of filters (or Clear filters) starts the fields again from what is in use. */}
          <div className="filter-grid" key={JSON.stringify(filters)}>
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
      <ProposalHits hits={results.proposals} query={query} tree={tree} />
      <NoteHits hits={results.notes} more={results.moreNotes} query={query} />
      <CommentHits hits={results.comments} more={results.moreComments} query={query} />

      <p className="muted small" style={{ marginTop: 28 }}>
        Search covers section names, official text, proposals, notes and comments. To-dos, quotes
        and documents are added as those parts are built.
      </p>
    </>
  );
}
