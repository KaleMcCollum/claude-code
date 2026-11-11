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

const KINDS: { value: ProposalKind; label: string; hint: string }[] = [
  {
    value: "decision",
    label: "A decision",
    hint: "Sets or changes something official: a wage, hours, a policy, a vendor.",
  },
  {
    value: "official_text",
    label: "Wording only",
    hint: "Rewords the official text without changing what was decided.",
  },
  { value: "structure", label: "Sections", hint: "Add, rename, move or archive a section." },
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
  const [moveUnder, setMoveUnder] = useState(initial.parentId ?? "");
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
  // Sections that can have a section added or moved under them (three levels at most).
  const parents = options.filter((option) => option.depth <= 2);
  const fixedTarget = options.find((option) => option.id === initial.sectionId);

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
      form = {
        kind,
        sectionId: section.id,
        title,
        businessTag: business,
        proposedOfficial: control.getDoc(),
        why,
      };
    } else {
      const change =
        action === "add"
          ? { action, parentId: addUnder, title: name }
          : action === "rename"
            ? { action, sectionId: target, title: name }
            : action === "move"
              ? { action, sectionId: target, parentId: moveUnder }
              : { action, sectionId: target };
      form = { kind, change, why };
    }
    if (!editing && noteId) form.noteIds = [noteId];

    startWork(async () => {
      let result: ActionResult<{ id: string }>;
      try {
        result =
          editing && proposalId
            ? await editProposalAction(proposalId, form)
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
      router.push(id ? `/proposals/${id}` : "/proposals");
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
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy) submit();
      }}
    >
      {editing ? (
        fixed("What is this about?", KINDS.find((item) => item.value === kind)?.label ?? "")
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
                <span>{item.label}</span>
              </label>
              <p className="hint" id={`${ids}-kind-${item.value}`}>
                {item.hint}
              </p>
            </div>
          ))}
        </fieldset>
      )}

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
              onKeyDown={(event) => {
                // Enter here is for searching, not for sending the form.
                if (event.key === "Enter") event.preventDefault();
              }}
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
                ? fixed(
                    "Section",
                    fixedTarget ? optionLabel(fixedTarget) : "a section that has been archived",
                  )
                : sectionSelect(`${ids}-target`, "Section", target, setTarget, options, {
                    value: "",
                    text: "Choose a section",
                  })}
              {action === "rename" && nameField("New name")}
              {action === "move" &&
                sectionSelect(
                  `${ids}-move`,
                  "Move it under",
                  moveUnder,
                  setMoveUnder,
                  parents.filter((option) => option.id !== target),
                  { value: "", text: "Top level" },
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

          {fromNote && (
            <div className="field">
              <p className="field-label">From this note</p>
              {fromNote}
            </div>
          )}

          {error && (
            <p className="notice error" role="alert">
              {error}
            </p>
          )}

          <div className="row">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {editing ? "Save changes" : "Propose"}
            </button>
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
