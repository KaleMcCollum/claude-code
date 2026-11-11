"use client";

import Link from "next/link";
import { useOptimistic, useState, useTransition } from "react";
import {
  addCommentAction,
  editNoteAction,
  removeNoteAction,
  restoreNoteAction,
  setNoteSortedAction,
} from "@/app/(app)/daily-log/actions";
import type { ActionResult } from "@/lib/actions";
import { BUSINESS_LABELS } from "@/lib/business";
import { commentDraftKey, noteDraftKey, useHasDraft } from "@/lib/drafts";
import { EMPTY_DOC } from "@/lib/richtext";
import { RichText } from "../RichText";
import { NOT_SENT, NoteEditor } from "./NoteEditor";
import { NoteSortForm } from "./NoteSortForm";
import type { NoteBlockData, RemovedNoteData, SectionOption } from "./data";

/**
 * Where a note is being shown:
 *  - "log": on its Daily Log day (time only; everything can be done here)
 *  - "today": in the Unsorted list on the Today page (same, with the date)
 *  - "discussion": in a section's Discussion (read-only, plus comments)
 */
export type NoteMode = "log" | "today" | "discussion";

type Props = {
  note: NoteBlockData;
  mode: NoteMode;
  /** May the person sort, edit and remove notes (Owners)? */
  canWrite: boolean;
  /** May the person comment (Owners and Advisors)? */
  canComment: boolean;
  /** May the person make a proposal from this note (Owners)? Not offered in Discussion. */
  canPropose?: boolean;
  /** Sections a note can be filed under. Not needed in Discussion. */
  sections?: SectionOption[];
};

type Open = "sort" | "edit" | "remove" | "comment" | null;

/** Run a change and hand back its result, even if the request never arrived. */
async function attempt(work: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    return await work();
  } catch {
    return { ok: false, error: NOT_SENT };
  }
}

/**
 * One note, word for word, with who wrote it and when, where it is filed,
 * and its comments. The same block is used in the Daily Log, on Today and
 * in a section's Discussion.
 */
export function NoteBlock({
  note,
  mode,
  canWrite,
  canComment,
  canPropose = false,
  sections = [],
}: Props) {
  const manage = canWrite && mode !== "discussion";
  const propose = canPropose && mode !== "discussion";
  const canEdit = manage && note.mine;
  const when = mode === "log" ? note.time : note.dateTime;
  // Used in the names of this note's buttons, so each one says which note it is for.
  const label = `note by ${note.authorName}, ${when}`;

  const [opened, setOpened] = useState<Open>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, startWork] = useTransition();
  const [sorted, showSorted] = useOptimistic(note.sorted);

  // Unsaved typing left on this device comes straight back.
  const editDraft = useHasDraft(noteDraftKey(note.id));
  const commentDraft = useHasDraft(commentDraftKey(note.id));
  const open: Open =
    opened ?? (canEdit && editDraft ? "edit" : canComment && commentDraft ? "comment" : null);

  const run = (work: () => Promise<ActionResult>, onSuccess?: () => void) => {
    startWork(async () => {
      const result = await attempt(work);
      if (result.ok) {
        setError(null);
        onSuccess?.();
      } else {
        setError(result.error);
      }
    });
  };

  const show = (next: Open) => {
    setError(null);
    setOpened(next);
  };

  return (
    <article
      className="note"
      id={mode === "log" ? `note-${note.id}` : undefined}
      aria-label={`Note by ${note.authorName}, ${when}`}
    >
      <div className="note-head">
        <p className="byline">
          {when} · <span className="who">{note.authorName}</span>
        </p>
        {mode !== "discussion" && (
          <label className="check note-sorted">
            <input
              type="checkbox"
              aria-label={`Sorted, ${label}`}
              checked={sorted}
              disabled={!canWrite || busy}
              onChange={(event) => {
                const next = event.target.checked;
                startWork(async () => {
                  showSorted(next);
                  const result = await attempt(() => setNoteSortedAction(note.id, next));
                  setError(result.ok ? null : result.error);
                });
              }}
            />
            <span>Sorted</span>
          </label>
        )}
      </div>

      {open === "edit" ? (
        <NoteEditor
          compact
          initialDoc={note.body}
          draftKey={noteDraftKey(note.id)}
          label={`Edit ${label}`}
          saveLabel="Save"
          focusRequest={opened === "edit" ? 1 : 0}
          onSave={(doc) => editNoteAction(note.id, doc)}
          onDone={() => show(null)}
        />
      ) : (
        <RichText doc={note.body} />
      )}

      <NoteFacts note={note} showDay={mode !== "log"} />

      {note.proposals.map((proposal) => (
        <p key={proposal.id} className="note-proposal muted small">
          Proposal: <Link href={`/proposals/${proposal.id}`}>{proposal.title}</Link> ({proposal.status})
        </p>
      ))}

      {note.edited && (
        <details className="note-edited">
          <summary>Edited {note.edited}</summary>
          {note.revisions.map((revision, index) => (
            <div key={index} className="note-revision">
              <p className="muted small">Earlier wording, replaced {revision.replaced}</p>
              <RichText doc={revision.body} />
            </div>
          ))}
        </details>
      )}

      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}

      {open === "sort" && (
        <NoteSortForm
          noteId={note.id}
          label={label}
          filed={note.sections}
          businessTag={note.businessTag}
          sorted={note.sorted}
          options={sections}
          onDone={() => show(null)}
        />
      )}

      {open === "remove" && (
        <div className="note-confirm">
          <p>
            Remove this note? It is hidden, not deleted, and can be restored from this day&rsquo;s
            log.
          </p>
          <div className="row">
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy}
              onClick={() => run(() => removeNoteAction(note.id))}
            >
              Remove note
            </button>
            <button type="button" className="btn" onClick={() => show(null)}>
              Keep it
            </button>
          </div>
        </div>
      )}

      {open === null && (manage || canComment || propose) && (
        <div className="note-actions">
          {manage && (
            <button type="button" className="btn-text" aria-label={`Sort ${label}`} onClick={() => show("sort")}>
              Sort
            </button>
          )}
          {canComment && (
            <button
              type="button"
              className="btn-text"
              aria-label={`Add comment to ${label}`}
              onClick={() => show("comment")}
            >
              Add comment
            </button>
          )}
          {propose && (
            <Link
              className="btn-text"
              href={`/proposals/new?note=${note.id}`}
              aria-label={`Propose from ${label}`}
            >
              Propose
            </Link>
          )}
          {canEdit && (
            <button type="button" className="btn-text" aria-label={`Edit ${label}`} onClick={() => show("edit")}>
              Edit
            </button>
          )}
          {manage && (
            <button
              type="button"
              className="btn-text danger"
              aria-label={`Remove ${label}`}
              onClick={() => show("remove")}
            >
              Remove
            </button>
          )}
        </div>
      )}

      {(note.comments.length > 0 || open === "comment") && (
        <div className="note-comments">
          {note.comments.length > 0 && (
            <ul aria-label={`Comments on ${label}`}>
              {note.comments.map((comment) => (
                <li key={comment.id}>
                  <p className="byline">
                    {comment.when} · <span className="who">{comment.authorName}</span>
                  </p>
                  <RichText doc={comment.body} />
                </li>
              ))}
            </ul>
          )}
          {open === "comment" && (
            <NoteEditor
              compact
              initialDoc={EMPTY_DOC}
              draftKey={commentDraftKey(note.id)}
              label={`Comment on ${label}`}
              saveLabel="Save comment"
              focusRequest={opened === "comment" ? 1 : 0}
              onSave={(doc) => addCommentAction(note.id, doc)}
              onDone={() => show(null)}
            />
          )}
        </div>
      )}
    </article>
  );
}

/** The muted line under a note: business, where it is filed, and its day. */
function NoteFacts({ note, showDay }: { note: NoteBlockData; showDay: boolean }) {
  const facts: React.ReactNode[] = [];
  if (note.businessTag) facts.push(<span key="business">{BUSINESS_LABELS[note.businessTag]}</span>);
  if (note.sections.length > 0) {
    facts.push(
      <span key="sections">
        Filed under{" "}
        {note.sections.map((section, index) => (
          <span key={section.id}>
            {index > 0 && ", "}
            {section.number === null ? (
              // The section has been archived: say so, and do not link to it.
              <span>{section.title} (archived)</span>
            ) : (
              <Link href={`/sections/${section.id}`}>
                {section.number} {section.title}
              </Link>
            )}
            {section.byAi && (
              <>
                {" "}
                <span className="ai-mark" title="Filed here by the AI">
                  AI
                </span>
              </>
            )}
          </span>
        ))}
      </span>,
    );
  }
  if (showDay) {
    facts.push(
      <span key="day">
        <Link href={`/daily-log/${note.logDate}#note-${note.id}`}>Daily Log, {note.day}</Link>
      </span>,
    );
  }
  if (facts.length === 0) return null;
  return (
    <p className="note-facts muted small">
      {facts.map((fact, index) => (
        <span key={index}>
          {index > 0 && " · "}
          {fact}
        </span>
      ))}
    </p>
  );
}

/**
 * What Owners see in place of a removed note: one line and a Restore button.
 * In a day's log it sits where the note was; the list of all removed notes
 * (on the Daily Log page) also says which day each one belongs to.
 */
export function RemovedNote({ note, showDay = false }: { note: RemovedNoteData; showDay?: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, startWork] = useTransition();
  const from = showDay ? `${note.day}, ${note.time}` : note.time;
  return (
    <div className="note note-removed" id={`note-${note.id}`}>
      <p className="muted small">
        A note by {note.authorName}
        {showDay ? ` from ${from}` : ""} was removed
        {note.removedByName ? ` by ${note.removedByName}` : ""} on {note.removedOn}.{" "}
        <button
          type="button"
          className="btn-text"
          aria-label={`Restore the note by ${note.authorName} from ${from}`}
          disabled={busy}
          onClick={() =>
            startWork(async () => {
              const result = await attempt(() => restoreNoteAction(note.id));
              setError(result.ok ? null : result.error);
            })
          }
        >
          Restore
        </button>
      </p>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
