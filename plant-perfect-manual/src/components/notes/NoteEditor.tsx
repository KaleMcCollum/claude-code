"use client";

import dynamic from "next/dynamic";

/**
 * The small text box used for notes and comments. It is the same editor as
 * the one for official text (in its compact look), downloaded only when
 * someone starts to write.
 */
export const NoteEditor = dynamic(() => import("../RichTextEditor"), {
  ssr: false,
  loading: () => <p className="muted small editor-loading">Opening the editor</p>,
});

/** Fetch the editor ahead of time, so "Add note" opens without a wait. */
export function preloadNoteEditor(): void {
  void import("../RichTextEditor");
}

/** Shown when a request never reached the app (for example no phone signal). */
export const NOT_SENT = "That did not go through. Check your connection and try again.";
