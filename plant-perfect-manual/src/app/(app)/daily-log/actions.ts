"use server";

import { asUser } from "@/db/client";
import { type ActionResult, runAction } from "@/lib/actions";
import {
  addComment,
  addNote,
  editNote,
  removeNote,
  restoreNote,
  setNoteSorted,
  sortNote,
} from "@/lib/notes";
import { AppError } from "@/lib/permissions";
import { isUuid, loadTree } from "@/lib/sections";

// Everything arriving here comes from a browser, so every value is checked
// before use. The rules in src/lib/notes.ts check the person's permission
// again, and check the text itself (sanitizeDoc) before anything is saved.

const UNREADABLE = "That could not be read. Reload the page and try again.";

function requireNoteId(value: unknown): string {
  if (typeof value !== "string" || !isUuid(value)) {
    throw new AppError("That note could not be found. Reload the page and try again.");
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Text from the editor. Its contents are checked by the rules before saving. */
function requireDoc(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new AppError("That text could not be read. Please try again.");
  return value;
}

/**
 * Save a new note to today's Daily Log. Hands back the day it was saved to,
 * which can differ from the page it was typed on just after midnight.
 */
export async function addNoteAction(doc: unknown): Promise<ActionResult<{ logDate: string }>> {
  return runAction<{ logDate: string }>(async (actor) => {
    const { logDate } = await addNote(actor, { body: requireDoc(doc) });
    return { data: { logDate } };
  });
}

export async function editNoteAction(noteId: unknown, doc: unknown): Promise<ActionResult> {
  return runAction(async (actor) => {
    await editNote(actor, requireNoteId(noteId), requireDoc(doc));
  });
}

export async function sortNoteAction(noteId: unknown, input: unknown): Promise<ActionResult> {
  return runAction(async (actor) => {
    const id = requireNoteId(noteId);
    if (!isRecord(input)) throw new AppError(UNREADABLE);
    const { sectionIds, businessTag, sorted } = input;
    if (
      !Array.isArray(sectionIds) ||
      sectionIds.length > 100 ||
      !sectionIds.every((value) => typeof value === "string" && isUuid(value))
    ) {
      throw new AppError("The chosen sections could not be read. Reload the page and try again.");
    }
    if (businessTag !== null && typeof businessTag !== "string") {
      throw new AppError("Choose Garden Center, Coffee Shop or Both.");
    }
    if (typeof sorted !== "boolean") throw new AppError(UNREADABLE);
    // The sections as they are right now, so an archived one cannot be chosen.
    const tree = await asUser(actor.id, (tx) => loadTree(tx));
    await sortNote(actor, id, tree, { sectionIds, businessTag, sorted });
  });
}

export async function setNoteSortedAction(noteId: unknown, sorted: unknown): Promise<ActionResult> {
  return runAction(async (actor) => {
    const id = requireNoteId(noteId);
    if (typeof sorted !== "boolean") throw new AppError(UNREADABLE);
    await setNoteSorted(actor, id, sorted);
  });
}

export async function removeNoteAction(noteId: unknown): Promise<ActionResult> {
  return runAction((actor) => removeNote(actor, requireNoteId(noteId)));
}

export async function restoreNoteAction(noteId: unknown): Promise<ActionResult> {
  return runAction((actor) => restoreNote(actor, requireNoteId(noteId)));
}

export async function addCommentAction(noteId: unknown, doc: unknown): Promise<ActionResult> {
  return runAction(async (actor) => {
    await addComment(actor, requireNoteId(noteId), requireDoc(doc));
  });
}
