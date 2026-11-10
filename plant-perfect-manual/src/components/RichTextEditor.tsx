"use client";

import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useRef, useState, useTransition } from "react";
import type { ActionResult } from "@/lib/actions";
import { clearDraft, readDraft, writeDraft } from "@/lib/drafts";
import type { RichDoc } from "@/lib/richtext";

/**
 * The one text editor used everywhere text is entered.
 * Formatting on offer matches what the server accepts (src/lib/richtext.ts):
 * bold, italic, underline, two heading sizes, bulleted and numbered lists,
 * checkboxes, links and tables.
 */
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
];

type Props = {
  initialDoc: RichDoc;
  /** Where the unsaved copy is kept on this device while typing. */
  draftKey: string;
  label: string;
  saveLabel: string;
  /** Shown next to the Save button, e.g. what saving will record. */
  note?: string;
  onSave: (doc: RichDoc) => Promise<ActionResult>;
  onDone: () => void;
};

function normalizeLink(input: string): string {
  const value = input.trim();
  if (!value) return "";
  if (/^(https?:\/\/|mailto:|tel:)/i.test(value)) return value;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return `mailto:${value}`;
  return `https://${value}`;
}

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
}: Props) {
  // This component only ever runs in the browser (it is loaded on demand).
  const [draft] = useState(() => readDraft(draftKey));
  const [restoredAt, setRestoredAt] = useState<number | null>(draft?.at ?? null);
  const [changed, setChanged] = useState(draft !== null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState("");
  const [saving, startSaving] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRef = useRef<() => void>(() => {});

  const editor = useEditor({
    extensions,
    content: draft?.doc ?? initialDoc,
    // Safe because this component never renders on the server (it is loaded
    // on demand, in the browser only).
    immediatelyRender: true,
    editorProps: {
      attributes: { role: "textbox", "aria-multiline": "true", "aria-label": label },
      handleKeyDown: (_view, event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
          event.preventDefault();
          saveRef.current();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: current }) => {
      setChanged(true);
      setError(null);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => writeDraft(draftKey, current.getJSON() as RichDoc), 400);
    },
  });

  // Keep the safety copy current if the page is hidden or closed mid-typing.
  useEffect(() => {
    if (!editor) return;
    const flush = () => {
      if (!timer.current) return;
      clearTimeout(timer.current);
      timer.current = null;
      writeDraft(draftKey, editor.getJSON() as RichDoc);
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
  }, [editor, draftKey]);

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

  const save = () => {
    if (!editor || saving) return;
    stopTimer();
    const doc = editor.getJSON() as RichDoc;
    writeDraft(draftKey, doc);
    startSaving(async () => {
      const result = await onSave(doc);
      if (result.ok) {
        clearDraft(draftKey);
        onDone();
      } else {
        setError(result.error);
      }
    });
  };
  useEffect(() => {
    saveRef.current = save;
  });

  const discard = () => {
    stopTimer();
    clearDraft(draftKey);
    onDone();
  };

  const startOver = () => {
    if (!editor) return;
    stopTimer();
    editor.commands.setContent(initialDoc, { emitUpdate: false });
    clearDraft(draftKey);
    setRestoredAt(null);
    setChanged(false);
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
      // Keep the cursor in the text when a tool is pressed.
      onMouseDown={(event) => event.preventDefault()}
      onClick={run}
    >
      {text}
    </button>
  );

  return (
    <div>
      {restoredAt !== null && (
        <p className="notice">
          Picked up your unsaved changes from {timeFormat.format(new Date(restoredAt))}.{" "}
          <button type="button" className="btn-text" onClick={startOver}>
            Start over from the saved text
          </button>
        </p>
      )}
      <div className="editor">
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

        {linkOpen && (
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

      {confirmDiscard ? (
        <div className="editor-actions">
          <span>Throw away your changes?</span>
          <button type="button" className="btn btn-danger" onClick={discard}>
            Discard changes
          </button>
          <button type="button" className="btn" onClick={() => setConfirmDiscard(false)}>
            Keep editing
          </button>
        </div>
      ) : (
        <div className="editor-actions">
          <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? "Saving" : saveLabel}
          </button>
          <button
            type="button"
            className="btn"
            disabled={saving}
            onClick={() => (changed ? setConfirmDiscard(true) : discard())}
          >
            Cancel
          </button>
          {note && <span className="muted small">{note}</span>}
        </div>
      )}
    </div>
  );
}
