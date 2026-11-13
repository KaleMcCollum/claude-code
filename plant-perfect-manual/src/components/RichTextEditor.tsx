"use client";

import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { EditorState, Plugin } from "@tiptap/pm/state";
import { EditorContent, Extension, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useRef, useState, useTransition } from "react";
import type { ActionResult } from "@/lib/actions";
import { clearDraft, readDraft, writeDraft } from "@/lib/drafts";
import { type RichDoc, isEmptyDoc } from "@/lib/richtext";

/**
 * The one text editor used everywhere text is entered.
 * Formatting on offer matches what the server accepts (src/lib/richtext.ts):
 * bold, italic, underline, two heading sizes, bulleted and numbered lists,
 * checkboxes, links and tables.
 *
 * It has two looks. The full one (official text) shows the formatting
 * buttons all the time. The compact one (notes and comments) is a small text
 * area that grows as you type, with Save right under it and the same
 * formatting buttons behind one "Formatting" button.
 */

/** Editors whose text is on its way to the server right now. */
const savingEditors = new WeakSet<object>();

/**
 * When notes are written one after another, the box is emptied as soon as a
 * note is saved. Anything typed during that short moment would vanish with
 * it, so typing is held back until the save has finished.
 */
const HoldWhileSaving = Extension.create({
  name: "holdWhileSaving",
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        filterTransaction: (transaction) => !(transaction.docChanged && savingEditors.has(editor)),
      }),
    ];
  },
});

const extensions = [
  StarterKit.configure({
    blockquote: false,
    code: false,
    codeBlock: false,
    horizontalRule: false,
    strike: false,
    heading: { levels: [2, 3] },
    link: {
      openOnClick: false,
      autolink: true,
      defaultProtocol: "https",
      protocols: ["http", "https", "mailto", "tel"],
    },
  }),
  TaskList,
  TaskItem.configure({ nested: true }),
  TableKit.configure({ table: { resizable: false } }),
  HoldWhileSaving,
];

/**
 * How a surrounding form reads the text when the editor sits inside it
 * without buttons of its own (the proposal form).
 */
export type EditorControl = {
  /** The text as it is right now. (Anything typed a moment ago is put in the safety copy first.) */
  getDoc: () => RichDoc;
  /**
   * What the text was typed against (see `baseId`): the one the editor
   * started from, or the one a picked-up copy was typed against. Null when
   * there was no saved text, or when the editor is not told (`baseId` left out).
   */
  getBase: () => string | null;
  /**
   * A choice the person has to make before the text can be sent (an
   * out-of-date copy was picked up), in words for them. Null when there is none.
   */
  problem: () => string | null;
  /** Call once the form has been saved: the safety copy is no longer needed. */
  saved: () => void;
};

type Shared = {
  initialDoc: RichDoc;
  /** Where the unsaved copy is kept on this device while typing. */
  draftKey: string;
  label: string;
  /** The small look for notes and comments. */
  compact?: boolean;
  /**
   * Put the cursor in the text and bring the editor into view. 0 (or left
   * out) does nothing; each new number does it again.
   */
  focusRequest?: number;
  /**
   * An id that changes whenever the saved text the editor starts from
   * (`initialDoc`) changes: for official text, the official version. Null:
   * there is no saved text yet. Left out: not used (notes and comments).
   *
   * The editor remembers the one it started from and keeps it in the copy on
   * the device. A copy picked up later that was typed against something
   * else is out of date: the person is told, shown `currentText`, and has to
   * choose before they can save.
   */
  baseId?: string | null;
  /** The saved text as it is now, drawn for reading, shown next to an out-of-date copy. */
  currentText?: React.ReactNode;
  /**
   * What the saved text is called, where it is not the official text (a
   * proposal being changed): `name` in the out-of-date notice ("before this
   * proposal was last changed"), `heading` above `currentText`.
   */
  baseWords?: { name: string; heading: string };
};

/** The usual way: the editor has its own Save and Cancel buttons. */
type WithButtons = Shared & {
  saveLabel: string;
  /** Shown next to the Save button, e.g. what saving will record. */
  note?: string;
  /**
   * `base` is what the text was typed against (see `baseId`; null when that
   * is not used). Send this one to the server, never the page's own value.
   */
  onSave: (doc: RichDoc, base: string | null) => Promise<ActionResult<unknown>>;
  /** Called when the editor should close: after a save, or after Cancel. */
  onDone: () => void;
  /**
   * For writing one note after another: when given, a successful save empties
   * the text, keeps the editor open with the cursor in it, and calls this
   * instead of `onDone`.
   */
  onSaved?: () => void;
  onReady?: undefined;
};

/**
 * Inside a larger form that has one button of its own: no Save or Cancel
 * here. The form is handed an `EditorControl` to read the text when its
 * button is pressed (and null when the editor goes away).
 */
type InsideForm = Shared & {
  onReady: (control: EditorControl | null) => void;
  saveLabel?: undefined;
  note?: undefined;
  onSave?: undefined;
  onDone?: undefined;
  onSaved?: undefined;
};

type Props = WithButtons | InsideForm;

function normalizeLink(input: string): string {
  const value = input.trim();
  if (!value) return "";
  if (/^(https?:\/\/|mailto:|tel:)/i.test(value)) return value;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return `mailto:${value}`;
  return `https://${value}`;
}

/**
 * The editor's document as plain data, ready to be sent to the app.
 *
 * The editor hands out the settings of a block or of a link (a link's
 * address, whether a checkbox is ticked, the size of a heading, where a
 * numbered list starts) as objects of a special kind. Those are silently left
 * out when a document is sent to the app as it is: the link would be saved
 * as plain words, the checkbox unticked, a small heading as a large one.
 * Copying the document through text turns them into ordinary data.
 */
function docOf(editor: { getJSON: () => unknown }): RichDoc {
  return JSON.parse(JSON.stringify(editor.getJSON())) as RichDoc;
}

/**
 * Keep the unsaved text on this device (or drop the copy when there is
 * nothing to keep). `base` is what it was typed against.
 */
function keepCopy(draftKey: string, doc: RichDoc, dropIfEmpty: boolean, base: string | null | undefined): void {
  if (dropIfEmpty && isEmptyDoc(doc)) clearDraft(draftKey);
  else writeDraft(draftKey, doc, base);
}

const OFFICIAL_TEXT_WORDS = { name: "the official text", heading: "The official text now" };

/** Said when Save is pressed while an out-of-date copy is waiting for a choice. */
const CHOOSE_FIRST = "Choose first: start over from the current text, or keep what you typed.";

const timeFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export default function RichTextEditor({
  initialDoc,
  draftKey,
  label,
  saveLabel,
  note,
  onSave,
  onDone,
  compact = false,
  onSaved,
  focusRequest = 0,
  onReady,
  baseId,
  currentText,
  baseWords = OFFICIAL_TEXT_WORDS,
}: Props) {
  // Inside a form: the form has the button, this is only the text.
  const insideForm = onReady !== undefined;
  // This component only ever runs in the browser (it is loaded on demand).
  const [draft] = useState(() => readDraft(draftKey));
  const [openedAt] = useState(() => Date.now());
  const [restoredAt, setRestoredAt] = useState<number | null>(draft?.at ?? null);
  const [changed, setChanged] = useState(draft !== null);
  // What the text in the editor was typed against. Set once, when the editor
  // opens: a picked-up copy brings its own (none at all for a copy from
  // before this was recorded), otherwise it is the saved text on the page.
  // It only changes when the person chooses to start over or to keep going.
  const [base, setBaseState] = useState<string | null | undefined>(() =>
    baseId === undefined ? undefined : draft ? draft.base : baseId,
  );
  // The same value for the timers and handlers below, which outlive a render.
  const baseRef = useRef(base);
  const setBase = (next: string | null | undefined) => {
    baseRef.current = next;
    setBaseState(next);
  };
  // The text here was typed against something other than what is saved now.
  const outOfDate = baseId !== undefined && base !== baseId;
  const [error, setError] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState("");
  // Compact look only: whether the formatting buttons are showing.
  const [toolsOpen, setToolsOpen] = useState(false);
  const [saving, startSaving] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRef = useRef<() => void>(() => {});
  const rootRef = useRef<HTMLDivElement>(null);
  // A new note or comment starts from nothing: there is no saved text to go
  // back to, and an empty box is not worth keeping a safety copy of.
  const startsEmpty = compact && isEmptyDoc(initialDoc);

  const editor = useEditor({
    extensions,
    // Never turn typed or pasted characters into formatting. Without this the
    // editor would, for example, swallow the asterisks in "12 * 4 * 2" and make
    // the 4 italic. Words must be stored exactly as typed; formatting comes
    // only from the toolbar and its keyboard shortcuts.
    enableInputRules: false,
    enablePasteRules: false,
    content: draft?.doc ?? initialDoc,
    // Safe because this component never renders on the server (it is loaded
    // on demand, in the browser only).
    immediatelyRender: true,
    editorProps: {
      attributes: { role: "textbox", "aria-multiline": "true", "aria-label": label },
      handleKeyDown: (_view, event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
          event.preventDefault();
          if (insideForm) rootRef.current?.closest("form")?.requestSubmit();
          else saveRef.current();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: current }) => {
      setChanged(true);
      setError(null);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        keepCopy(draftKey, docOf(current), startsEmpty, baseRef.current);
      }, 400);
    },
  });

  // Keep the safety copy current if the page is hidden or closed mid-typing.
  useEffect(() => {
    if (!editor) return;
    const flush = () => {
      if (!timer.current) return;
      clearTimeout(timer.current);
      timer.current = null;
      keepCopy(draftKey, docOf(editor), startsEmpty, baseRef.current);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
    };
  }, [editor, draftKey, startsEmpty]);

  // Put the cursor in the text when asked (a new note, a comment), and make
  // sure the whole box, Save button included, is on screen.
  useEffect(() => {
    // (An editor made while the page was still loading can already have been
    // thrown away; its replacement arrives a moment later and runs this again.)
    if (!editor || editor.isDestroyed || !focusRequest) return;
    editor.commands.focus("end");
    rootRef.current?.scrollIntoView({ block: "nearest" });
  }, [editor, focusRequest]);

  const active = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e
        ? {
            bold: e.isActive("bold"),
            italic: e.isActive("italic"),
            underline: e.isActive("underline"),
            block: e.isActive("heading", { level: 2 })
              ? "h2"
              : e.isActive("heading", { level: 3 })
                ? "h3"
                : "p",
            bullets: e.isActive("bulletList"),
            numbers: e.isActive("orderedList"),
            checks: e.isActive("taskList"),
            link: e.isActive("link"),
            table: e.isActive("table"),
            canUndo: e.can().undo(),
            canRedo: e.can().redo(),
          }
        : null,
  });

  const stopTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  // Inside a form, hand the form a way to read the text and to say "saved".
  useEffect(() => {
    if (!onReady || !editor) return;
    onReady({
      getDoc: () => {
        // Words typed a moment ago go into the safety copy now. Nothing else
        // is written: text nobody touched is not worth a copy, and a copy of
        // it would later be taken for the person's own changes.
        if (timer.current) {
          clearTimeout(timer.current);
          timer.current = null;
          keepCopy(draftKey, docOf(editor), startsEmpty, baseRef.current);
        }
        return docOf(editor);
      },
      getBase: () => baseRef.current ?? null,
      problem: () => (outOfDate ? CHOOSE_FIRST : null),
      saved: () => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = null;
        clearDraft(draftKey);
      },
    });
    return () => onReady(null);
  }, [onReady, editor, draftKey, startsEmpty, outOfDate]);

  const save = () => {
    if (!editor || saving || !onSave) return;
    if (outOfDate) {
      setError(CHOOSE_FIRST);
      return;
    }
    const doc = docOf(editor);
    // As in getDoc above: only what was typed a moment ago is written.
    if (timer.current) {
      stopTimer();
      keepCopy(draftKey, doc, startsEmpty, baseRef.current);
    }
    startSaving(async () => {
      if (onSaved) savingEditors.add(editor);
      let result: ActionResult<unknown>;
      try {
        result = await onSave(doc, baseRef.current ?? null);
      } catch {
        // The request never reached the app (for example a phone with no
        // signal). The text is still here and in the safety copy.
        result = {
          ok: false,
          error: "That did not go through. Check your connection and try again. Your text is still here.",
        };
      } finally {
        savingEditors.delete(editor);
      }
      if (!result.ok) {
        setError(result.error);
        return;
      }
      clearDraft(draftKey);
      if (!onSaved) {
        onDone?.();
        return;
      }
      // Ready for the next one: a brand-new empty text (so Undo cannot bring
      // the saved words back into the box), with the cursor still in it.
      if (!editor.isDestroyed) {
        editor.view.updateState(
          EditorState.create({ schema: editor.schema, plugins: editor.state.plugins }),
        );
        // An empty step, so the formatting buttons catch up with the new text.
        editor.view.dispatch(editor.state.tr);
        editor.commands.focus();
      }
      setRestoredAt(null);
      setChanged(false);
      setConfirmDiscard(false);
      onSaved();
    });
  };
  useEffect(() => {
    saveRef.current = save;
  });

  const discard = () => {
    stopTimer();
    clearDraft(draftKey);
    onDone?.();
  };

  /** Drop what was typed and begin again from the saved text as it is now. */
  const startOver = () => {
    if (!editor) return;
    stopTimer();
    editor.commands.setContent(initialDoc, { emitUpdate: false });
    clearDraft(draftKey);
    setRestoredAt(null);
    setChanged(false);
    setError(null);
    if (baseId !== undefined) setBase(baseId);
  };

  /**
   * An out-of-date copy: go on with what was typed, knowing the saved text
   * has changed. From here on it counts as typed against the saved text as
   * it is now, and the copy on the device says so too.
   */
  const keepTyped = () => {
    if (!editor || baseId === undefined) return;
    stopTimer();
    setBase(baseId);
    setError(null);
    keepCopy(draftKey, docOf(editor), startsEmpty, baseId);
  };

  const openLink = () => {
    if (!editor) return;
    setLinkValue((editor.getAttributes("link").href as string | undefined) ?? "");
    setLinkOpen(true);
  };

  const applyLink = () => {
    if (!editor) return;
    const href = normalizeLink(linkValue);
    const chain = editor.chain().focus().extendMarkRange("link");
    if (!href) {
      chain.unsetLink().run();
    } else if (editor.state.selection.empty && !editor.isActive("link")) {
      chain
        .insertContent({ type: "text", text: linkValue.trim(), marks: [{ type: "link", attrs: { href } }] })
        .run();
    } else {
      chain.setLink({ href }).run();
    }
    setLinkOpen(false);
  };

  if (!editor || !active) return <p className="muted">Preparing the editor</p>;

  // Pressing a button must not take the cursor (and a phone's keyboard) away
  // from the text.
  const keepCursor = (event: React.MouseEvent) => event.preventDefault();
  const showTools = !compact || toolsOpen;

  const tool = (
    text: React.ReactNode,
    title: string,
    run: () => void,
    pressed?: boolean,
    disabled?: boolean,
  ) => (
    <button
      type="button"
      className="tool"
      title={title}
      aria-label={title}
      aria-pressed={pressed}
      disabled={disabled}
      onMouseDown={keepCursor}
      onClick={run}
    >
      {text}
    </button>
  );

  return (
    <div ref={rootRef} className={compact ? "editor-block compact" : "editor-block"}>
      {outOfDate ? (
        <>
          <div className="notice editor-outdated">
            <p>
              You typed this on {timeFormat.format(new Date(restoredAt ?? openedAt))}, before{" "}
              {baseWords.name} was last changed. It does not include that change.
            </p>
            <div className="row">
              <button type="button" className="btn-text" onClick={startOver}>
                Start over from the current text
              </button>
              <button type="button" className="btn-text" onClick={keepTyped}>
                Keep what I typed
              </button>
            </div>
          </div>
          {currentText && (
            <div className="editor-current">
              <h3>{baseWords.heading}</h3>
              {/* (Alone in its wrapper: it is handed over ready-made by the page.) */}
              <div>{currentText}</div>
            </div>
          )}
        </>
      ) : (
        restoredAt !== null &&
        (startsEmpty ? (
          <p className="muted small editor-restored">
            Picked up what you typed on {timeFormat.format(new Date(restoredAt))}. It was kept on
            this device.
          </p>
        ) : (
          <p className="notice">
            Picked up your unsaved changes from {timeFormat.format(new Date(restoredAt))}.{" "}
            <button type="button" className="btn-text" onClick={startOver}>
              Start over from the saved text
            </button>
          </p>
        ))
      )}
      <div className={compact ? "editor compact" : "editor"}>
        {showTools && (
        <div className="toolbar" role="toolbar" aria-label="Formatting">
          <select
            className="tool"
            aria-label="Text size"
            value={active.block}
            onChange={(event) => {
              const value = event.target.value;
              const chain = editor.chain().focus();
              if (value === "p") chain.setParagraph().run();
              else chain.setHeading({ level: value === "h2" ? 2 : 3 }).run();
            }}
          >
            <option value="p">Normal text</option>
            <option value="h2">Heading</option>
            <option value="h3">Small heading</option>
          </select>
          <span className="sep" />
          {tool(<strong>B</strong>, "Bold", () => editor.chain().focus().toggleBold().run(), active.bold)}
          {tool(<em>I</em>, "Italic", () => editor.chain().focus().toggleItalic().run(), active.italic)}
          {tool(<u>U</u>, "Underline", () => editor.chain().focus().toggleUnderline().run(), active.underline)}
          <span className="sep" />
          {tool("Bullets", "Bulleted list", () => editor.chain().focus().toggleBulletList().run(), active.bullets)}
          {tool("Numbers", "Numbered list", () => editor.chain().focus().toggleOrderedList().run(), active.numbers)}
          {tool("Checkboxes", "Checkbox list", () => editor.chain().focus().toggleTaskList().run(), active.checks)}
          <span className="sep" />
          {tool("Link", "Add or change a link", openLink, active.link)}
          {tool(
            "Table",
            "Insert a table",
            () => editor.chain().focus().insertTable({ rows: 3, cols: 2, withHeaderRow: true }).run(),
            undefined,
            active.table,
          )}
          <span className="tool-group-end">
            {tool("Undo", "Undo", () => editor.chain().focus().undo().run(), undefined, !active.canUndo)}
            {tool("Redo", "Redo", () => editor.chain().focus().redo().run(), undefined, !active.canRedo)}
          </span>
        </div>
        )}

        {showTools && linkOpen && (
          <div className="toolbar-extra">
            <input
              className="input"
              type="url"
              inputMode="url"
              placeholder="Web address, for example plantperfect.com"
              aria-label="Link address"
              value={linkValue}
              autoFocus
              onChange={(event) => setLinkValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  applyLink();
                }
                if (event.key === "Escape") setLinkOpen(false);
              }}
            />
            <button type="button" className="btn" onClick={applyLink}>
              {linkValue.trim() ? "Apply link" : "Remove link"}
            </button>
            <button type="button" className="btn-text" onClick={() => setLinkOpen(false)}>
              Cancel
            </button>
          </div>
        )}

        {active.table && (
          <div className="toolbar-extra" role="toolbar" aria-label="Table">
            <span className="muted">Table:</span>
            {tool("Add row", "Add a row below", () => editor.chain().focus().addRowAfter().run())}
            {tool("Add column", "Add a column to the right", () => editor.chain().focus().addColumnAfter().run())}
            {tool("Remove row", "Remove this row", () => editor.chain().focus().deleteRow().run())}
            {tool("Remove column", "Remove this column", () => editor.chain().focus().deleteColumn().run())}
            {tool("Remove table", "Remove the whole table", () => editor.chain().focus().deleteTable().run())}
          </div>
        )}

        <EditorContent editor={editor} />
      </div>

      {error && (
        <p className="notice error" role="alert" style={{ marginTop: 10 }}>
          {error}
        </p>
      )}

      {insideForm ? null : confirmDiscard ? (
        <div className="editor-actions">
          <span>{startsEmpty ? "Throw away what you typed?" : "Throw away your changes?"}</span>
          <button type="button" className="btn btn-danger" onClick={discard}>
            {startsEmpty ? "Throw away" : "Discard changes"}
          </button>
          <button type="button" className="btn" onClick={() => setConfirmDiscard(false)}>
            {startsEmpty ? "Keep typing" : "Keep editing"}
          </button>
        </div>
      ) : (
        <div className="editor-actions">
          <button
            type="button"
            className="btn btn-primary"
            // In the compact look the cursor stays in the text, so the next
            // note can be typed straight away.
            onMouseDown={compact ? keepCursor : undefined}
            onClick={save}
            disabled={saving}
          >
            {saving ? "Saving" : saveLabel}
          </button>
          <button
            type="button"
            className="btn"
            disabled={saving}
            onClick={() => {
              const nothingTyped = startsEmpty && isEmptyDoc(docOf(editor));
              if (changed && !nothingTyped) setConfirmDiscard(true);
              else discard();
            }}
          >
            Cancel
          </button>
          {compact && (
            <button
              type="button"
              className="btn-text editor-tools-toggle"
              aria-expanded={toolsOpen}
              onMouseDown={keepCursor}
              onClick={() => {
                setToolsOpen(!toolsOpen);
                setLinkOpen(false);
              }}
            >
              Formatting
            </button>
          )}
          {note && <span className="muted small">{note}</span>}
        </div>
      )}
    </div>
  );
}
