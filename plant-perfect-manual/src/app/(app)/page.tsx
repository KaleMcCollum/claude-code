import type { Metadata } from "next";
import Link from "next/link";
import { ActionButton } from "@/components/decisions/ActionButton";
import { waitingLine } from "@/components/decisions/words";
import { NoteBlock } from "@/components/notes/NoteBlock";
import { toNoteBlockData, toSectionOptions } from "@/components/notes/data";
import { asUser } from "@/db/client";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { SOLO_FLAG_DAYS, canApproveToo, displayTitle, proposalsForNotes } from "@/lib/proposals";
import { loadTree } from "@/lib/sections";
import { type StaleSection, loadToday } from "@/lib/today";
import { formatDate, formatDateKey, formatDateKeyLong } from "@/lib/time";
import { addApprovalAction } from "./proposals/actions";

export const metadata: Metadata = { title: "Today" };

/** How many stale sections are listed before the "Show all" line. */
const STALE_SHOWN = 8;

function countdown(days: number): string {
  if (days > 1) return `${days} days until opening`;
  if (days === 1) return "1 day until opening";
  if (days === 0) return "Opening day is today";
  return days === -1 ? "Opened 1 day ago" : `Opened ${-days} days ago`;
}

function StaleList({ sections }: { sections: StaleSection[] }) {
  return (
    <ul className="today-list">
      {sections.map((section) => (
        <li key={section.id}>
          <Link href={`/sections/${section.id}`}>
            {section.number} {section.title}
          </Link>
          <span className="muted small">
            {" "}
            last updated {formatDate(section.updatedAt)} ({section.daysAgo} days ago)
          </span>
        </li>
      ))}
    </ul>
  );
}

export default async function TodayPage() {
  const user = await requireUser();
  const today = await loadToday(user);
  const { unsorted, stale, opening, awaiting, decidedAlone, approvers } = today;
  const canWrite = can(user, "write_notes");
  const canComment = can(user, "comment");
  // Titles of direct edits name their section, and the sorting form lists the sections.
  const { tree, noteProposals } = await asUser(user.id, async (tx) => ({
    tree: await loadTree(tx),
    noteProposals: await proposalsForNotes(
      tx,
      unsorted.notes.map((note) => note.id),
    ),
  }));
  // Only Owners can sort.
  const sections = canWrite && unsorted.notes.length > 0 ? toSectionOptions(tree) : [];

  return (
    <>
      <div className="page-head">
        <h1>Today</h1>
        <p className="meta">{formatDateKeyLong(today.todayKey)}</p>
      </div>

      <p className="today-opening">
        {countdown(opening.days)} ({formatDateKey(opening.date)})
        {can(user, "settings") && (
          <>
            {" "}
            <Link href="/settings?from=/" aria-label="Change the opening date">
              Change
            </Link>
          </>
        )}
      </p>

      <section className="block" aria-labelledby="awaiting-heading">
        <div className="block-head">
          <h2 id="awaiting-heading">Awaiting approval ({awaiting.length})</h2>
          <Link href="/proposals">Proposals</Link>
        </div>
        {awaiting.length === 0 ? (
          <p className="muted">Nothing is waiting for approval.</p>
        ) : (
          <ul className="decision-list">
            {awaiting.map((view) => (
              <li key={view.id}>
                <Link className="title" href={`/proposals/${view.id}`}>
                  {displayTitle(view, tree)}
                </Link>
                <p className="muted small">
                  Proposed{view.proposedByName ? ` by ${view.proposedByName}` : ""}, {formatDate(view.createdAt)}
                </p>
                <p className="small">{waitingLine(view, user, approvers)}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="block" aria-labelledby="alone-heading">
        <div className="block-head">
          <h2 id="alone-heading">Decided by one person ({decidedAlone.length})</h2>
        </div>
        {decidedAlone.length === 0 ? (
          <p className="muted">
            Nothing was decided by one person in the last {SOLO_FLAG_DAYS} days.
          </p>
        ) : (
          <>
            <p className="muted small list-note">
              Approved by one Owner in the last {SOLO_FLAG_DAYS} days.
            </p>
            <ul className="decision-list">
              {decidedAlone.map((view) => {
                const title = displayTitle(view, tree);
                // The person who decided it: not always the first name on it
                // (the proposer may have stopped being an Owner since).
                const by = view.decidedByName ?? view.approvals[0]?.name;
                return (
                  <li key={view.id}>
                    <Link className="title" href={`/proposals/${view.id}`}>
                      {title}
                    </Link>
                    <p className="flag">
                      Decided by {by ?? "one Owner"} alone, {formatDate(view.decidedAt ?? view.createdAt)}
                    </p>
                    {canApproveToo(view, user) && (
                      <div className="actions">
                        <ActionButton
                          label="I approve too"
                          ariaLabel={`I approve too: ${title}`}
                          action={addApprovalAction.bind(null, view.id)}
                        />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>

      <section className="block" aria-labelledby="unsorted-heading">
        <div className="block-head">
          <h2 id="unsorted-heading">Unsorted notes ({unsorted.total})</h2>
          <Link href="/daily-log">Daily Log</Link>
        </div>
        {unsorted.total === 0 ? (
          <p className="muted">Nothing waiting. Every note has been sorted.</p>
        ) : (
          <>
            <div className="notes">
              {unsorted.notes.map((note) => (
                <NoteBlock
                  key={note.id}
                  note={toNoteBlockData(note, user.id, noteProposals.get(note.id))}
                  mode="today"
                  canWrite={canWrite}
                  canComment={canComment}
                  canPropose={can(user, "propose")}
                  sections={sections}
                />
              ))}
            </div>
            {unsorted.total > unsorted.notes.length && (
              <p className="muted small">
                Showing the newest {unsorted.notes.length}. The rest are in the{" "}
                <Link href="/daily-log">Daily Log</Link>.
              </p>
            )}
          </>
        )}
      </section>

      <section className="block" aria-labelledby="stale-heading">
        <div className="block-head">
          <h2 id="stale-heading">Stale sections ({stale.sections.length})</h2>
        </div>
        {stale.sections.length === 0 ? (
          <p className="muted">
            Every section has been updated in the last {stale.afterDays} days.
          </p>
        ) : (
          <>
            <p className="muted small">
              Not updated in {stale.afterDays} days or more. Are we still good with these?
            </p>
            <StaleList sections={stale.sections.slice(0, STALE_SHOWN)} />
            {stale.sections.length > STALE_SHOWN && (
              <details className="today-more">
                <summary>Show all {stale.sections.length}</summary>
                <StaleList sections={stale.sections.slice(STALE_SHOWN)} />
              </details>
            )}
          </>
        )}
      </section>

      <p className="muted small" style={{ marginTop: 32 }}>
        To-dos and deadlines will show here when that part is built (phase 4).
      </p>
    </>
  );
}
