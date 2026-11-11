"use client";

import { useId, useState, useTransition } from "react";
import { sortNoteAction } from "@/app/(app)/daily-log/actions";
import type { ActionResult } from "@/lib/actions";
import { BUSINESS_LABELS, type BusinessTag } from "@/lib/business";
import type { NoteSectionLink } from "@/lib/notes";
import { NOT_SENT } from "./NoteEditor";
import type { SectionOption } from "./data";

type Props = {
  noteId: string;
  /** "note by Kale, 3:42 PM": names the form for screen readers. */
  label: string;
  /** Where the note is filed now. */
  filed: NoteSectionLink[];
  businessTag: BusinessTag | null;
  sorted: boolean;
  /** Every section a note can be filed under, in manual order. */
  options: SectionOption[];
  onDone: () => void;
};

/** How many matches the "Find a section" box shows at once. */
const MATCHES_SHOWN = 8;

/** The Business choices, the same wherever a business is picked. */
export const BUSINESS_CHOICES: { value: BusinessTag | ""; text: string }[] = [
  { value: "", text: "None" },
  { value: "garden_center", text: BUSINESS_LABELS.garden_center },
  { value: "coffee_shop", text: BUSINESS_LABELS.coffee_shop },
  { value: "both", text: BUSINESS_LABELS.both },
];

/** True when what was typed (in lower case) fits this section's name or number. */
export function matchesSection(option: SectionOption, query: string): boolean {
  const title = option.title.toLowerCase();
  return (
    title.includes(query) ||
    option.number.startsWith(query) ||
    `${option.number} ${title}`.includes(query)
  );
}

/**
 * Sorting a note by hand, opened in place under the note: choose the
 * sections it belongs to, the business, and whether it now counts as sorted.
 * The note's words are never touched.
 */
export function NoteSortForm({ noteId, label, filed, businessTag, sorted, options, onDone }: Props) {
  // Sections the note is filed under when the form opens. A filing under a
  // section that has since been archived is not listed and is left alone.
  const [startIds] = useState(() =>
    filed.map((link) => link.id).filter((id) => options.some((option) => option.id === id)),
  );
  const [chosen, setChosen] = useState<string[]>(startIds);
  // Sections ticked in this form, in the order they were ticked.
  const [picked, setPicked] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [business, setBusiness] = useState<BusinessTag | "">(businessTag ?? "");
  const [markSorted, setMarkSorted] = useState(sorted);
  const [error, setError] = useState<string | null>(null);
  const [busy, startWork] = useTransition();
  const groupName = useId();

  const text = query.trim().toLowerCase();
  const found = text
    ? options.filter((option) => !startIds.includes(option.id) && matchesSection(option, text))
    : [];
  const shown = found.slice(0, MATCHES_SHOWN);
  // On top: where the note is filed already, then anything ticked here that
  // the search box is not showing right now. Nothing moves when it is tapped.
  const onTop = [
    ...startIds,
    ...picked.filter((id) => !startIds.includes(id) && !shown.some((option) => option.id === id)),
  ]
    .map((id) => options.find((option) => option.id === id))
    .filter((option): option is SectionOption => option !== undefined);

  const toggle = (id: string, on: boolean) => {
    setError(null);
    if (!on) {
      setChosen(chosen.filter((other) => other !== id));
      return;
    }
    // Choosing the first section is usually what "sorted" means.
    if (chosen.length === 0) setMarkSorted(true);
    setChosen([...chosen, id]);
    if (!picked.includes(id)) setPicked([...picked, id]);
  };

  const box = (option: SectionOption, indent = false) => (
    <label
      key={option.id}
      className="check"
      style={indent ? { paddingLeft: (option.depth - 1) * 22 } : undefined}
    >
      <input
        type="checkbox"
        checked={chosen.includes(option.id)}
        onChange={(event) => toggle(option.id, event.target.checked)}
      />
      <span>
        <span className="num">{option.number}</span> {option.title}
      </span>
    </label>
  );

  const save = () => {
    startWork(async () => {
      let result: ActionResult;
      try {
        result = await sortNoteAction(noteId, {
          sectionIds: chosen,
          businessTag: business === "" ? null : business,
          sorted: markSorted,
        });
      } catch {
        result = { ok: false, error: NOT_SENT };
      }
      if (result.ok) onDone();
      else setError(result.error);
    });
  };

  return (
    <form
      className="sort-form"
      aria-label={`Sort ${label}`}
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      {onTop.length > 0 && (
        <fieldset>
          <legend>Filed under</legend>
          {onTop.map((option) => box(option))}
        </fieldset>
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
            // Enter here is for searching, not for saving the form.
            if (event.key === "Enter") event.preventDefault();
          }}
        />
      </label>
      {text && (
        <div role="group" aria-label="Matching sections" className="sort-matches">
          {shown.map((option) => box(option))}
          {found.length === 0 && (
            <p className="muted small">No section matches. Try another word, or show all sections.</p>
          )}
          {found.length > shown.length && (
            <p className="muted small">
              Showing the first {shown.length} of {found.length}. Type more to narrow it down.
            </p>
          )}
        </div>
      )}

      <details className="sort-all">
        <summary>Show all sections</summary>
        <div role="group" aria-label="All sections">
          {options.map((option) => box(option, true))}
        </div>
      </details>

      <fieldset>
        <legend>Business</legend>
        <div className="choices">
          {BUSINESS_CHOICES.map((choice) => (
            <label key={choice.value} className="check">
              <input
                type="radio"
                name={groupName}
                value={choice.value}
                checked={business === choice.value}
                onChange={() => setBusiness(choice.value)}
              />
              <span>{choice.text}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="check sort-mark">
        <input
          type="checkbox"
          checked={markSorted}
          onChange={(event) => setMarkSorted(event.target.checked)}
        />
        <span>Mark as sorted</span>
      </label>

      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}

      <div className="row">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Saving" : "Save"}
        </button>
        <button type="button" className="btn" disabled={busy} onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}
