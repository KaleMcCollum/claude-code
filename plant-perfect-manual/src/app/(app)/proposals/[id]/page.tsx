import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { RichText } from "@/components/RichText";
import { DiffView } from "@/components/decisions/DiffView";
import { ProposalActions } from "@/components/decisions/ProposalActions";
import { ProposalCommentBox } from "@/components/decisions/ProposalCommentBox";
import { sectionOf } from "@/components/decisions/words";
import { NoteBlock } from "@/components/notes/NoteBlock";
import { toNoteBlockData } from "@/components/notes/data";
import { asUser } from "@/db/client";
import { requireUser } from "@/lib/auth/session";
import { BUSINESS_LABELS } from "@/lib/business";
import { loadNotesByIds } from "@/lib/notes";
import { endorsementLine, joinNames } from "@/lib/official";
import { can } from "@/lib/permissions";
import {
  PROPOSAL_TYPE_LABELS,
  activeApprovers,
  approveChoices,
  canApproveToo,
  canEditProposal,
  canEndorse,
  changesNotApprovedBy,
  describeStructure,
  displayTitle,
  loadProposal,
  loadProposalComments,
  loadTextChange,
  proposalsForNotes,
  sourceNoteIds,
  statusLine,
  waitingFor,
} from "@/lib/proposals";
import { findNode, loadTree } from "@/lib/sections";
import { formatDate, formatDateTime } from "@/lib/time";

type PageProps = { params: Promise<{ id: string }> };

const loadPage = cache(async (id: string) => {
  const user = await requireUser();
  return asUser(user.id, async (tx) => {
    const view = await loadProposal(tx, id);
    if (!view) return null;
    const tree = await loadTree(tx);
    // Removed notes are left out: they are hidden everywhere else too.
    const notes = (await loadNotesByIds(tx, tree, await sourceNoteIds(tx, id))).filter(
      (note) => note.removedAt === null,
    );
    const approvers = await activeApprovers(tx);
    return {
      user,
      view,
      tree,
      approvers,
      change: await loadTextChange(tx, view),
      // For someone about to approve a change to official text: the changes
      // already in that text which they have never approved.
      unapproved:
        view.type !== "structure" && view.sectionId && approveChoices(view, user, approvers).approve
          ? await changesNotApprovedBy(tx, view.sectionId, user)
          : null,
      notes,
      noteProposals: await proposalsForNotes(
        tx,
        notes.map((note) => note.id),
      ),
      comments: await loadProposalComments(tx, id),
    };
  });
});

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const data = await loadPage((await params).id);
  return { title: data ? displayTitle(data.view, data.tree) : "Proposal not found" };
}

/** What the differences are measured against, said in one sentence. */
const COMPARED_WITH = {
  now: "Compared with the official text now.",
  replaced: "Compared with the text it replaced.",
  then: "Compared with the official text when it was proposed.",
};

/** One proposal: what it changes, where it stands, who approved, and the talk about it. */
export default async function ProposalPage({ params }: PageProps) {
  const data = await loadPage((await params).id);
  if (!data) notFound();
  const { user, view, tree, approvers, change, unapproved, notes, noteProposals, comments } = data;

  const open = view.status === "open";
  const approved = view.status === "approved";
  const section = sectionOf(view, tree);
  const choices = approveChoices(view, user, approvers);
  const others = approvers.filter((owner) => owner.id !== user.id).map((owner) => owner.name);
  const created = view.createdSectionId ? findNode(tree, view.createdSectionId) : null;
  const waiting = waitingFor(view, approvers);
  const sectionGone = open && view.sectionId !== null && section?.node === null;
  // The newest change to the section's official text that this person never
  // approved. Versions are numbered from 1 without gaps, so when every one of
  // them is unapproved, they have never approved this section's text at all.
  const notApproved = unapproved?.items[0] ?? null;
  const neverApproved = unapproved !== null && notApproved !== null && unapproved.total >= notApproved.version;

  const facts: React.ReactNode[] = [PROPOSAL_TYPE_LABELS[view.type]];
  if (section) {
    facts.push(
      section.node ? <Link href={`/sections/${section.node.id}`}>{section.text}</Link> : section.text,
    );
  }
  if (view.businessTag) facts.push(BUSINESS_LABELS[view.businessTag]);
  facts.push(
    `${view.direct ? "By" : "Proposed by"} ${view.proposedByName ?? "the app"}, ${formatDateTime(view.createdAt)}`,
  );
  if (view.revision > 1) facts.push("changed after it was proposed");

  return (
    <article className="proposal">
      <header className="page-head">
        <nav className="crumbs" aria-label="Back">
          <Link href="/proposals">Proposals</Link>
        </nav>
        <h1>{displayTitle(view, tree)}</h1>
        <p className={approved ? "proposal-status approved" : "proposal-status"}>{statusLine(view)}</p>
        {view.status === "declined" && view.declineReason && (
          <p className="proposal-reason">Reason: {view.declineReason}</p>
        )}
        {view.superseded && section && (
          <p className="muted small proposal-superseded">
            This is no longer the current official text of{" "}
            {section.node ? <Link href={`/sections/${section.node.id}`}>{section.text}</Link> : section.text}.
          </p>
        )}
        <p className="meta">
          {facts.map((fact, index) => (
            <span key={index}>
              {index > 0 && " · "}
              {fact}
            </span>
          ))}
        </p>
      </header>

      {view.description && (
        <section className="block" aria-labelledby="why-heading">
          <h2 id="why-heading">Why</h2>
          <RichText doc={view.description} />
        </section>
      )}

      <section className="block" aria-labelledby="change-heading">
        <h2 id="change-heading">{open ? "What will change" : approved ? "What changed" : "What it would have changed"}</h2>
        {change ? (
          <>
            {open && change.changedSince && (
              <p className="notice">
                The official text of this section has changed since this was proposed. Read the
                differences again before approving.
              </p>
            )}
            {/* Not for a section that is gone: there the proposal cannot be approved at all. */}
            {open && unapproved && notApproved && section?.node && (
              <p className="notice">
                {neverApproved
                  ? "You have never approved the official text of this section."
                  : "You have not approved the current official text of this section."}{" "}
                It was last changed
                {notApproved.approvedBy.length > 0 ? ` by ${joinNames(notApproved.approvedBy)}` : ""} on{" "}
                {formatDate(notApproved.savedAt)}
                {!neverApproved &&
                  ` (${unapproved.total} ${unapproved.total === 1 ? "change" : "changes"} since you last approved it)`}
                . Approving this proposal approves the whole text, not only the differences below. See
                the <Link href={`/sections/${section.node.id}/history`}>version history</Link>.
              </p>
            )}
            <p className="muted small">{COMPARED_WITH[change.basis]}</p>
            <DiffView
              before={change.before}
              after={change.after}
              sameMessage="This is what the official text already says."
              beforeHeading={
                change.basis === "now"
                  ? "Official text now"
                  : change.basis === "replaced"
                    ? "The text it replaced"
                    : "Official text when it was proposed"
              }
              afterHeading={approved ? "Text as approved" : "Proposed text"}
            />
            <details className="full-text">
              <summary>{approved ? "Full text as approved" : "Full proposed text"}</summary>
              <div className="official-box">
                <RichText doc={change.after} />
              </div>
            </details>
          </>
        ) : (
          <>
            {sectionGone && (
              <p className="notice">
                The section this is about no longer exists (it may have been archived). Withdraw
                or decline this proposal.
              </p>
            )}
            <p>
              {open && view.structureChange
                ? describeStructure(tree, view.sectionId, view.structureChange)
                : view.title}
              .
            </p>
            {approved && created && (
              <p>
                The new section:{" "}
                <Link href={`/sections/${created.id}`}>
                  {created.number} {created.title}
                </Link>
              </p>
            )}
          </>
        )}
      </section>

      <ProposalActions
        proposalId={view.id}
        seen={
          change
            ? { revision: view.revision, currentVersionId: change.currentVersionId }
            : { revision: view.revision }
        }
        show={{
          approve: choices.approve,
          alone: choices.alone,
          decline: open && can(user, "approve") && view.proposedById !== user.id,
          edit: canEditProposal(view, user),
          withdraw: open && can(user, "propose") && view.proposedById === user.id,
          endorse: canEndorse(view, user),
          approveToo: canApproveToo(view, user),
        }}
        otherApprovers={joinNames(others)}
      />

      <section className="block" aria-labelledby="approvals-heading">
        <h2 id="approvals-heading">Approvals</h2>
        <ul className="plain-list">
          {view.approvals.map((approval) => (
            <li key={approval.userId}>
              {approval.name} approved {formatDateTime(approval.at)}
              {approval.userId === view.proposedById && !view.direct ? " (proposed it)" : ""}
            </li>
          ))}
          {waiting.map((name) => (
            <li key={name} className="muted">
              Waiting for {name}
            </li>
          ))}
        </ul>
        {view.endorsements.map((endorsement) => (
          <p key={endorsement.userId} className="endorsements">
            {endorsementLine(endorsement)}
          </p>
        ))}
      </section>

      {notes.length > 0 && (
        <section className="block" aria-labelledby="notes-heading">
          <h2 id="notes-heading">From these notes</h2>
          <div className="notes">
            {notes.map((note) => (
              <NoteBlock
                key={note.id}
                // This page is the proposal, so the note does not need to point back to it.
                note={toNoteBlockData(
                  note,
                  user.id,
                  (noteProposals.get(note.id) ?? []).filter((proposal) => proposal.id !== view.id),
                )}
                mode="discussion"
                canWrite={false}
                canComment={false}
              />
            ))}
          </div>
        </section>
      )}

      <section className="block" aria-labelledby="comments-heading">
        <h2 id="comments-heading">Comments</h2>
        {comments.length > 0 ? (
          <ul className="proposal-comments" aria-label="Comments on this proposal">
            {comments.map((comment) => (
              <li key={comment.id}>
                <p className="byline">
                  {formatDateTime(comment.createdAt)} · <span className="who">{comment.authorName}</span>
                </p>
                <RichText doc={comment.body} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No comments yet.</p>
        )}
        {can(user, "comment") && <ProposalCommentBox proposalId={view.id} />}
      </section>
    </article>
  );
}
