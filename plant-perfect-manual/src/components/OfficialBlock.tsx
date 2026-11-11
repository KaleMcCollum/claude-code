"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
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
  /** May the person save official text directly ("Edit official")? */
  canEdit: boolean;
  /** May the person propose a change for the other Owner to approve? */
  canPropose: boolean;
  /** The official text as shown to readers (drawn on the server). */
  children: React.ReactNode;
};

/**
 * The Official area of a section page: the text, with "Propose a change"
 * (the usual way) and the quieter "Edit official" for Owners.
 */
export function OfficialBlock({ sectionId, doc, versionId, canEdit, canPropose, children }: Props) {
  const [editing, setEditing] = useState(false);
  const draftKey = officialDraftKey(sectionId);
  const hasDraft = useHasDraft(draftKey);

  return (
    <section className="block" aria-labelledby="official-heading">
      <div className="block-head">
        <h2 id="official-heading">Official</h2>
        {(canEdit || canPropose) && !editing && (
          <div className="block-actions">
            {canEdit && (
              <button type="button" className="btn" onClick={() => setEditing(true)}>
                Edit official
              </button>
            )}
            {canPropose && (
              <Link className="btn btn-primary" href={`/proposals/new?section=${sectionId}`}>
                Propose a change
              </Link>
            )}
          </div>
        )}
      </div>
      {editing ? (
        <RichTextEditor
          initialDoc={doc ?? EMPTY_DOC}
          draftKey={draftKey}
          label="Official text"
          saveLabel="Save as official"
          note="Saving makes this official right away, approved by you alone. The other Owner will see it flagged on Today. To ask for approval first, use Propose a change."
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
