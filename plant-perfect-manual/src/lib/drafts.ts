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
