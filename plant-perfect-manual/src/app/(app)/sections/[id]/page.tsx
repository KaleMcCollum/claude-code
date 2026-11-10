import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { OfficialBlock } from "@/components/OfficialBlock";
import { RichText } from "@/components/RichText";
import { asUser } from "@/db/client";
import { requireUser } from "@/lib/auth/session";
import { approvalLine, loadOfficial } from "@/lib/official";
import { can } from "@/lib/permissions";
import { isEmptyDoc } from "@/lib/richtext";
import { isUuid, loadTree, pathTo } from "@/lib/sections";
import { formatDate } from "@/lib/time";
import { loadUserNames } from "@/lib/users";

type PageProps = { params: Promise<{ id: string }> };

const loadPage = cache(async (id: string) => {
  const user = await requireUser();
  if (!isUuid(id)) return null;
  return asUser(user.id, async (tx) => {
    const path = pathTo(await loadTree(tx), id);
    const node = path.at(-1);
    if (!node) return null;
    return {
      user,
      path,
      node,
      official: await loadOfficial(tx, id),
      names: await loadUserNames(tx),
    };
  });
});

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const data = await loadPage((await params).id);
  return { title: data ? `${data.node.number} ${data.node.title}` : "Section not found" };
}

export default async function SectionPage({ params }: PageProps) {
  const data = await loadPage((await params).id);
  if (!data) notFound();
  const { user, path, node, official, names } = data;
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
        canEdit={can(user, "edit_official")}
        userName={user.name}
      >
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
        </div>
      </OfficialBlock>

      <section className="block" aria-labelledby="discussion-heading">
        <div className="block-head">
          <h2 id="discussion-heading">Discussion</h2>
        </div>
        <div className="discussion-box">
          <p className="muted">
            No discussion yet. Notes sorted into this section will show here, word for word, with
            who wrote them and when.
          </p>
        </div>
      </section>
    </article>
  );
}
