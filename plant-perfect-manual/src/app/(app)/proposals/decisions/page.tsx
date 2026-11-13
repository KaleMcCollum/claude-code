import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { sectionOf } from "@/components/decisions/words";
import { asUser } from "@/db/client";
import { requireUser } from "@/lib/auth/session";
import { BUSINESS_LABELS, isBusinessTag } from "@/lib/business";
import { approvalLine, endorsementLine } from "@/lib/official";
import {
  type DecisionFilters,
  PROPOSAL_TYPE_LABELS,
  activeApprovers,
  displayTitle,
  listDecisions,
} from "@/lib/proposals";
import { findNode, flattenTree, isUuid, loadTree } from "@/lib/sections";
import { formatDate, isDateKey } from "@/lib/time";

export const metadata: Metadata = { title: "Decisions Log" };

type Params = { [key: string]: string | string[] | undefined };

/** How many decisions one page lists. */
const SHOWN = 200;

function one(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

/**
 * The Decisions Log: every approved decision, newest first. Read-only. It is
 * not a separate record: it is the approved proposals themselves, including
 * direct edits and restored versions.
 */
export default async function DecisionsLogPage({ searchParams }: { searchParams: Promise<Params> }) {
  const user = await requireUser();
  const params = await searchParams;

  const { tree, approvers, filters, decisions } = await asUser(user.id, async (tx) => {
    const sectionTree = await loadTree(tx);
    const owners = await activeApprovers(tx);
    // Only keep filter values that are real: a section, a business, a person, a date.
    const sectionId = one(params.section);
    const business = one(params.business);
    const approverId = one(params.approver);
    const from = one(params.from);
    const to = one(params.to);
    const wanted: DecisionFilters = {
      sectionId: isUuid(sectionId) && findNode(sectionTree, sectionId) ? sectionId : null,
      business: isBusinessTag(business) ? business : null,
      approverId: isUuid(approverId) && owners.some((owner) => owner.id === approverId) ? approverId : null,
      from: isDateKey(from) ? from : null,
      to: isDateKey(to) ? to : null,
    };
    return {
      tree: sectionTree,
      approvers: owners,
      filters: wanted,
      // One more than is shown, to know whether there are older ones.
      decisions: await listDecisions(tx, sectionTree, wanted, SHOWN + 1),
    };
  });
  const filtering = Object.values(filters).some(Boolean);
  const shown = decisions.slice(0, SHOWN);

  return (
    <>
      <div className="page-head">
        <nav className="crumbs" aria-label="Back">
          <Link href="/proposals">Proposals</Link>
        </nav>
        <h1>Decisions Log</h1>
        <p className="meta">Every approved decision, newest first.</p>
      </div>

      <details className="filters-plain" open={filtering}>
        <summary>Filters{filtering ? " (in use)" : ""}</summary>
        {/* A new set of filters (or Clear) starts the fields again from what is in use. */}
        <Form key={JSON.stringify(filters)} action="/proposals/decisions">
          <div className="filter-grid">
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
              <span>Approved by</span>
              <select className="select" name="approver" defaultValue={filters.approverId ?? ""}>
                <option value="">Anyone</option>
                {approvers.map((owner) => (
                  <option key={owner.id} value={owner.id}>
                    {owner.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>From</span>
              <input className="input" type="date" name="from" defaultValue={filters.from ?? ""} />
            </label>
            <label className="field">
              <span>To</span>
              <input className="input" type="date" name="to" defaultValue={filters.to ?? ""} />
            </label>
          </div>
          <div className="row">
            <button type="submit" className="btn">
              Apply
            </button>
            <Link className="tap-link" href="/proposals/decisions">
              Clear
            </Link>
          </div>
        </Form>
      </details>

      {shown.length === 0 ? (
        <p className="muted" style={{ marginTop: 16 }}>
          {filtering ? "No decisions match these filters." : "No decisions yet."}
        </p>
      ) : (
        <ul className="decision-list" aria-label="Decisions" style={{ marginTop: 12 }}>
          {shown.map((view) => {
            const section = sectionOf(view, tree);
            const created = view.createdSectionId ? findNode(tree, view.createdSectionId) : null;
            const approved = approvalLine(view.approvals);
            return (
              <li key={view.id}>
                <Link className="title" href={`/proposals/${view.id}`}>
                  {displayTitle(view, tree)}
                </Link>
                <p className="muted small">
                  {formatDate(view.decidedAt ?? view.createdAt)}
                  {section && (
                    <>
                      {" · "}
                      {section.node ? (
                        <Link href={`/sections/${section.node.id}`}>{section.text}</Link>
                      ) : (
                        section.text
                      )}
                    </>
                  )}
                  {created && (
                    <>
                      {" · "}
                      <Link href={`/sections/${created.id}`}>
                        {created.number} {created.title}
                      </Link>
                    </>
                  )}
                  {" · "}
                  {PROPOSAL_TYPE_LABELS[view.type]}
                  {view.businessTag && ` · ${BUSINESS_LABELS[view.businessTag]}`}
                </p>
                {approved && <p className="approved">{approved}</p>}
                {view.endorsements.map((endorsement) => (
                  <p key={endorsement.userId} className="endorsements">
                    {endorsementLine(endorsement)}
                  </p>
                ))}
                {/* On a line of its own, as on Today. */}
                {view.superseded && <p className="muted small">No longer the current text</p>}
              </li>
            );
          })}
        </ul>
      )}
      {decisions.length > SHOWN && (
        <p className="muted small" style={{ marginTop: 12 }}>
          Showing the newest {SHOWN}. Use the filters to find older ones.
        </p>
      )}
    </>
  );
}
