"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { saveOfficialAction } from "@/app/(app)/sections/actions";
import { officialDraftKey, useHasDraft } from "@/lib/drafts";
import { EMPTY_DOC, type RichDoc } from "@/lib/richtext";

// The editor is only downloaded when someone presses "Edit official",
// so reading pages stay light and fast on a phone.
const RichTextEditor = dynamic(() => import("./RichTextEditor"), {
  ssr: false,
  loading: () => <p className="muted">Opening the editor</p>,
});

type Props = {
  sectionId: string;
  doc: RichDoc | null;
  /** The official version on screen (null when there is no official text yet). */
  versionId: string | null;
  canEdit: boolean;
  userName: string;
  /** The official text as shown to readers (drawn on the server). */
  children: React.ReactNode;
};

/** The Official area of a section page: the text, plus "Edit official" for Owners. */
export function OfficialBlock({ sectionId, doc, versionId, canEdit, userName, children }: Props) {
  const [editing, setEditing] = useState(false);
  const draftKey = officialDraftKey(sectionId);
  const hasDraft = useHasDraft(draftKey);

  return (
    <section className="block" aria-labelledby="official-heading">
      <div className="block-head">
        <h2 id="official-heading">Official</h2>
        {canEdit && !editing && (
          <button type="button" className="btn" onClick={() => setEditing(true)}>
            Edit official
          </button>
        )}
      </div>
      {editing ? (
        <RichTextEditor
          initialDoc={doc ?? EMPTY_DOC}
          draftKey={draftKey}
          label="Official text"
          saveLabel="Save as official"
          note={`Saving records this text as approved by ${userName}, with today's date. Earlier versions are kept.`}
          onSave={(next) => saveOfficialAction(sectionId, next, versionId)}
          onDone={() => setEditing(false)}
        />
      ) : (
        <>
          {canEdit && hasDraft && (
            <p className="notice">
              You have unsaved changes to this text on this device.{" "}
              <button type="button" className="btn-text" onClick={() => setEditing(true)}>
                Continue editing
              </button>
            </p>
          )}
          {children}
        </>
      )}
    </section>
  );
}
