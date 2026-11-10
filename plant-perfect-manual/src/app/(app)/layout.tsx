import { Sidebar, type TreeItem } from "@/components/Sidebar";
import { asUser } from "@/db/client";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { type SectionNode, loadTree } from "@/lib/sections";

function toItems(nodes: SectionNode[]): TreeItem[] {
  return nodes.map((node) => ({
    id: node.id,
    number: node.number,
    title: node.title,
    children: toItems(node.children),
  }));
}

/**
 * Every signed-in page: the fixed sidebar on the left, the page on the right.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const tree = await asUser(user.id, (tx) => loadTree(tx));
  return (
    <div className="shell">
      <Sidebar
        tree={toItems(tree)}
        userName={user.name}
        canWriteNotes={can(user, "write_notes")}
        canManageSections={can(user, "structure")}
        canOpenSettings={can(user, "manage_users") || can(user, "settings")}
      />
      <main className="main">
        <div className="page">{children}</div>
      </main>
    </div>
  );
}
