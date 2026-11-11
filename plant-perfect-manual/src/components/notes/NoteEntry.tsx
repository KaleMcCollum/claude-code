"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { addNoteAction } from "@/app/(app)/daily-log/actions";
import { NEW_NOTE_DRAFT_KEY, useHasDraft } from "@/lib/drafts";
import { EMPTY_DOC, type RichDoc } from "@/lib/richtext";
import { NoteEditor, preloadNoteEditor } from "./NoteEditor";

type Props = {
  /** The day this page shows (always today), e.g. "2026-11-10". */
  pageDate: string;
  /** How many notes the page is showing above the box right now. */
  noteCount: number;
};

/**
 * "Add note" at the bottom of today's Daily Log. Pressing it opens the note
 * box in place. After Save the note joins the list above and the box is
 * empty again with the cursor in it, ready for the next note.
 *
 * "New note" in the sidebar (and the plus on a phone) leads here with
 * `?new=1` in the address, which opens the box straight away.
 */
export function NoteEntry({ pageDate, noteCount }: Props) {
  const router = useRouter();
  const asked = useSearchParams().get("new") === "1";
  const hasDraft = useHasDraft(NEW_NOTE_DRAFT_KEY);
  const [open, setOpen] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const [answered, setAnswered] = useState(false);
  const [savedCount, setSavedCount] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  // Each arrival with ?new=1 is one request to open the box and put the
  // cursor in it. (Adjusting state while rendering, as React recommends for
  // state that follows a changing input.)
  if (asked && !answered) {
    setAnswered(true);
    setOpen(true);
    setFocusRequest(focusRequest + 1);
  }
  if (!asked && answered) setAnswered(false);
  // Words typed earlier and never saved are shown again without being asked.
  if (hasDraft && !open) setOpen(true);

  useEffect(() => {
    // The request has been taken; drop it from the address so that pressing
    // "New note" again, while this page is showing, counts as a new request.
    if (asked) window.history.replaceState(null, "", window.location.pathname);
  }, [asked]);

  useEffect(() => {
    // Owners come to this page to write, so have the editor ready.
    preloadNoteEditor();
  }, []);

  useEffect(() => {
    // The note just saved joins the list above and pushes the box down. The
    // list can arrive a moment after the save itself, so this runs again
    // whenever the number of notes changes, keeping Save on screen.
    if (savedCount > 0) box.current?.scrollIntoView({ block: "nearest" });
  }, [savedCount, noteCount]);

  const save = async (doc: RichDoc) => {
    const result = await addNoteAction(doc);
    // Saved just after midnight, the note belongs to the new day: go there,
    // with the box open for the next note.
    if (result.ok && result.data && result.data.logDate !== pageDate) {
      router.push(`/daily-log/${result.data.logDate}?new=1`);
    }
    return result;
  };

  return (
    <div ref={box} className={open ? "note-entry open" : "note-entry"}>
      {open ? (
        <NoteEditor
          compact
          initialDoc={EMPTY_DOC}
          draftKey={NEW_NOTE_DRAFT_KEY}
          label="New note"
          saveLabel="Save"
          focusRequest={focusRequest}
          onSave={save}
          onSaved={() => setSavedCount((count) => count + 1)}
          onDone={() => setOpen(false)}
        />
      ) : (
        <button
          type="button"
          className="btn"
          onClick={() => {
            setOpen(true);
            setFocusRequest(focusRequest + 1);
          }}
        >
          Add note
        </button>
      )}
    </div>
  );
}
