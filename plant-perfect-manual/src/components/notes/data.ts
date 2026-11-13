import type { BusinessTag } from "@/lib/business";
import type { NoteSectionLink, NoteView } from "@/lib/notes";
import { type NoteProposalLine, PROPOSAL_STATUS_LABELS, displayTitle } from "@/lib/proposals";
import type { RichDoc } from "@/lib/richtext";
import { type SectionNode, flattenTree } from "@/lib/sections";
import { formatDate, formatDateKey, formatDateTime, formatTime } from "@/lib/time";

/**
 * What the note block on screen needs, worked out on the server. Dates and
 * times are already written out in US Central time, so the phone or computer
 * showing them never has to (and can never disagree with the server).
 */
export type NoteBlockData = {
  id: string;
  /** The Daily Log day, e.g. "2026-11-10". */
  logDate: string;
  /** The same day for reading: "Nov 10, 2026". */
  day: string;
  body: RichDoc;
  authorName: string;
  /** "3:42 PM" */
  time: string;
  /** "Nov 10, 2026, 3:42 PM" */
  dateTime: string;
  /** When the author last changed the wording ("Nov 10, 2026, 3:50 PM"), if ever. */
  edited: string | null;
  /** Earlier wordings, oldest first, with when each was replaced. */
  revisions: { body: RichDoc; replaced: string }[];
  businessTag: BusinessTag | null;
  sorted: boolean;
  sections: NoteSectionLink[];
  comments: { id: string; body: RichDoc; authorName: string; when: string }[];
  /** Proposals made from this note, each with where it stands ("waiting for approval"). */
  proposals: { id: string; title: string; status: string }[];
  /** True when the person looking at it is the one who wrote it. */
  mine: boolean;
};

/** A removed note, as Owners see it in the Daily Log (one line with Restore). */
export type RemovedNoteData = {
  id: string;
  authorName: string;
  /** "3:42 PM": when the note was written. */
  time: string;
  /** "Nov 10, 2026": the Daily Log day the note belongs to. */
  day: string;
  removedByName: string | null;
  /** "Nov 10, 2026" */
  removedOn: string;
};

/** A section that a note can be filed under. */
export type SectionOption = { id: string; number: string; title: string; depth: number };

/**
 * `proposals` are the proposals made from this note (`proposalsForNotes`).
 * Each is named as in every other list (`displayTitle`), which needs the
 * sections as they are now: a section proposal is described with today's
 * names and numbers, not with the ones stored when it was made.
 */
export function toNoteBlockData(
  note: NoteView,
  viewerId: string,
  tree: SectionNode[],
  proposals: NoteProposalLine[] = [],
): NoteBlockData {
  return {
    id: note.id,
    logDate: note.logDate,
    day: formatDateKey(note.logDate),
    body: note.body,
    authorName: note.authorName,
    time: formatTime(note.createdAt),
    dateTime: formatDateTime(note.createdAt),
    edited: note.editedAt ? formatDateTime(note.editedAt) : null,
    revisions: note.revisions.map((revision) => ({
      body: revision.body,
      replaced: formatDateTime(revision.replacedAt),
    })),
    businessTag: note.businessTag,
    sorted: note.sorted,
    sections: note.sections,
    comments: note.comments.map((comment) => ({
      id: comment.id,
      body: comment.body,
      authorName: comment.authorName,
      when: formatDateTime(comment.createdAt),
    })),
    proposals: proposals.map((proposal) => ({
      id: proposal.id,
      title: displayTitle(proposal, tree),
      status: PROPOSAL_STATUS_LABELS[proposal.status].toLowerCase(),
    })),
    mine: note.authorId === viewerId,
  };
}

export function toRemovedNoteData(note: NoteView): RemovedNoteData {
  return {
    id: note.id,
    authorName: note.authorName,
    time: formatTime(note.createdAt),
    day: formatDateKey(note.logDate),
    removedByName: note.removedByName,
    removedOn: formatDate(note.removedAt ?? note.createdAt),
  };
}

/** Every section that is not archived, in manual order. */
export function toSectionOptions(tree: SectionNode[]): SectionOption[] {
  return flattenTree(tree).map((node) => ({
    id: node.id,
    number: node.number,
    title: node.title,
    depth: node.depth,
  }));
}
