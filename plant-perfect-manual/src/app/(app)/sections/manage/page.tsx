import type { Metadata } from "next";
import { type ManageItem, SectionManager } from "@/components/SectionManager";
import { asUser } from "@/db/client";
import { requirePermission } from "@/lib/auth/session";
import {
  MAX_DEPTH,
  MAX_TITLE_LENGTH,
  type SectionNode,
  listArchivedSections,
  loadTree,
} from "@/lib/sections";
import { formatDate } from "@/lib/time";

export const metadata: Metadata = { title: "Edit sections" };

function toItems(nodes: SectionNode[]): ManageItem[] {
  return nodes.map((node) => ({
    id: node.id,
    number: node.number,
    title: node.title,
    depth: node.depth,
    children: toItems(node.children),
  }));
}

export default async function ManageSectionsPage() {
  const user = await requirePermission("structure");
  const { tree, archived } = await asUser(user.id, async (tx) => ({
    tree: await loadTree(tx),
    archived: await listArchivedSections(tx),
  }));

  return (
    <>
      <div className="page-head">
        <h1>Edit sections</h1>
        <p className="meta">
          Use the arrows to change the order (on a computer you can also drag a row). Numbers update
          on their own.
        </p>
      </div>
      <SectionManager
        tree={toItems(tree)}
        maxDepth={MAX_DEPTH}
        maxTitleLength={MAX_TITLE_LENGTH}
        archived={archived.map((item) => ({
          id: item.id,
          title: item.title,
          detail: [
            item.parentTitle ? `was under ${item.parentTitle},` : "",
            `archived ${formatDate(item.archivedAt)}`,
            item.archivedByName ? `by ${item.archivedByName}` : "",
          ]
            .filter(Boolean)
            .join(" "),
        }))}
      />
    </>
  );
}
