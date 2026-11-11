import type { Metadata } from "next";
import Link from "next/link";
import { asUser } from "@/db/client";
import { requireUser } from "@/lib/auth/session";
import { RemovedNote } from "@/components/notes/NoteBlock";
import { toRemovedNoteData } from "@/components/notes/data";
import { listLogDays, listRemovedNotes } from "@/lib/notes";
import { can } from "@/lib/permissions";
import { loadTree } from "@/lib/sections";
import { addDays, centralDateKey, formatDateKeyLong } from "@/lib/time";
import { DateJump } from "./DateJump";

export const metadata: Metadata = { title: "Daily Log" };

/** "4 notes, 1 unsorted" */
function countLine(noteCount: number, unsortedCount: number): string {
  const notes = noteCount === 1 ? "1 note" : `${noteCount} notes`;
  if (unsortedCount > 0) return `${notes}, ${unsortedCount} unsorted`;
  return noteCount === 1 ? `${notes}, sorted` : `${notes}, all sorted`;
}

/** The Daily Log: jump to a day, or pick one from the days that have notes. */
export default async function DailyLogPage() {
  const user = await requireUser();
  const canWrite = can(user, "write_notes");
  const { days, removed } = await asUser(user.id, async (tx) => ({
    days: await listLogDays(tx),
    // Only Owners can remove and restore notes, so only they see this list.
    removed: canWrite ? await listRemovedNotes(tx, await loadTree(tx)) : [],
  }));
  const today = centralDateKey();

  return (
    <>
      <div className="page-head">
        <h1>Daily Log</h1>
      </div>

      <div className="row">
        <Link className="btn" href="/daily-log/today">
          Today&rsquo;s log
        </Link>
        <Link className="btn" href={`/daily-log/${addDays(today, -1)}`}>
          Yesterday&rsquo;s log
        </Link>
      </div>
      <DateJump today={today} />

      <section className="block" aria-labelledby="days-heading">
        <div className="block-head">
          <h2 id="days-heading">Days with notes</h2>
        </div>
        {days.length === 0 ? (
          <p className="muted">No notes yet.</p>
        ) : (
          <ul className="day-list">
            {days.map((day) => (
              <li key={day.logDate}>
                <Link href={`/daily-log/${day.logDate}`}>{formatDateKeyLong(day.logDate)}</Link>
                <span className="muted small">{countLine(day.noteCount, day.unsortedCount)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {removed.length > 0 && (
        <details className="removed-notes">
          <summary>Removed notes ({removed.length})</summary>
          <p className="muted small">
            Removed notes are hidden, not deleted. Restore puts a note back on its day with
            everything it had.
          </p>
          <div className="notes">
            {removed.map((note) => (
              <RemovedNote key={note.id} note={toRemovedNoteData(note)} showDay />
            ))}
          </div>
        </details>
      )}
    </>
  );
}
