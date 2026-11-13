import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { RichText } from "@/components/RichText";
import { ProposalForm } from "@/components/decisions/ProposalForm";
import { toSectionOptions } from "@/components/notes/data";
import { asUser } from "@/db/client";
import { requireUser } from "@/lib/auth/session";
import { loadOfficial } from "@/lib/official";
import { PROPOSAL_TYPE_LABELS, canEditProposal, loadProposal, sectionText } from "@/lib/proposals";
import { docToLines, isEmptyDoc } from "@/lib/richtext";
import { findNode, loadTree } from "@/lib/sections";

export const metadata: Metadata = { title: "Edit proposal" };

/**
 * Changing a proposal that is still open. Only its proposer can, and only
 * until someone else has approved or endorsed it. Anyone else is sent to the
 * proposal's page. So is the proposer when the section it is about is gone:
 * nothing saved from here could go through then (the proposal's page says so).
 */
export default async function EditProposalPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const data = await asUser(user.id, async (tx) => {
    const view = await loadProposal(tx, id);
    if (!view) return null;
    return {
      view,
      tree: await loadTree(tx),
      // A text proposal is checked against the official text as it is now:
      // the form sends this version back with Save changes.
      official: view.type !== "structure" && view.sectionId ? await loadOfficial(tx, view.sectionId) : null,
    };
  });
  if (!data) notFound();
  const { view, tree, official } = data;
  if (!canEditProposal(view, user)) redirect(`/proposals/${view.id}`);
  if (view.sectionId && !findNode(tree, view.sectionId)) redirect(`/proposals/${view.id}`);

  const change = view.structureChange;
  const why = view.description ? docToLines(view.description) : "";

  return (
    <>
      <div className="page-head">
        <nav className="crumbs" aria-label="Back">
          <Link href={`/proposals/${view.id}`}>Back to the proposal</Link>
        </nav>
        <h1>Edit proposal</h1>
      </div>

      {view.type === "structure" && change ? (
        <ProposalForm
          mode="edit"
          proposalId={view.id}
          kind="structure"
          kindLabels={PROPOSAL_TYPE_LABELS}
          section={null}
          startDoc={null}
          options={toSectionOptions(tree)}
          otherApprovers={[]}
          initial={{
            why,
            action: change.action,
            sectionId: view.sectionId,
            parentId: change.action === "move" ? change.parentId : null,
            name: change.action === "add" || change.action === "rename" ? change.title : "",
          }}
        />
      ) : (
        <ProposalForm
          mode="edit"
          proposalId={view.id}
          kind={view.type === "decision" ? "decision" : "official_text"}
          kindLabels={PROPOSAL_TYPE_LABELS}
          section={view.sectionId ? { id: view.sectionId, label: sectionText(view, tree) ?? "" } : null}
          startDoc={view.proposedOfficial}
          // A copy of the text kept on this device belongs to the proposal as
          // it was saved then. If the proposal has been saved since (from
          // another device), the editor says so before that copy is used.
          baseId={`rev:${view.revision}`}
          seenVersionId={official?.id ?? null}
          checking={view.outOfDate}
          aboveText={
            view.outOfDate && (
              <div className="field official-now">
                <p className="notice">
                  The official text changed after you wrote this. Read it here, change your proposed
                  text if it should include that change, then press Save changes.
                </p>
                <p className="field-label">The official text now</p>
                <div className="official-box">
                  {official && !isEmptyDoc(official.content) ? (
                    <RichText doc={official.content} />
                  ) : (
                    <p className="muted" style={{ margin: 0 }}>
                      No official text.
                    </p>
                  )}
                </div>
              </div>
            )
          }
          options={toSectionOptions(tree)}
          otherApprovers={[]}
          initial={{ title: view.title, businessTag: view.businessTag, why }}
        />
      )}
    </>
  );
}
