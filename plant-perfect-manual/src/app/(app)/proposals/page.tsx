import type { Metadata } from "next";
import Link from "next/link";
import { sectionOf, waitingLine } from "@/components/decisions/words";
import { asUser } from "@/db/client";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import {
  PROPOSAL_TYPE_LABELS,
  type ProposalView,
  activeApprovers,
  displayTitle,
  listClosedProposals,
  listOpenProposals,
  statusLine,
} from "@/lib/proposals";
import { type SectionNode, loadTree } from "@/lib/sections";
import { formatDate } from "@/lib/time";

export const metadata: Metadata = { title: "Proposals" };

/** "Decision · 2.1 Wages · proposed by Kale, Nov 10, 2026" */
function factsLine(view: ProposalView, tree: SectionNode[]): string {
  const section = sectionOf(view, tree);
  return [
    PROPOSAL_TYPE_LABELS[view.type],
    section?.text,
    `proposed${view.proposedByName ? ` by ${view.proposedByName}` : ""}, ${formatDate(view.createdAt)}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Proposals: what is waiting for approval, and what was declined or withdrawn. */
export default async function ProposalsPage() {
  const user = await requireUser();
  const { tree, open, closed, approvers } = await asUser(user.id, async (tx) => ({
    tree: await loadTree(tx),
    open: await listOpenProposals(tx),
    closed: await listClosedProposals(tx, 30),
    approvers: await activeApprovers(tx),
  }));

  return (
    <>
      <div className="page-head">
        <h1>Proposals</h1>
      </div>

      <div className="row">
        {can(user, "propose") && (
          <Link className="btn btn-primary" href="/proposals/new">
            New proposal
          </Link>
        )}
        <Link className="btn" href="/proposals/decisions">
          Decisions Log
        </Link>
      </div>

      <section className="block" aria-labelledby="awaiting-heading">
        <div className="block-head">
          <h2 id="awaiting-heading">Awaiting approval ({open.length})</h2>
        </div>
        {open.length === 0 ? (
          <p className="muted">Nothing is waiting for approval.</p>
        ) : (
          <ul className="decision-list">
            {open.map((view) => (
              <li key={view.id}>
                <Link className="title" href={`/proposals/${view.id}`}>
                  {displayTitle(view, tree)}
                </Link>
                <p className="muted small">{factsLine(view, tree)}</p>
                <p className="small">{waitingLine(view, user, approvers)}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {closed.length > 0 && (
        <section className="block" aria-labelledby="closed-heading">
          <div className="block-head">
            <h2 id="closed-heading">Declined or withdrawn</h2>
          </div>
          <ul className="decision-list">
            {closed.map((view) => (
              <li key={view.id}>
                <Link className="title" href={`/proposals/${view.id}`}>
                  {displayTitle(view, tree)}
                </Link>
                <p className="muted small">{factsLine(view, tree)}</p>
                <p className="small">{statusLine(view)}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
