"use server";

import { type ActionResult, runAction } from "@/lib/actions";
import { restoreVersion, saveOfficial } from "@/lib/official";
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

/** The official version a page was showing: an id, or null when there was no official text. */
function versionOnScreen(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !isUuid(value)) {
    throw new AppError("That could not be read. Reload the page and try again.");
  }
  return value;
}

/**
 * "Edit official": save directly, approved by the person saving.
 * `baseVersionId` is the version the page showed when editing started; if
 * someone else has changed the text since, the save is refused.
 */
export async function saveOfficialAction(
  sectionId: unknown,
  doc: unknown,
  baseVersionId: unknown,
): Promise<ActionResult> {
  return runAction(async (actor) => {
    const result = await saveOfficial(actor, requireId(sectionId), doc, {
      baseVersionId: versionOnScreen(baseVersionId),
    });
    return result.changed ? "Saved." : "No changes to save.";
  });
}

/**
 * Version history: make an earlier version the official text again (as a
 * new version). `currentVersionId` is the newest version the page showed.
 */
export async function restoreVersionAction(
  sectionId: unknown,
  versionId: unknown,
  currentVersionId: unknown,
): Promise<ActionResult> {
  return runAction(async (actor) => {
    const result = await restoreVersion(actor, requireId(sectionId), requireId(versionId), {
      currentVersionId: versionOnScreen(currentVersionId),
    });
    return `Restored as version ${result.version}.`;
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
