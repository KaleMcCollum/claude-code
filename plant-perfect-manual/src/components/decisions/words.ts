import { type ProposalView, sectionText } from "@/lib/proposals";
import { type SectionNode, findNode } from "@/lib/sections";

/**
 * The section a proposal is about, for showing next to it: `text` is what to
 * print (worked out by the rules layer: "2.3 Hiring" as it is named and
 * numbered now, or "Hiring (archived)" for one that is no longer among the
 * sections), `node` is the section to link to, missing when it is no longer
 * among the sections. Null when the proposal has no section (adding a
 * top-level section).
 */
export function sectionOf(
  view: Pick<ProposalView, "sectionId" | "sectionTitle">,
  tree: SectionNode[],
): { node: SectionNode | null; text: string } | null {
  const text = sectionText(view, tree);
  if (!view.sectionId || text === null) return null;
  return { node: findNode(tree, view.sectionId), text };
}
