"use client";

import { useState } from "react";
import { addProposalCommentAction } from "@/app/(app)/proposals/actions";
import { NoteEditor } from "@/components/notes/NoteEditor";
import { proposalCommentDraftKey, useHasDraft } from "@/lib/drafts";
import { EMPTY_DOC } from "@/lib/richtext";

/**
 * "Add comment" under a proposal's comments: a small text box that opens in
 * place. Words typed and not saved are kept on the device and come back.
 */
export function ProposalCommentBox({ proposalId }: { proposalId: string }) {
  const draftKey = proposalCommentDraftKey(proposalId);
  const hasDraft = useHasDraft(draftKey);
  const [opened, setOpened] = useState(false);
  const open = opened || hasDraft;

  return open ? (
    <NoteEditor
      compact
      initialDoc={EMPTY_DOC}
      draftKey={draftKey}
      label="Comment on this proposal"
      saveLabel="Save comment"
      focusRequest={opened ? 1 : 0}
      onSave={(doc) => addProposalCommentAction(proposalId, doc)}
      onDone={() => setOpened(false)}
    />
  ) : (
    <button type="button" className="btn" onClick={() => setOpened(true)}>
      Add comment
    </button>
  );
}
