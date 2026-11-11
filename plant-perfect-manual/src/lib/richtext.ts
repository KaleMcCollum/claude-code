import { AppError } from "./permissions";

/**
 * Rich text is stored as the editor's JSON document, never as HTML.
 * Text is kept character for character; only the structure around it is
 * checked, so nothing a browser could run can be saved.
 */
export type RichMark = { type: string; attrs?: Record<string, unknown> };
export type RichNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: RichNode[];
  text?: string;
  marks?: RichMark[];
};
export type RichDoc = { type: "doc"; content: RichNode[] };

export const EMPTY_DOC: RichDoc = { type: "doc", content: [{ type: "paragraph" }] };

const MAX_DOC_BYTES = 300_000;
const MAX_DEPTH = 40;

const BLOCK_TYPES = new Set([
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "listItem",
  "taskList",
  "taskItem",
  "table",
  "tableRow",
  "tableHeader",
  "tableCell",
]);
const MARK_TYPES = new Set(["bold", "italic", "underline", "link"]);

/** A NUL character or half of a two-part character: the database refuses these. */
const UNSTORABLE = /\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** Only ordinary web, email and phone links are kept. */
export function safeHref(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const href = value.trim();
  if (href.length === 0 || href.length > 2000) return null;
  if (/^(https?:\/\/|mailto:|tel:)/i.test(href)) return href;
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function intInRange(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max
    ? value
    : null;
}

function cleanMarks(input: unknown): RichMark[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const marks: RichMark[] = [];
  for (const mark of input) {
    if (!isRecord(mark) || typeof mark.type !== "string" || !MARK_TYPES.has(mark.type)) continue;
    if (marks.some((m) => m.type === mark.type)) continue;
    if (mark.type === "link") {
      const href = safeHref(isRecord(mark.attrs) ? mark.attrs.href : null);
      if (href) marks.push({ type: "link", attrs: { href } });
    } else {
      marks.push({ type: mark.type });
    }
  }
  return marks.length > 0 ? marks : undefined;
}

function cleanAttrs(type: string, attrs: unknown): Record<string, unknown> | undefined {
  const a = isRecord(attrs) ? attrs : {};
  switch (type) {
    case "heading":
      return { level: intInRange(a.level, 1, 3) ?? 2 };
    case "orderedList":
      return { start: intInRange(a.start, 0, 100000) ?? 1 };
    case "taskItem":
      return { checked: a.checked === true };
    case "tableHeader":
    case "tableCell":
      return {
        colspan: intInRange(a.colspan, 1, 50) ?? 1,
        rowspan: intInRange(a.rowspan, 1, 200) ?? 1,
      };
    default:
      return undefined;
  }
}

function cleanNode(input: unknown, depth: number): RichNode | null {
  if (!isRecord(input) || typeof input.type !== "string" || depth > MAX_DEPTH) return null;

  if (input.type === "text") {
    if (typeof input.text !== "string" || input.text.length === 0) return null;
    if (UNSTORABLE.test(input.text)) {
      // Never drop it silently: the words must stay exactly as typed.
      throw new AppError(
        "That text contains a character that can't be saved (it may have come from a paste, or half of an emoji). Retype that part and try again.",
      );
    }
    const node: RichNode = { type: "text", text: input.text };
    const marks = cleanMarks(input.marks);
    if (marks) node.marks = marks;
    return node;
  }
  if (input.type === "hardBreak") return { type: "hardBreak" };

  if (!BLOCK_TYPES.has(input.type)) {
    // Not something our editor produces. Keep any words it holds as plain text.
    const text = nodeText(input as RichNode).trim();
    return text ? { type: "paragraph", content: [{ type: "text", text }] } : null;
  }

  const node: RichNode = { type: input.type };
  const attrs = cleanAttrs(input.type, input.attrs);
  if (attrs) node.attrs = attrs;
  if (Array.isArray(input.content)) {
    const content = input.content
      .map((child) => cleanNode(child, depth + 1))
      .filter((child): child is RichNode => child !== null);
    if (content.length > 0) node.content = content;
  }
  return node;
}

/**
 * Check a document coming from the browser before it is saved.
 * Words are never changed. Anything that is not a known kind of block,
 * formatting or safe link is dropped or reduced to plain text.
 */
export function sanitizeDoc(input: unknown): RichDoc {
  if (!isRecord(input) || input.type !== "doc") {
    throw new AppError("That text could not be read. Please try again.");
  }
  let size = 0;
  try {
    size = JSON.stringify(input).length;
  } catch {
    throw new AppError("That text could not be read. Please try again.");
  }
  if (size > MAX_DOC_BYTES) {
    throw new AppError("That text is too long to save in one piece. Please shorten it.");
  }
  const content = (Array.isArray(input.content) ? input.content : [])
    .map((child) => cleanNode(child, 1))
    .filter((child): child is RichNode => child !== null);
  return { type: "doc", content: content.length > 0 ? content : [{ type: "paragraph" }] };
}

const LINE_BLOCKS = new Set(["paragraph", "heading", "listItem", "taskItem", "tableRow"]);

function nodeText(node: RichNode): string {
  if (typeof node.text === "string") return node.text;
  if (node.type === "hardBreak") return "\n";
  if (!Array.isArray(node.content)) return "";
  const parts = node.content.map((child) => (isRecord(child) ? nodeText(child as RichNode) : ""));
  if (node.type === "tableRow") return parts.map((p) => p.trim()).join("\t") + "\n";
  const text = parts.join("");
  return LINE_BLOCKS.has(node.type) && !text.endsWith("\n") ? text + "\n" : text;
}

/** The document's words as plain text (for search and for comparing versions). */
export function docToText(doc: RichDoc): string {
  return nodeText(doc)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * A document made from text typed in a plain multi-line box: one paragraph
 * per line, every line exactly as typed.
 */
export function textToDoc(text: string): RichDoc {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  return {
    type: "doc",
    content: lines.map((line) =>
      line.length > 0 ? { type: "paragraph", content: [{ type: "text", text: line }] } : { type: "paragraph" },
    ),
  };
}

/**
 * The other way round, to put such a document back into a plain box for
 * editing: one line per top-level block, nothing trimmed.
 */
export function docToLines(doc: RichDoc): string {
  return doc.content.map((node) => nodeText(node).replace(/\n$/, "")).join("\n");
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
}

/**
 * True when two documents are the same. The database may hand a document
 * back with its fields in a different order, so the order is ignored.
 */
export function sameDoc(a: RichDoc, b: RichDoc): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

export function isEmptyDoc(doc: RichDoc | null | undefined): boolean {
  if (!doc) return true;
  return docToText(doc).length === 0;
}
