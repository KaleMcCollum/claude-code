import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { OfficialBlock } from "@/components/OfficialBlock";
import { RichText } from "@/components/RichText";
import { ActionButton } from "@/components/decisions/ActionButton";
import { ENDORSE_QUESTION } from "@/components/decisions/endorse";
import { NoteBlock } from "@/components/notes/NoteBlock";
import { toNoteBlockData } from "@/components/notes/data";
import { asUser } from "@/db/client";
import { requireUser } from "@/lib/auth/session";
import { BUSINESS_LABELS } from "@/lib/business";
import { loadDiscussion } from "@/lib/notes";
import { approvalLine, endorsementLine, loadOfficial } from "@/lib/official";
import { can } from "@/lib/permissions";
import {
  activeApprovers,
  canApproveToo,
  canEndorse,
  displayTitle,
  listOpenProposalsForSection,
  loadProposal,
  proposalsForNotes,
  waitingText,
} from "@/lib/proposals";
import { isEmptyDoc } from "@/lib/richtext";
import { isUuid, loadTree, pathTo } from "@/lib/sections";
import { formatDate } from "@/lib/time";
import { loadUserNames } from "@/lib/users";
import { addApprovalAction, endorseProposalAction } from "../../proposals/actions";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

type Order = "newest" | "oldest";
type BusinessFilter = "garden_center" | "coffee_shop" | null;

/** The section's address with the Discussion order and filter kept in it. */
function discussionHref(sectionId: string, order: Order, business: BusinessFilter): string {
  const query = new URLSearchParams();
  if (order === "oldest") query.set("order", "oldest");
  if (business) query.set("business", business);
  const text = query.toString();
  return `/sections/${sectionId}${text ? `?${text}` : ""}`;
}

/** One choice in a row of choices: plain text when it is the current one, a link otherwise. */
function Choice({ href, current, children }: { href: string; current: boolean; children: string }) {
  return current ? (
    <span className="current" aria-current="true">
      {children}
    </span>
  ) : (
    // Stay where you are on the page; only the list below changes.
    <Link href={href} scroll={false}>
      {children}
    </Link>
  );
}

const loadPage = cache(async (id: string) => {
  const user = await requireUser();
  if (!isUuid(id)) return null;
  return asUser(user.id, async (tx) => {
    const tree = await loadTree(tx);
    const path = pathTo(tree, id);
    const node = path.at(-1);
    if (!node) return null;
    const official = await loadOfficial(tx, id);
    return {
      user,
      tree,
      path,
      node,
      official,
      // The approved change behind the text on screen: its approvals can still grow.
      officialProposal: official ? await loadProposal(tx, official.proposalId) : null,
      waiting: await listOpenProposalsForSection(tx, id),
      approvers: await activeApprovers(tx),
      names: await loadUserNames(tx),
    };
  });
});

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const data = await loadPage((await params).id);
  return { title: data ? `${data.node.number} ${data.node.title}` : "Section not found" };
}

export default async function SectionPage({ params, searchParams }: PageProps) {
  const data = await loadPage((await params).id);
  if (!data) notFound();
  const { user, tree, path, node, official, officialProposal, waiting, approvers, names } = data;

  // The Discussion's order and business filter live in the address.
  const query = await searchParams;
  const order: Order = query.order === "oldest" ? "oldest" : "newest";
  const business: BusinessFilter =
    query.business === "garden_center" || query.business === "coffee_shop" ? query.business : null;
  const { thread, noteProposals } = await asUser(user.id, async (tx) => {
    const notes = await loadDiscussion(tx, tree, node.id, { order, business });
    return {
      thread: notes,
      noteProposals: await proposalsForNotes(
        tx,
        notes.map((note) => note.id),
      ),
    };
  });
  const canComment = can(user, "comment");
  const parents = path.slice(0, -1);
  const updatedBy = node.updatedBy ? names.get(node.updatedBy) : null;
  const hasOfficialText = official !== null && !isEmptyDoc(official.content);
  const approved = official ? approvalLine(official.approvals) : null;

  return (
    <article>
      <header className="page-head">
        {parents.length > 0 && (
          <nav className="crumbs" aria-label="Parent sections">
            {parents.map((parent, index) => (
              <span key={parent.id}>
                {index > 0 && " / "}
                <Link href={`/sections/${parent.id}`}>
                  {parent.number} {parent.title}
                </Link>
              </span>
            ))}
          </nav>
        )}
        <h1>
          <span className="num">{node.number}</span> {node.title}
        </h1>
        <p className="meta">
          Last updated {formatDate(node.updatedAt)}
          {updatedBy ? ` by ${updatedBy}` : " (starting setup)"}
        </p>
      </header>

      {node.children.length > 0 && (
        <section className="block" aria-labelledby="subsections-heading">
          <div className="block-head">
            <h2 id="subsections-heading">Subsections</h2>
          </div>
          <ul className="sublist">
            {node.children.map((child) => (
              <li key={child.id}>
                <Link href={`/sections/${child.id}`}>
                  <span className="num">{child.number}</span>
                  <span>{child.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <OfficialBlock
        // A new saved version resets the block, so it never shows stale text.
        key={official?.id ?? "none"}
        sectionId={node.id}
        doc={official?.content ?? null}
        versionId={official?.id ?? null}
        canEdit={can(user, "edit_official")}
        canPropose={can(user, "propose")}
      >
        {waiting.length > 0 && (
          <div className="official-notices">
            {waiting.map((proposal) => {
              // Who it is waiting for, and for what ("Waiting for you").
              const who = waitingText(proposal, approvers, user.id);
              return (
                <p key={proposal.id} className="notice">
                  Waiting for approval:{" "}
                  <Link href={`/proposals/${proposal.id}`}>{displayTitle(proposal, tree)}</Link>
                  {who && `. ${who}${who.endsWith(".") ? "" : "."}`}
                </p>
              );
            })}
          </div>
        )}
        <div className="official-box">
          {hasOfficialText && official ? (
            <RichText doc={official.content} />
          ) : (
            <p className="muted" style={{ margin: 0 }}>
              No official text yet.
            </p>
          )}
          {approved && hasOfficialText && <p className="approval">{approved}</p>}
          {approved && !hasOfficialText && (
            <p className="meta">
              Official text removed. {approved}.
            </p>
          )}
          {official?.endorsements.map((endorsement) => (
            <p key={endorsement.userId} className="endorsements">
              {endorsementLine(endorsement)}
            </p>
          ))}
          {official && (
            <div className="official-actions">
              {officialProposal && canApproveToo(officialProposal, user) && (
                <ActionButton
                  label="I approve too"
                  look="quiet"
                  action={addApprovalAction.bind(null, officialProposal.id)}
                />
              )}
              {officialProposal && canEndorse(officialProposal, user) && (
                <ActionButton
                  label="Endorse"
                  look="quiet"
                  action={endorseProposalAction.bind(null, officialProposal.id, {
                    revision: officialProposal.revision,
                  })}
                  // Someone who can approve is asked first: it is not a softer "I approve too".
                  confirm={can(user, "approve") ? ENDORSE_QUESTION : undefined}
                />
              )}
              <Link href={`/sections/${node.id}/history`}>Version history</Link>
            </div>
          )}
        </div>
      </OfficialBlock>

      <section className="block" aria-labelledby="discussion-heading">
        <div className="block-head">
          <h2 id="discussion-heading">Discussion</h2>
        </div>
        {(thread.length > 0 || business) && (
          <nav className="discussion-controls" aria-label="Discussion order and filter">
            <span>
              <Choice href={discussionHref(node.id, "newest", business)} current={order === "newest"}>
                Newest first
              </Choice>
              {" · "}
              <Choice href={discussionHref(node.id, "oldest", business)} current={order === "oldest"}>
                Oldest first
              </Choice>
            </span>
            <span>
              <Choice href={discussionHref(node.id, order, null)} current={business === null}>
                All
              </Choice>
              {" · "}
              <Choice
                href={discussionHref(node.id, order, "garden_center")}
                current={business === "garden_center"}
              >
                {BUSINESS_LABELS.garden_center}
              </Choice>
              {" · "}
              <Choice
                href={discussionHref(node.id, order, "coffee_shop")}
                current={business === "coffee_shop"}
              >
                {BUSINESS_LABELS.coffee_shop}
              </Choice>
            </span>
          </nav>
        )}
        <div className="discussion-box">
          {thread.length > 0 ? (
            <div className="notes">
              {thread.map((note) => (
                <NoteBlock
                  key={note.id}
                  note={toNoteBlockData(note, user.id, tree, noteProposals.get(note.id))}
                  mode="discussion"
                  canWrite={false}
                  canComment={canComment}
                />
              ))}
            </div>
          ) : business ? (
            <p className="muted">No notes here match this filter.</p>
          ) : (
            <p className="muted">
              No discussion yet. Notes sorted into this section will show here, word for word, with
              who wrote them and when.
            </p>
          )}
        </div>
      </section>
    </article>
  );
}
