import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { NoteBlock, RemovedNote } from "@/components/notes/NoteBlock";
import { NoteEntry } from "@/components/notes/NoteEntry";
import { toNoteBlockData, toRemovedNoteData, toSectionOptions } from "@/components/notes/data";
import { asUser } from "@/db/client";
import { requireUser } from "@/lib/auth/session";
import { adjacentLogDays, loadDay } from "@/lib/notes";
import { can } from "@/lib/permissions";
import { loadTree } from "@/lib/sections";
import { centralDateKey, formatDateKey, formatDateKeyLong, isDateKey } from "@/lib/time";

type PageProps = { params: Promise<{ date: string }> };

/**
 * The day an address stands for: "today" is today (US Central time), and a
 * date is itself. Anything else, and any day that has not happened yet, is
 * not a Daily Log day.
 */
function readDay(value: string, today: string): string | null {
  const day = value === "today" ? today : value;
  return isDateKey(day) && day <= today ? day : null;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const day = readDay((await params).date, centralDateKey());
  return { title: day ? `Daily Log, ${formatDateKey(day)}` : "Daily Log" };
}

/** One day of the Daily Log: every note written that day, oldest first. */
export default async function DailyLogDayPage({ params }: PageProps) {
  const user = await requireUser();
  const today = centralDateKey();
  const day = readDay((await params).date, today);
  if (!day) redirect("/daily-log");

  const canWrite = can(user, "write_notes");
  const canComment = can(user, "comment");
  // Reading a day never creates anything: a day's log only comes into being
  // with its first note.
  const { tree, notes, adjacent } = await asUser(user.id, async (tx) => {
    const sectionTree = await loadTree(tx);
    return {
      tree: sectionTree,
      // Owners see a one-line reminder where a removed note was. Advisors do not.
      notes: await loadDay(tx, sectionTree, day, { includeRemoved: canWrite }),
      adjacent: await adjacentLogDays(tx, day),
    };
  });
  const sections = toSectionOptions(tree);
  const isToday = day === today;
  const shown = notes.filter((note) => note.removedAt === null);

  return (
    <>
      <div className="page-head">
        <p className="crumbs muted">Daily Log{isToday ? ", today" : ""}</p>
        <h1>{formatDateKeyLong(day)}</h1>
        <nav className="day-nav" aria-label="Other days">
          {adjacent.previous && (
            <Link href={`/daily-log/${adjacent.previous}`}>Earlier day with notes</Link>
          )}
          {adjacent.next && <Link href={`/daily-log/${adjacent.next}`}>Later day with notes</Link>}
          <Link href="/daily-log">All days</Link>
        </nav>
      </div>

      {shown.length === 0 && <p className="muted">No notes on this day.</p>}
      {notes.length > 0 && (
        <div className="notes">
          {notes.map((note) =>
            note.removedAt ? (
              <RemovedNote key={note.id} note={toRemovedNoteData(note)} />
            ) : (
              <NoteBlock
                key={note.id}
                note={toNoteBlockData(note, user.id)}
                mode="log"
                canWrite={canWrite}
                canComment={canComment}
                sections={sections}
              />
            ),
          )}
        </div>
      )}

      {canWrite &&
        (isToday ? (
          <NoteEntry pageDate={day} noteCount={shown.length} />
        ) : (
          <p className="note-entry">
            <Link href="/daily-log/today?new=1">Add a note to today&rsquo;s log</Link>
          </p>
        ))}
    </>
  );
}
