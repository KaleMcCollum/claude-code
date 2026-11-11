import type { Metadata } from "next";
import Link from "next/link";
import { NoteBlock } from "@/components/notes/NoteBlock";
import { toNoteBlockData, toSectionOptions } from "@/components/notes/data";
import { asUser } from "@/db/client";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { loadTree } from "@/lib/sections";
import { type StaleSection, loadToday } from "@/lib/today";
import { formatDate, formatDateKey, formatDateKeyLong } from "@/lib/time";

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
  const { unsorted, stale, opening } = today;
  const canWrite = can(user, "write_notes");
  const canComment = can(user, "comment");
  // The sorting form needs the list of sections, and only Owners can sort.
  const sections =
    canWrite && unsorted.notes.length > 0
      ? toSectionOptions(await asUser(user.id, (tx) => loadTree(tx)))
      : [];

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
                  note={toNoteBlockData(note, user.id)}
                  mode="today"
                  canWrite={canWrite}
                  canComment={canComment}
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
        To-dos, deadlines and proposals waiting for approval will show here as those parts are
        built (phases 3 and 4).
      </p>
    </>
  );
}
