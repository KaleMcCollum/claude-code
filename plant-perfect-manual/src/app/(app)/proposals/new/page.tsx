import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { RichText } from "@/components/RichText";
import { ProposalForm, type ProposalKind } from "@/components/decisions/ProposalForm";
import { toSectionOptions } from "@/components/notes/data";
import { asUser } from "@/db/client";
import { requireUser } from "@/lib/auth/session";
import { loadNote } from "@/lib/notes";
import { loadOfficial } from "@/lib/official";
import { can } from "@/lib/permissions";
import { activeApprovers } from "@/lib/proposals";
import { findNode, isUuid, loadTree } from "@/lib/sections";
import { formatDateTime } from "@/lib/time";

export const metadata: Metadata = { title: "New proposal" };

type Params = { [key: string]: string | string[] | undefined };

function one(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

/**
 * The form for a new proposal. The address can say what it starts from:
 * `?section=<id>` (Propose a change on a section page), `?note=<id>`
 * (Propose on a note), `?kind=structure` (a change to the sections).
 * `?pick=1` asks for the list of sections even when one could be guessed.
 */
export default async function NewProposalPage({ searchParams }: { searchParams: Promise<Params> }) {
  const user = await requireUser();
  if (!can(user, "propose")) redirect("/proposals");
  const params = await searchParams;
  const sectionParam = one(params.section);
  const noteParam = one(params.note);
  const kindParam = one(params.kind);
  const kind: ProposalKind =
    kindParam === "structure" ? "structure" : kindParam === "wording" ? "official_text" : "decision";

  const { options, node, official, note, suggested, others } = await asUser(user.id, async (tx) => {
    const tree = await loadTree(tx);
    const sectionOptions = toSectionOptions(tree);
    const found = isUuid(noteParam) ? await loadNote(tx, tree, noteParam) : null;
    const sourceNote = found && found.removedAt === null ? found : null;
    // Sections the note is filed under (archived ones cannot be proposed for).
    const filed = sourceNote
      ? sectionOptions.filter((option) => sourceNote.sections.some((link) => link.id === option.id))
      : [];
    let chosen = isUuid(sectionParam) ? findNode(tree, sectionParam) : null;
    // A note filed under exactly one section: that is the section, unless asked otherwise.
    if (!chosen && params.pick !== "1" && filed.length === 1) chosen = findNode(tree, filed[0].id);
    return {
      options: sectionOptions,
      node: chosen,
      official: chosen ? await loadOfficial(tx, chosen.id) : null,
      note: sourceNote,
      suggested: filed,
      others: (await activeApprovers(tx)).filter((owner) => owner.id !== user.id).map((owner) => owner.name),
    };
  });

  return (
    <>
      <div className="page-head">
        <nav className="crumbs" aria-label="Back">
          <Link href="/proposals">Proposals</Link>
        </nav>
        <h1>New proposal</h1>
      </div>

      <ProposalForm
        mode="new"
        kind={kind}
        section={node ? { id: node.id, label: `${node.number} ${node.title}` } : null}
        startDoc={official?.content ?? null}
        options={options}
        suggested={suggested}
        noteId={note?.id ?? null}
        fromNote={
          note && (
            <div className="from-note">
              <p className="byline">
                {formatDateTime(note.createdAt)} · <span className="who">{note.authorName}</span>
              </p>
              <RichText doc={note.body} />
            </div>
          )
        }
        otherApprovers={others}
      />
    </>
  );
}
