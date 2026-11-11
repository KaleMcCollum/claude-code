import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ProposalForm } from "@/components/decisions/ProposalForm";
import { sectionOf } from "@/components/decisions/words";
import { toSectionOptions } from "@/components/notes/data";
import { asUser } from "@/db/client";
import { requireUser } from "@/lib/auth/session";
import { canEditProposal, loadProposal } from "@/lib/proposals";
import { docToLines } from "@/lib/richtext";
import { loadTree } from "@/lib/sections";

export const metadata: Metadata = { title: "Edit proposal" };

/**
 * Changing a proposal that is still open. Only its proposer can, and only
 * until someone else has approved or endorsed it. Anyone else is sent to the
 * proposal's page.
 */
export default async function EditProposalPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const data = await asUser(user.id, async (tx) => {
    const view = await loadProposal(tx, id);
    return view ? { view, tree: await loadTree(tx) } : null;
  });
  if (!data) notFound();
  const { view, tree } = data;
  if (!canEditProposal(view, user)) redirect(`/proposals/${view.id}`);

  const section = sectionOf(view, tree);
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
          section={view.sectionId && section ? { id: view.sectionId, label: section.text } : null}
          startDoc={view.proposedOfficial}
          options={toSectionOptions(tree)}
          otherApprovers={[]}
          initial={{ title: view.title, businessTag: view.businessTag, why }}
        />
      )}
    </>
  );
}
