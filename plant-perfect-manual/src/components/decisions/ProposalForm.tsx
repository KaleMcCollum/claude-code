"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useId, useRef, useState, useTransition } from "react";
import { createProposalAction, editProposalAction } from "@/app/(app)/proposals/actions";
import type { EditorControl } from "@/components/RichTextEditor";
import { BUSINESS_CHOICES, matchesSection } from "@/components/notes/NoteSortForm";
import type { SectionOption } from "@/components/notes/data";
import type { ActionResult } from "@/lib/actions";
import type { BusinessTag } from "@/lib/business";
import { newProposalDraftKey, proposalDraftKey } from "@/lib/drafts";
import { EMPTY_DOC, type RichDoc } from "@/lib/richtext";

// The editor is downloaded only when the form needs it.
const RichTextEditor = dynamic(() => import("@/components/RichTextEditor"), {
  ssr: false,
  loading: () => <p className="muted">Opening the editor</p>,
});

export type ProposalKind = "decision" | "official_text" | "structure";
export type StructureAction = "add" | "rename" | "move" | "archive";

type Props = {
  /** A new proposal, or changes to one that is still open. */
  mode: "new" | "edit";
  proposalId?: string;
  /** What the form starts on. When editing, the kind cannot be changed. */
  kind: ProposalKind;
  /** Text proposals: the section it is about (null: ask "Which section?" first). */
  section: { id: string; label: string } | null;
  /** Text proposals: what the editor starts with. */
  startDoc: RichDoc | null;
  /**
   * Text proposals: an id for the saved text the editor starts from. A new
   * proposal: the section's current official version (null when it has no
   * official text). Editing: the proposal's own revision ("rev:3"). The
   * editor uses it to notice a copy on this device that was typed against
   * something older.
   */
  baseId?: string | null;
  /**
   * The saved text the editor starts from, drawn for reading: the section's
   * official text as it is now (a new proposal), or the proposed text as it
   * was last saved (editing). Shown next to a copy from this device that was
   * typed against something older.
   */
  currentText?: React.ReactNode;
  /**
   * Editing a text proposal: the section's official version when the page
   * was drawn (null when it had none). Sent back with Save changes, which is
   * how the proposer says "I checked my proposal against this text".
   */
  seenVersionId?: string | null;
  /** Editing: the proposal is out of date, so saving it brings it up to date. */
  checking?: boolean;
  /** Editing: shown right above the proposed text (the official text now, when it has changed). */
  aboveText?: React.ReactNode;
  /** The names of the three kinds, as they read everywhere else (`PROPOSAL_TYPE_LABELS`). */
  kindLabels: Record<ProposalKind, string>;
  /** Every section, in manual order. */
  options: SectionOption[];
  /** Sections the source note is filed under: offered first when choosing. */
  suggested?: SectionOption[];
  /** The note this proposal comes from, if any. */
  noteId?: string | null;
  /** That note, drawn word for word (read-only). */
  fromNote?: React.ReactNode;
  /** The names of the other people who can approve (empty when there is nobody else). */
  otherApprovers: string[];
  /** Values to start from (editing). */
  initial?: {
    title?: string;
    businessTag?: BusinessTag | null;
    why?: string;
    action?: StructureAction;
    /** The section a structure change is about. For "add": the section to add under. */
    sectionId?: string | null;
    /** For "move": where to. */
    parentId?: string | null;
    name?: string;
  };
};

const KINDS: { value: ProposalKind; hint: string }[] = [
  { value: "decision", hint: "Sets or changes something official: a wage, hours, a policy, a vendor." },
  { value: "official_text", hint: "Rewords the official text without changing what was decided." },
  { value: "structure", hint: "Add, rename, move or archive a section." },
];

const ACTIONS: { value: StructureAction; label: string }[] = [
  { value: "add", label: "Add a section" },
  { value: "rename", label: "Rename a section" },
  { value: "move", label: "Move a section" },
  { value: "archive", label: "Archive a section" },
];

/** How many matches the "Find a section" box shows at once. */
const MATCHES_SHOWN = 8;
const NOT_SENT = "That did not go through. Check your connection and try again. Nothing you typed is lost.";

const optionLabel = (option: SectionOption) => `${option.number} ${option.title}`;

/**
 * The proposal form: one page, one button at the bottom. Used for a new
 * proposal and for changing one that is still open. A refusal from the app
 * is shown in place and everything typed stays where it is.
 */
export function ProposalForm({
  mode,
  proposalId,
  kind: startKind,
  section,
  startDoc,
  baseId,
  currentText,
  seenVersionId,
  checking = false,
  aboveText,
  kindLabels,
  options,
  suggested = [],
  noteId = null,
  fromNote,
  otherApprovers,
  initial = {},
}: Props) {
  const router = useRouter();
  const ids = useId();
  const editing = mode === "edit";

  const [kind, setKind] = useState<ProposalKind>(startKind);
  const [title, setTitle] = useState(initial.title ?? "");
  const [business, setBusiness] = useState<BusinessTag | "">(initial.businessTag ?? "");
  const [why, setWhy] = useState(initial.why ?? "");
  const [action, setAction] = useState<StructureAction>(initial.action ?? "add");
  // For "add": the section to add under ("" = top level). Otherwise the section to change.
  const [addUnder, setAddUnder] = useState(initial.action === "add" ? (initial.sectionId ?? "") : "");
  const [target, setTarget] = useState(initial.action !== "add" ? (initial.sectionId ?? "") : "");
  // Sections that can have a section added or moved under them (three levels at most).
  const parents = options.filter((option) => option.depth <= 2);
  // The stored place to move it under is only kept when it can still be
  // chosen. Otherwise the box would show "Top level" while the old place was sent.
  const destinationGone =
    editing && initial.action === "move" && !!initial.parentId && !parents.some((option) => option.id === initial.parentId);
  const [moveUnder, setMoveUnder] = useState(destinationGone ? "" : (initial.parentId ?? ""));
  const [name, setName] = useState(initial.name ?? "");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, startWork] = useTransition();

  // The editor hands over a way to read its text when Propose is pressed.
  const editor = useRef<EditorControl | null>(null);
  const editorReady = useCallback((control: EditorControl | null) => {
    editor.current = control;
  }, []);

  const isText = kind !== "structure";
  // Where the proposed text is kept on this device while typing.
  const draftKey =
    editing && proposalId ? proposalDraftKey(proposalId) : section ? newProposalDraftKey(section.id) : null;
  const needsSection = isText && !section;
  const fixedTarget = options.find((option) => option.id === initial.sectionId);
  // A section cannot be moved under itself. What is offered is what can be
  // sent: a choice that is not among these counts as "Top level".
  const moveChoices = parents.filter((option) => option.id !== target);
  const moveTo = moveChoices.some((option) => option.id === moveUnder) ? moveUnder : "";

  /** The address of this form for one section, keeping the kind and the note. */
  const hrefFor = (sectionId: string | null) => {
    const params = new URLSearchParams();
    if (sectionId) params.set("section", sectionId);
    else params.set("pick", "1");
    if (kind === "official_text") params.set("kind", "wording");
    if (noteId) params.set("note", noteId);
    return `/proposals/new?${params.toString()}`;
  };

  const submit = () => {
    setError(null);
    let form: Record<string, unknown>;
    if (isText) {
      if (!section) return;
      const control = editor.current;
      if (!control) {
        setError("The editor is still opening. Try again in a moment.");
        return;
      }
      // A copy picked up from this device that is out of date: choose first.
      const problem = control.problem();
      if (problem) {
        setError(problem);
        return;
      }
      form = {
        kind,
        sectionId: section.id,
        title,
        businessTag: business,
        proposedOfficial: control.getDoc(),
        why,
      };
      // A new proposal says which official text it was typed against: the
      // one the editor started from, or the one its picked-up copy remembers.
      if (!editing) form.baseVersionId = control.getBase();
    } else {
      const change =
        action === "add"
          ? { action, parentId: addUnder, title: name }
          : action === "rename"
            ? { action, sectionId: target, title: name }
            : action === "move"
              ? { action, sectionId: target, parentId: moveTo }
              : { action, sectionId: target };
      form = { kind, change, why };
    }
    if (!editing && noteId) form.noteIds = [noteId];

    startWork(async () => {
      let result: ActionResult<{ id: string }>;
      try {
        result =
          editing && proposalId
            ? await editProposalAction(proposalId, form, isText ? { currentVersionId: seenVersionId ?? null } : undefined)
            : await createProposalAction(form);
      } catch {
        result = { ok: false, error: NOT_SENT };
      }
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // Saved: the copy of the text kept on this device is no longer needed.
      editor.current?.saved();
      const id = editing ? proposalId : result.data?.id;
      // An out-of-date proposal that was just saved again: its page says so.
      router.push(id ? `/proposals/${id}${editing && isText && checking ? "?checked=1" : ""}` : "/proposals");
    });
  };

  const text = query.trim().toLowerCase();
  const found = text ? options.filter((option) => matchesSection(option, text)) : [];
  const shown = found.slice(0, MATCHES_SHOWN);
  const pickLink = (option: SectionOption, indent = false) => (
    <li key={option.id} style={indent ? { paddingLeft: (option.depth - 1) * 22 } : undefined}>
      <Link href={hrefFor(option.id)}>
        <span className="num">{option.number}</span> {option.title}
      </Link>
    </li>
  );

  const sectionSelect = (
    id: string,
    label: string,
    value: string,
    onChange: (next: string) => void,
    list: SectionOption[],
    first: { value: string; text: string },
  ) => (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} className="select" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value={first.value}>{first.text}</option>
        {list.map((option) => (
          <option key={option.id} value={option.id}>
            {optionLabel(option)}
          </option>
        ))}
      </select>
    </div>
  );

  const nameField = (label: string) => (
    <div className="field">
      <label htmlFor={`${ids}-name`}>{label}</label>
      <input
        id={`${ids}-name`}
        className="input"
        type="text"
        value={name}
        maxLength={120}
        autoComplete="off"
        onChange={(event) => setName(event.target.value)}
      />
    </div>
  );

  // The note this proposal comes from, word for word. It is drawn by the page
  // and handed over ready-made, and it sits alone in its wrapper: next to
  // other lines, React's development build can take a piece handed over
  // like this for an item of a list and complain that it has no key.
  const noteBlock = fromNote ? (
    <div className="field">
      <p className="field-label">From this note</p>
      <div>{fromNote}</div>
    </div>
  ) : null;

  /** When editing, what cannot be changed is shown as plain words. */
  const fixed = (label: string, value: string) => (
    <div className="field">
      <p className="field-label">{label}</p>
      <p className="field-fixed">{value}</p>
    </div>
  );

  return (
    <form
      className="proposal-form"
      aria-label={editing ? "Edit proposal" : "New proposal"}
      // The app checks what is typed and says what is wrong in its own words.
      // (The browser's own check would also stop the form over a half-typed
      // link address in the editor's link box, without a word from the app.)
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy) submit();
      }}
      onKeyDown={(event) => {
        // Return in a one-line box (Title, Name, Find a section) must not
        // send the form: on a phone it is how the keyboard is put away. Only
        // the button, or Ctrl/Cmd+Enter in the text, sends it.
        const box = event.target;
        if (
          event.key === "Enter" &&
          box instanceof HTMLInputElement &&
          !["checkbox", "radio", "button", "submit", "reset", "file"].includes(box.type)
        ) {
          event.preventDefault();
          box.blur();
        }
      }}
    >
      {editing ? (
        fixed("What is this about?", kindLabels[kind])
      ) : (
        <fieldset>
          <legend>What is this about?</legend>
          {KINDS.map((item) => (
            <div key={item.value} className="choice">
              <label className="check">
                <input
                  type="radio"
                  name={`${ids}-kind`}
                  value={item.value}
                  checked={kind === item.value}
                  aria-describedby={`${ids}-kind-${item.value}`}
                  onChange={() => {
                    setError(null);
                    setKind(item.value);
                  }}
                />
                <span>{kindLabels[item.value]}</span>
              </label>
              <p className="hint" id={`${ids}-kind-${item.value}`}>
                {item.hint}
              </p>
            </div>
          ))}
        </fieldset>
      )}

      {/* Coming from a note with no section chosen yet: the note is shown here already. */}
      {needsSection && noteBlock}

      {isText && needsSection && (
        <div className="section-picker">
          <p className="field-label">Which section?</p>
          {suggested.length > 0 && (
            <>
              <p className="hint">The note is filed under:</p>
              <ul className="pick-list" aria-label="Sections the note is filed under">
                {suggested.map((option) => pickLink(option))}
              </ul>
            </>
          )}
          <label className="field sort-find">
            <span>Find a section</span>
            <input
              className="input"
              type="search"
              value={query}
              placeholder="Type a name or number"
              autoComplete="off"
              enterKeyHint="search"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          {text && (
            <>
              <ul className="pick-list" aria-label="Matching sections">
                {shown.map((option) => pickLink(option))}
              </ul>
              {found.length === 0 && (
                <p className="muted small">No section matches. Try another word, or show all sections.</p>
              )}
              {found.length > shown.length && (
                <p className="muted small">
                  Showing the first {shown.length} of {found.length}. Type more to narrow it down.
                </p>
              )}
            </>
          )}
          <details className="sort-all">
            <summary>Show all sections</summary>
            <ul className="pick-list" aria-label="All sections">
              {options.map((option) => pickLink(option, true))}
            </ul>
          </details>
        </div>
      )}

      {isText && section && (
        <>
          <div className="field">
            <p className="field-label">Section</p>
            <p className="field-fixed">
              {section.label}
              {!editing && (
                <>
                  {" "}
                  <Link className="tap-link" href={hrefFor(null)} aria-label="Change the section">
                    Change
                  </Link>
                </>
              )}
            </p>
          </div>

          <div className="field">
            <label htmlFor={`${ids}-title`}>Title</label>
            <p className="hint" id={`${ids}-title-hint`}>
              A few words, for example: Coffee Shop starting wage $15.00/hr
            </p>
            <input
              id={`${ids}-title`}
              className="input"
              type="text"
              value={title}
              maxLength={160}
              autoComplete="off"
              aria-describedby={`${ids}-title-hint`}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>

          {/* (Alone in its wrapper, for the same reason as the note above.) */}
          {aboveText && <div>{aboveText}</div>}

          <div className="field">
            <p className="field-label">Proposed official text</p>
            <p className="hint">
              Change this to what the official text should say once this is approved.
            </p>
            {draftKey && (
              <RichTextEditor
                // Another section means another text: start again from that section's words.
                key={draftKey}
                initialDoc={startDoc ?? EMPTY_DOC}
                draftKey={draftKey}
                label="Proposed official text"
                onReady={editorReady}
                baseId={baseId}
                currentText={currentText}
                // Editing: a copy on this device can only be older than the
                // proposal as it was last saved (from another device).
                baseWords={editing ? { name: "this proposal", heading: "The proposed text as it was last saved" } : undefined}
              />
            )}
          </div>

          <fieldset>
            <legend>Business</legend>
            <div className="choices">
              {BUSINESS_CHOICES.map((choice) => (
                <label key={choice.value} className="check">
                  <input
                    type="radio"
                    name={`${ids}-business`}
                    value={choice.value}
                    checked={business === choice.value}
                    onChange={() => setBusiness(choice.value)}
                  />
                  <span>{choice.text}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </>
      )}

      {!isText && (
        <>
          {editing ? (
            fixed("What do you want to change?", ACTIONS.find((item) => item.value === action)?.label ?? "")
          ) : (
            <fieldset>
              <legend>What do you want to change?</legend>
              {ACTIONS.map((item) => (
                <label key={item.value} className="check">
                  <input
                    type="radio"
                    name={`${ids}-action`}
                    value={item.value}
                    checked={action === item.value}
                    onChange={() => {
                      setError(null);
                      setAction(item.value);
                    }}
                  />
                  <span>{item.label}</span>
                </label>
              ))}
            </fieldset>
          )}

          {action === "add" ? (
            <>
              {editing
                ? fixed("Under", fixedTarget ? optionLabel(fixedTarget) : "Top level")
                : sectionSelect(`${ids}-under`, "Under", addUnder, setAddUnder, parents, {
                    value: "",
                    text: "Top level",
                  })}
              {nameField("Name")}
            </>
          ) : (
            <>
              {editing
                ? // (A proposal whose section is gone cannot be edited, so there always is one.)
                  fixed("Section", fixedTarget ? optionLabel(fixedTarget) : "")
                : sectionSelect(
                    `${ids}-target`,
                    "Section",
                    target,
                    (next) => {
                      setTarget(next);
                      // The section itself is no longer offered as the place to move it under.
                      if (next === moveUnder) setMoveUnder("");
                    },
                    options,
                    { value: "", text: "Choose a section" },
                  )}
              {action === "rename" && nameField("New name")}
              {action === "move" &&
                sectionSelect(`${ids}-move`, "Move it under", moveTo, setMoveUnder, moveChoices, {
                  value: "",
                  text: "Top level",
                })}
              {action === "move" && destinationGone && (
                <p className="hint">
                  The section it was going to move under can no longer be chosen (it may have been
                  archived). Choose where it should go.
                </p>
              )}
              {action === "archive" && (
                <p className="hint">
                  Archiving hides the section and everything under it. Nothing is deleted, and it
                  can be restored.
                </p>
              )}
            </>
          )}
        </>
      )}

      {!needsSection && (
        <>
          <div className="field">
            <label htmlFor={`${ids}-why`}>Why (optional)</label>
            <textarea
              id={`${ids}-why`}
              className="input"
              rows={4}
              value={why}
              onChange={(event) => setWhy(event.target.value)}
            />
          </div>

          {noteBlock}

          {error && (
            <p className="notice error" role="alert">
              {error}
            </p>
          )}

          <div className="row">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {editing ? "Save changes" : "Propose"}
            </button>
            {editing && proposalId && (
              // Leaves without saving. What was typed in the text stays on this device.
              <Link className="tap-link" href={`/proposals/${proposalId}`}>
                Cancel
              </Link>
            )}
          </div>
          {!editing && (
            <p className="muted small form-foot">
              {otherApprovers.length > 0
                ? `Proposing counts as your approval. It becomes official when ${otherApprovers.join(" or ")} approves too.`
                : "You are the only Owner, so you will need to approve it on your own."}
            </p>
          )}
        </>
      )}
    </form>
  );
}
