import type { Metadata } from "next";
import Link from "next/link";
import { asUser } from "@/db/client";
import { requireUser } from "@/lib/auth/session";
import { listLogDays } from "@/lib/notes";
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
  const days = await asUser(user.id, (tx) => listLogDays(tx));
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
    </>
  );
}
