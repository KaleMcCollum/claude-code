import { useSyncExternalStore } from "react";
import type { RichDoc } from "./richtext";

/**
 * Unsaved text is kept in the browser while someone types, so nothing is
 * lost if a phone closes the page. It stays on that device only and is
 * cleared as soon as the text is saved or discarded.
 */
export type Draft = { doc: RichDoc; at: number };

const CHANGE_EVENT = "ppf-draft-change";

export function officialDraftKey(sectionId: string): string {
  return `ppf:draft:official:${sectionId}`;
}

/**
 * The note being typed but not saved yet. One per device, whatever the day:
 * a note started late at night is still there in the morning.
 */
export const NEW_NOTE_DRAFT_KEY = "ppf:draft:note:new";

/** Unsaved changes to the wording of an existing note. */
export function noteDraftKey(noteId: string): string {
  return `ppf:draft:note:${noteId}`;
}

/** An unsaved comment on a note. */
export function commentDraftKey(noteId: string): string {
  return `ppf:draft:comment:${noteId}`;
}

/** The proposed official text of a new proposal for a section, not sent yet. */
export function newProposalDraftKey(sectionId: string): string {
  return `ppf:draft:proposal:new:${sectionId}`;
}

/** Unsaved changes to the proposed text of an existing proposal. */
export function proposalDraftKey(proposalId: string): string {
  return `ppf:draft:proposal:${proposalId}`;
}

/** An unsaved comment on a proposal. */
export function proposalCommentDraftKey(proposalId: string): string {
  return `ppf:draft:comment:proposal:${proposalId}`;
}

export function readDraft(key: string): Draft | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const value = JSON.parse(raw) as Draft;
    return value && value.doc?.type === "doc" && typeof value.at === "number" ? value : null;
  } catch {
    return null;
  }
}

export function writeDraft(key: string, doc: RichDoc): void {
  try {
    window.localStorage.setItem(key, JSON.stringify({ doc, at: Date.now() } satisfies Draft));
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    // Storage full or blocked: typing still works, there is just no safety copy.
  }
}

export function clearDraft(key: string): void {
  try {
    window.localStorage.removeItem(key);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    // Nothing to clear.
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

/** True when this device holds unsaved text for `key`. */
export function useHasDraft(key: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => {
      try {
        return window.localStorage.getItem(key) !== null;
      } catch {
        return false;
      }
    },
    () => false,
  );
}
