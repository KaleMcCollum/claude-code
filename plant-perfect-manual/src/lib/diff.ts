/**
 * Word-by-word difference between two plain texts, for "What will change"
 * on a proposal and for version history. It compares the plain-text copies
 * of official text, the same way on both screens.
 */

import { type RichDoc, docToText, sameDoc } from "./richtext";

export type DiffPart = { kind: "same" | "added" | "removed"; text: string };

/** Above this many words on either side, comparing word by word is skipped. */
export const MAX_DIFF_WORDS = 2500;

/** Words and the spaces between them, so the text can be put back together exactly. */
function tokens(text: string): string[] {
  return text.match(/\s+|[^\s]+/g) ?? [];
}

/**
 * The parts that stayed, were removed, and were added, in reading order.
 * Returns null when the texts are too long to compare word by word (the
 * screen then shows both texts in full instead).
 */
export function diffWords(before: string, after: string): DiffPart[] | null {
  const a = tokens(before);
  const b = tokens(after);
  if (a.length > MAX_DIFF_WORDS || b.length > MAX_DIFF_WORDS) return null;

  // Longest common subsequence, filled from the end so it can be read forwards.
  const width = b.length + 1;
  const table = new Uint16Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        a[i] === b[j]
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }

  const parts: DiffPart[] = [];
  const push = (kind: DiffPart["kind"], text: string) => {
    const last = parts.at(-1);
    if (last && last.kind === kind) last.text += text;
    else parts.push({ kind, text });
  };
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push("same", a[i]);
      i += 1;
      j += 1;
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
      push("removed", a[i]);
      i += 1;
    } else {
      push("added", b[j]);
      j += 1;
    }
  }
  while (i < a.length) push("removed", a[i++]);
  while (j < b.length) push("added", b[j++]);
  return parts;
}

/** How two versions of official text differ, for the screen to describe. */
export type DocComparison =
  /** Nothing differs. */
  | { kind: "same" }
  /** The words are the same; only formatting or layout (bold, a table, a list) differs. */
  | { kind: "formatting" }
  | { kind: "words"; parts: DiffPart[] }
  /** Too long to compare word by word: show both texts in full instead. */
  | { kind: "tooLong" };

/** Compare official text before and after a change. `before` is null when there was none. */
export function compareDocs(before: RichDoc | null, after: RichDoc): DocComparison {
  const beforeText = before ? docToText(before) : "";
  const afterText = docToText(after);
  if (beforeText === afterText) {
    if (!before) return { kind: "same" };
    return sameDoc(before, after) ? { kind: "same" } : { kind: "formatting" };
  }
  const parts = diffWords(beforeText, afterText);
  return parts ? { kind: "words", parts } : { kind: "tooLong" };
}
