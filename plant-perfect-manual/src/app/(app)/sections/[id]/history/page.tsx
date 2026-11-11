import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RichText } from "@/components/RichText";
import { ActionButton } from "@/components/decisions/ActionButton";
import { DiffView } from "@/components/decisions/DiffView";
import { asUser } from "@/db/client";
import { requireUser } from "@/lib/auth/session";
import { type OfficialView, approvalLine, endorsementLine, listVersions } from "@/lib/official";
import { can } from "@/lib/permissions";
import { isEmptyDoc, sameDoc } from "@/lib/richtext";
import { findNode, isUuid, loadTree } from "@/lib/sections";
import { formatDate } from "@/lib/time";
import { restoreVersionAction } from "../../actions";

export const metadata: Metadata = { title: "Version history" };

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

/** Where a version came from, in a few words. */
function Origin({ version }: { version: OfficialView }) {
  const by = version.proposedByName ? ` by ${version.proposedByName}` : "";
  if (version.origin === "restored") {
    return (
      <>
        Restored from version {version.restoredFromVersion ?? "an earlier one"}
        {by}
      </>
    );
  }
  if (version.origin === "direct") return <>Edited directly{by}</>;
  return (
    <>
      From the proposal <Link href={`/proposals/${version.proposalId}`}>{version.proposalTitle}</Link>
    </>
  );
}

/**
 * Every version a section's official text has had, newest first. One version
 * at a time opens in place, with its full text and what changed from the
 * version before it. Owners can make an earlier version official again,
 * which adds a new version and erases nothing.
 */
export default async function VersionHistoryPage({ params, searchParams }: PageProps) {
  const user = await requireUser();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const data = await asUser(user.id, async (tx) => {
    const node = findNode(await loadTree(tx), id);
    return node ? { node, versions: await listVersions(tx, id) } : null;
  });
  if (!data) notFound();
  const { node, versions } = data;

  const asked = (await searchParams).v;
  const openNumber = typeof asked === "string" && /^\d{1,6}$/.test(asked) ? Number(asked) : null;
  const current = versions[0] ?? null;
  const canRestore = can(user, "edit_official") && can(user, "approve");
  const here = `/sections/${node.id}/history`;

  return (
    <article>
      <header className="page-head">
        <nav className="crumbs" aria-label="Back to the section">
          <Link href={`/sections/${node.id}`}>
            {node.number} {node.title}
          </Link>
        </nav>
        <h1>Version history</h1>
        <p className="meta">
          {node.number} {node.title}: official text
        </p>
      </header>

      {versions.length === 0 ? (
        <p className="muted">No official text has been saved for this section yet.</p>
      ) : (
        <ul className="version-list">
          {versions.map((version, index) => {
            // The list is newest first: the version after this one is the row above.
            const next = versions[index - 1];
            const previous = versions[index + 1];
            const open = version.version === openNumber;
            const approved = approvalLine(version.approvals);
            return (
              <li key={version.id} id={`v${version.version}`}>
                <div className="version-head">
                  <h2>
                    Version {version.version}
                    {index === 0 && <span className="muted"> (current)</span>}
                  </h2>
                  {open ? (
                    <Link className="tap-link" href={here} scroll={false} aria-label={`Hide version ${version.version}`}>
                      Hide
                    </Link>
                  ) : (
                    <Link
                      className="tap-link"
                      href={`${here}?v=${version.version}`}
                      scroll={false}
                      aria-label={`Show version ${version.version}`}
                    >
                      Show
                    </Link>
                  )}
                </div>
                <p className="muted small">
                  Official from {formatDate(version.savedAt)} to {next ? formatDate(next.savedAt) : "now"}
                </p>
                {approved && <p className="approved">{approved}</p>}
                {version.endorsements.map((endorsement) => (
                  <p key={endorsement.userId} className="endorsements">
                    {endorsementLine(endorsement)}
                  </p>
                ))}
                <p className="small">
                  <Origin version={version} />
                </p>

                {open && (
                  <div className="version-open">
                    <div className="official-box">
                      {isEmptyDoc(version.content) ? (
                        <p className="muted" style={{ margin: 0 }}>
                          No official text (it was removed in this version).
                        </p>
                      ) : (
                        <RichText doc={version.content} />
                      )}
                    </div>
                    {previous && (
                      <>
                        <h3>What changed from version {previous.version}</h3>
                        <DiffView
                          before={previous.content}
                          after={version.content}
                          sameMessage={`The words are the same as in version ${previous.version}.`}
                          beforeHeading={`Version ${previous.version}`}
                          afterHeading={`Version ${version.version}`}
                        />
                      </>
                    )}
                    {canRestore && current && index > 0 && !sameDoc(version.content, current.content) && (
                      <div className="actions">
                        <ActionButton
                          label="Restore this version"
                          ariaLabel={`Restore this version (version ${version.version})`}
                          action={restoreVersionAction.bind(null, node.id, version.id, current.id)}
                          confirm={{
                            question: `Make version ${version.version} the official text again? This adds a new version approved by you alone. Nothing is erased.`,
                            yes: "Restore",
                            no: "Cancel",
                          }}
                        />
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </article>
  );
}
