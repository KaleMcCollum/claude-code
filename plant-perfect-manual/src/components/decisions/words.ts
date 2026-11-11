import { joinNames } from "@/lib/official";
import type { Actor } from "@/lib/permissions";
import {
  PROPOSAL_STATUS_LABELS,
  type ProposalView,
  approveChoices,
  waitingFor,
} from "@/lib/proposals";
import { type SectionNode, findNode } from "@/lib/sections";

/**
 * Small pieces of wording shared by the screens that list proposals
 * (Proposals, Today, the Decisions Log, a proposal's own page).
 */

/** "Waiting for you" when this person's approval is the one missing, else "Waiting for Casey". */
export function waitingLine(
  view: ProposalView,
  actor: Actor,
  approvers: { id: string; name: string }[],
): string {
  if (approveChoices(view, actor, approvers).approve) return "Waiting for you";
  const names = waitingFor(view, approvers);
  return names.length > 0 ? `Waiting for ${joinNames(names)}` : PROPOSAL_STATUS_LABELS.open;
}

/**
 * The section a proposal is about, for showing next to it: its number and
 * name as they are now. `node` is missing when the section has been archived.
 * Null when the proposal has no section (adding a top-level section).
 */
export function sectionOf(
  view: Pick<ProposalView, "sectionId">,
  tree: SectionNode[],
): { node: SectionNode | null; text: string } | null {
  if (!view.sectionId) return null;
  const node = findNode(tree, view.sectionId);
  return { node, text: node ? `${node.number} ${node.title}` : "a section that has been archived" };
}
