"use server";

import { type ActionResult, runAction } from "@/lib/actions";
import { saveOfficial } from "@/lib/official";
import { AppError } from "@/lib/permissions";
import {
  archiveSection,
  createSection,
  isUuid,
  moveSection,
  renameSection,
  reorderSections,
  restoreSection,
} from "@/lib/sections";

// Everything arriving here comes from a browser, so every value is checked
// before use, and each function checks the person's permission again itself.

function requireId(value: unknown): string {
  if (typeof value !== "string" || !isUuid(value)) {
    throw new AppError("That section could not be found. Reload the page and try again.");
  }
  return value;
}

function requireText(value: unknown): string {
  if (typeof value !== "string") throw new AppError("Enter a name for the section.");
  return value;
}

export async function saveOfficialAction(sectionId: string, doc: unknown): Promise<ActionResult> {
  return runAction(async (actor) => {
    const result = await saveOfficial(actor, requireId(sectionId), doc);
    return result.changed ? "Saved." : "No changes to save.";
  });
}

export async function createSectionAction(
  parentId: string | null,
  title: string,
): Promise<ActionResult> {
  return runAction(async (actor) => {
    await createSection(actor, {
      parentId: parentId === null ? null : requireId(parentId),
      title: requireText(title),
    });
  });
}

export async function renameSectionAction(id: string, title: string): Promise<ActionResult> {
  return runAction((actor) => renameSection(actor, requireId(id), requireText(title)));
}

export async function moveSectionAction(id: string, direction: "up" | "down"): Promise<ActionResult> {
  return runAction((actor) => moveSection(actor, requireId(id), direction === "up" ? "up" : "down"));
}

export async function reorderSectionsAction(
  parentId: string | null,
  orderedIds: string[],
): Promise<ActionResult> {
  return runAction((actor) => {
    if (!Array.isArray(orderedIds) || orderedIds.length > 500) {
      throw new AppError("The new order could not be read. Reload the page and try again.");
    }
    return reorderSections(
      actor,
      parentId === null ? null : requireId(parentId),
      orderedIds.map(requireId),
    );
  });
}

export async function archiveSectionAction(id: string): Promise<ActionResult> {
  return runAction((actor) => archiveSection(actor, requireId(id)));
}

export async function restoreSectionAction(id: string): Promise<ActionResult> {
  return runAction((actor) => restoreSection(actor, requireId(id)));
}
