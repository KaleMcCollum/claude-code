"use server";

import { type ActionResult, runAction } from "@/lib/actions";
import { AppError } from "@/lib/permissions";
import {
  type ProposalInput,
  type Seen,
  type TextProposalInput,
  addApproval,
  addProposalComment,
  approveAlone,
  approveProposal,
  createProposal,
  declineProposal,
  editProposal,
  endorseProposal,
  withdrawProposal,
} from "@/lib/proposals";
import { textToDoc } from "@/lib/richtext";
import { isUuid } from "@/lib/sections";

// Everything arriving here comes from a browser, so every value is checked
// before use. The rules in src/lib/proposals.ts check the person's
// permission again, and the database checks it a third time.

const UNREADABLE = "That could not be read. Reload the page and try again.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireProposalId(value: unknown): string {
  if (typeof value !== "string" || !isUuid(value)) {
    throw new AppError("That proposal could not be found. Reload the page and try again.");
  }
  return value;
}

function requireSectionId(value: unknown): string {
  if (typeof value !== "string" || !isUuid(value)) throw new AppError("Choose a section.");
  return value;
}

/** A section, or null for "the top level". */
function parentId(value: unknown): string | null {
  return value === null || value === "" ? null : requireSectionId(value);
}

function text(value: unknown, missing: string): string {
  if (typeof value !== "string") throw new AppError(missing);
  return value;
}

/** What the person had on their screen when they pressed the button. */
function readSeen(value: unknown): Seen {
  if (!isRecord(value) || !Number.isInteger(value.revision) || (value.revision as number) < 1) {
    throw new AppError(UNREADABLE);
  }
  const seen: Seen = { revision: value.revision as number };
  if (value.currentVersionId !== undefined) seen.currentVersionId = versionOrNone(value.currentVersionId);
  return seen;
}

/** An official version a page showed: its id, or null when there was no official text. */
function versionOrNone(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !isUuid(value)) throw new AppError(UNREADABLE);
  return value;
}

/** "Casey", "Casey or Dana", "Casey, Dana or Sam": any one of them. */
function anyOf(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} or ${names.at(-1)}`;
}

/**
 * The proposal form, as the screen sends it:
 *
 *   text proposals   { kind: "decision" | "official_text", sectionId, title,
 *                      businessTag ("" | garden_center | coffee_shop | both),
 *                      proposedOfficial (editor document), why, noteIds,
 *                      baseVersionId (a new proposal only: the official
 *                      version its text was typed against, null for none) }
 *   section changes  { kind: "structure", why, noteIds, change: one of
 *                      { action: "add", parentId ("" or null = top level), title }
 *                      { action: "rename", sectionId, title }
 *                      { action: "move", sectionId, parentId }
 *                      { action: "archive", sectionId } }
 *
 * `why` is the optional explanation, typed in a plain multi-line box. It is
 * kept exactly as typed, one paragraph per line.
 */
function readForm(raw: unknown, mode: "new" | "edit"): ProposalInput {
  if (!isRecord(raw)) throw new AppError(UNREADABLE);
  const why = raw.why === undefined || raw.why === null ? "" : text(raw.why, UNREADABLE);
  if (why.length > 20_000) throw new AppError("Keep the explanation shorter, or put the detail in a comment.");
  const description = why.trim().length > 0 ? textToDoc(why) : null;
  const noteIds = raw.noteIds === undefined ? [] : raw.noteIds;
  if (!Array.isArray(noteIds) || noteIds.length > 50 || !noteIds.every((id) => typeof id === "string" && isUuid(id))) {
    throw new AppError(UNREADABLE);
  }

  if (raw.kind === "structure") {
    const change = raw.change;
    if (!isRecord(change)) throw new AppError("Choose what to change.");
    const name = () => text(change.title, "Enter a name for the section.");
    switch (change.action) {
      case "add":
        return { kind: "structure", description, noteIds, change: { action: "add", parentId: parentId(change.parentId), title: name() } };
      case "rename":
        return { kind: "structure", description, noteIds, change: { action: "rename", sectionId: requireSectionId(change.sectionId), title: name() } };
      case "move":
        return { kind: "structure", description, noteIds, change: { action: "move", sectionId: requireSectionId(change.sectionId), parentId: parentId(change.parentId) } };
      case "archive":
        return { kind: "structure", description, noteIds, change: { action: "archive", sectionId: requireSectionId(change.sectionId) } };
      default:
        throw new AppError("Choose what to change.");
    }
  }

  if (raw.kind !== "decision" && raw.kind !== "official_text") throw new AppError("Choose what kind of proposal this is.");
  if (!isRecord(raw.proposedOfficial)) throw new AppError("That text could not be read. Please try again.");
  const input: TextProposalInput = {
    kind: raw.kind,
    sectionId: requireSectionId(raw.sectionId),
    title: text(raw.title, "Say in a few words what is being decided."),
    description,
    businessTag: raw.businessTag,
    proposedOfficial: raw.proposedOfficial,
    noteIds,
  };
  // A new text proposal always says which official text it was typed
  // against, so that text typed before someone else's change is not proposed
  // as if it had been written with that change in view. (An edit says what
  // its page showed in `seen` instead.)
  if (mode === "new") input.baseVersionId = versionOrNone(raw.baseVersionId);
  return input;
}

/** Make a proposal. Hands back its id so the screen can go to its page. */
export async function createProposalAction(form: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction<{ id: string }>(async (actor) => {
    const id = await createProposal(actor, readForm(form, "new"));
    return { data: { id } };
  });
}

/**
 * "Save changes" on an open proposal. For a text proposal, `seen` carries
 * the section's official version that the edit page showed
 * (`{ currentVersionId }`, null for none): saving says "I checked my
 * proposal against that text", which is what brings an out-of-date proposal
 * up to date. A section proposal sends no `seen`.
 */
export async function editProposalAction(proposalId: unknown, form: unknown, seen?: unknown): Promise<ActionResult> {
  return runAction(async (actor) => {
    const input = readForm(form, "edit");
    if (input.kind === "structure") {
      await editProposal(actor, requireProposalId(proposalId), input);
      return;
    }
    if (!isRecord(seen)) throw new AppError(UNREADABLE);
    await editProposal(actor, requireProposalId(proposalId), input, {
      currentVersionId: versionOrNone(seen.currentVersionId),
    });
  });
}

/** "Approve". `data.approved` says whether that made it official. */
export async function approveProposalAction(
  proposalId: unknown,
  seen: unknown,
): Promise<ActionResult<{ approved: boolean }>> {
  return runAction<{ approved: boolean }>(async (actor) => {
    const outcome = await approveProposal(actor, requireProposalId(proposalId), readSeen(seen));
    return {
      message: outcome.approved
        ? "Approved. It is official now."
        : `Your approval is recorded. Waiting for ${outcome.waitingFor.length > 0 ? anyOf(outcome.waitingFor) : "another Owner"}.`,
      data: { approved: outcome.approved },
    };
  });
}

/** "Approve on my own". */
export async function approveAloneAction(proposalId: unknown, seen: unknown): Promise<ActionResult> {
  return runAction(async (actor) => {
    await approveAlone(actor, requireProposalId(proposalId), readSeen(seen));
    return "Approved. It is official now.";
  });
}

/** "I approve too", on something another Owner decided alone. */
export async function addApprovalAction(proposalId: unknown): Promise<ActionResult> {
  return runAction(async (actor) => {
    await addApproval(actor, requireProposalId(proposalId));
  });
}

export async function declineProposalAction(proposalId: unknown, reason: unknown): Promise<ActionResult> {
  return runAction(async (actor) => {
    const why = reason === undefined || reason === null ? "" : text(reason, UNREADABLE);
    await declineProposal(actor, requireProposalId(proposalId), why);
  });
}

export async function withdrawProposalAction(proposalId: unknown): Promise<ActionResult> {
  return runAction(async (actor) => {
    await withdrawProposal(actor, requireProposalId(proposalId));
  });
}

export async function endorseProposalAction(proposalId: unknown, seen: unknown): Promise<ActionResult> {
  return runAction(async (actor) => {
    await endorseProposal(actor, requireProposalId(proposalId), readSeen(seen));
  });
}

/** A comment on a proposal, from the editor. Kept word for word. */
export async function addProposalCommentAction(proposalId: unknown, doc: unknown): Promise<ActionResult> {
  return runAction(async (actor) => {
    if (!isRecord(doc)) throw new AppError("That text could not be read. Please try again.");
    await addProposalComment(actor, requireProposalId(proposalId), doc);
  });
}
