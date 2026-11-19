import { useSyncExternalStore } from "react";
import type { RichDoc } from "./richtext";

/**
 * Unsaved text is kept in the browser while someone types, so nothing is
 * lost if a phone closes the page. It stays on that device only and is
 * cleared as soon as the text is saved or discarded.
 *
 * A copy belongs to the person who typed it. The signed-in person's id is
 * part of every key (`owner` below; the browser-side pieces get it from
 * `useDraftOwner`), so on a shared computer or tablet the next person to
 * sign in is never offered someone else's words as their own, and each
 * person's copies are still there when they sign in again. Nothing is
 * cleared at sign-out: that would lose typed words.
 */
export type Draft = {
  doc: RichDoc;
  at: number;
  /**
   * What the text was typed against: an id that changes whenever the saved
   * text it started from changes (for official text, the official version;
   * null when there was no saved text yet). Left out for notes and comments,
   * and missing in copies written before this was recorded.
   */
  base?: string | null;
};

const CHANGE_EVENT = "ppf-draft-change";

/** Every key: whose copy it is, then what it is a copy of. */
function draftKey(owner: string, what: string): string {
  return `ppf:draft:${owner}:${what}`;
}

export function officialDraftKey(owner: string, sectionId: string): string {
  return draftKey(owner, `official:${sectionId}`);
}

/**
 * The note being typed but not saved yet. One per person and device,
 * whatever the day: a note started late at night is still there in the morning.
 */
export function newNoteDraftKey(owner: string): string {
  return draftKey(owner, "note:new");
}

/** Unsaved changes to the wording of an existing note. */
export function noteDraftKey(owner: string, noteId: string): string {
  return draftKey(owner, `note:${noteId}`);
}

/** An unsaved comment on a note. */
export function commentDraftKey(owner: string, noteId: string): string {
  return draftKey(owner, `comment:${noteId}`);
}

/** The proposed official text of a new proposal for a section, not sent yet. */
export function newProposalDraftKey(owner: string, sectionId: string): string {
  return draftKey(owner, `proposal:new:${sectionId}`);
}

/** Unsaved changes to the proposed text of an existing proposal. */
export function proposalDraftKey(owner: string, proposalId: string): string {
  return draftKey(owner, `proposal:${proposalId}`);
}

/** An unsaved comment on a proposal. */
export function proposalCommentDraftKey(owner: string, proposalId: string): string {
  return draftKey(owner, `comment:proposal:${proposalId}`);
}

export function readDraft(key: string): Draft | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const value = JSON.parse(raw) as Draft;
    if (!value || value.doc?.type !== "doc" || typeof value.at !== "number") return null;
    const draft: Draft = { doc: value.doc, at: value.at };
    if (typeof value.base === "string" || value.base === null) draft.base = value.base;
    return draft;
  } catch {
    return null;
  }
}

/** Keep a copy. `base` says what the text was typed against (see `Draft`); leave it out where that is not tracked. */
export function writeDraft(key: string, doc: RichDoc, base?: string | null): void {
  try {
    const draft: Draft = base === undefined ? { doc, at: Date.now() } : { doc, at: Date.now(), base };
    window.localStorage.setItem(key, JSON.stringify(draft));
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
