/**
 * Word-by-word difference between two plain texts, for "What will change"
 * on a proposal and for version history. It compares the plain-text copies
 * of official text, the same way on both screens.
 */

import { type RichDoc, type RichNode, docToText, sameDoc } from "./richtext";

export type DiffPart = { kind: "same" | "added" | "removed"; text: string };

/**
 * The limit on comparing word by word. Despite its name it counts PIECES: a
 * piece is a word or the gap between two words, so a text of 1,250 words is
 * about 2,500 pieces. It is applied to what is left of the two texts once
 * their unchanged start and unchanged end have been dropped:
 *
 *  - when what is left has at most this many pieces on each side, it is
 *    always compared, however different the two sides are;
 *  - when more is left (a long text changed near its start and near its
 *    end), it is still compared as long as the pieces removed plus the
 *    pieces added come to at most this many;
 *  - otherwise `diffWords` answers null and the screen shows both texts in
 *    full.
 *
 * So a long text with a few changed sentences is always compared, wherever
 * the changes are. The number is what keeps one comparison to about 13 MB of
 * working memory (see `byTable` and `byFewestChanges`); `tests/diff.test.ts`
 * pins both the limit and the memory.
 */
export const MAX_DIFF_WORDS = 2500;

/** Words and the spaces between them, so the text can be put back together exactly. */
function tokens(text: string): string[] {
  return text.match(/\s+|[^\s]+/g) ?? [];
}

/** Which pieces of each side stayed: 1 = stayed, 0 = removed (from `a`) or added (in `b`). */
type Kept = { a: Uint8Array; b: Uint8Array };

/**
 * Compare two lists of pieces with a table of every pair (longest common
 * subsequence, filled from the end so it can be read forwards). The table
 * takes two bytes per pair: 12.5 MB at 2,500 pieces a side.
 */
function byTable(a: string[], b: string[]): Kept {
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
  const kept: Kept = { a: new Uint8Array(a.length), b: new Uint8Array(b.length) };
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      kept.a[i] = 1;
      kept.b[j] = 1;
      i += 1;
      j += 1;
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return kept;
}

/**
 * Compare two lists of pieces that may be long but differ in few places
 * (Myers' method). It asks "can `a` be turned into `b` with 0 removals and
 * additions? with 1? with 2?" and so on, remembering for each number how far
 * it got, so the work and the memory grow with the number of differences,
 * not with the length of the texts. Gives up (null) beyond `limit`
 * differences. What it remembers is four bytes for every two numbers up to
 * the number of differences, squared and halved: 12.5 MB at 2,500.
 */
function byFewestChanges(a: string[], b: string[], limit: number): Kept | null {
  const n = a.length;
  const m = b.length;
  const most = Math.min(limit, n + m);
  const middle = most + 1;
  // furthest[middle + k]: how many pieces of `a` are dealt with by the best
  // attempt so far that has dealt with k more pieces of `a` than of `b`.
  const furthest = new Int32Array(2 * most + 3);
  // history[d]: `furthest` as it stood with d differences (every other k).
  const history: Int32Array[] = [];
  let differences = -1;
  for (let d = 0; d <= most && differences < 0; d += 1) {
    for (let k = -d; k <= d; k += 2) {
      const addedHere = k === -d || (k !== d && furthest[middle + k - 1] < furthest[middle + k + 1]);
      let x = addedHere ? furthest[middle + k + 1] : furthest[middle + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x += 1;
        y += 1;
      }
      furthest[middle + k] = x;
      if (x === n && y === m) {
        differences = d;
        break;
      }
    }
    const snapshot = new Int32Array(d + 1);
    for (let k = -d; k <= d; k += 2) snapshot[(k + d) / 2] = furthest[middle + k];
    history.push(snapshot);
  }
  if (differences < 0) return null;

  // Walk back from the end, one difference at a time, marking what stayed.
  const kept: Kept = { a: new Uint8Array(n), b: new Uint8Array(m) };
  let x = n;
  let y = m;
  for (let d = differences; d > 0; d -= 1) {
    const earlier = history[d - 1];
    const at = (k: number) => earlier[(k + d - 1) / 2];
    const k = x - y;
    const addedHere = k === -d || (k !== d && at(k - 1) < at(k + 1));
    const fromK = addedHere ? k + 1 : k - 1;
    const fromX = at(fromK);
    const afterTheDifference = addedHere ? fromX : fromX + 1;
    while (x > afterTheDifference) {
      x -= 1;
      y -= 1;
      kept.a[x] = 1;
      kept.b[y] = 1;
    }
    x = fromX;
    y = fromX - fromK;
  }
  while (x > 0) {
    x -= 1;
    y -= 1;
    kept.a[x] = 1;
    kept.b[y] = 1;
  }
  return kept;
}

/**
 * The parts that stayed, were removed, and were added, in reading order.
 * Where words were replaced, what was removed comes before what was added.
 * Returns null when the two texts differ too much to compare word by word
 * (see `MAX_DIFF_WORDS`); the screen then shows both texts in full instead.
 */
export function diffWords(before: string, after: string): DiffPart[] | null {
  const a = tokens(before);
  const b = tokens(after);

  // The unchanged start and the unchanged end need no comparing.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  const leftA = a.slice(start, endA);
  const leftB = b.slice(start, endB);
  const kept =
    leftA.length <= MAX_DIFF_WORDS && leftB.length <= MAX_DIFF_WORDS
      ? byTable(leftA, leftB)
      : byFewestChanges(leftA, leftB, MAX_DIFF_WORDS);
  if (!kept) return null;

  const parts: DiffPart[] = [];
  const push = (kind: DiffPart["kind"], pieces: string[]) => {
    if (pieces.length === 0) return;
    const text = pieces.join("");
    const last = parts.at(-1);
    if (last && last.kind === kind) last.text += text;
    else parts.push({ kind, text });
  };
  push("same", a.slice(0, start));
  // Between two stretches that stayed: everything removed, then everything added.
  let i = 0;
  let j = 0;
  while (i < leftA.length || j < leftB.length) {
    const removed: string[] = [];
    const added: string[] = [];
    const same: string[] = [];
    while (i < leftA.length && kept.a[i] === 0) removed.push(leftA[i++]);
    while (j < leftB.length && kept.b[j] === 0) added.push(leftB[j++]);
    // What stayed is the same on both sides, piece for piece.
    while (i < leftA.length && j < leftB.length && kept.a[i] === 1 && kept.b[j] === 1) {
      same.push(leftA[i]);
      i += 1;
      j += 1;
    }
    push("removed", removed);
    push("added", added);
    push("same", same);
  }
  push("same", a.slice(endA));
  return parts;
}

/** How two versions of official text differ, for the screen to describe. */
export type DocComparison =
  /** Nothing differs. */
  | { kind: "same" }
  /**
   * The words are the same, in the same order. What differs is formatting
   * or layout (bold, a table, a list, a paragraph split in two, the spaces
   * and line breaks between words), and possibly one of two things that are
   * more than layout:
   *  - `links`: a link's address was added, removed or changed, or a link
   *    now covers different words;
   *  - `checks`: a checkbox was ticked or unticked (the lines that are
   *    ticked are not the same lines as before).
   * Both false: only formatting or layout changed.
   */
  | { kind: "formatting"; links: boolean; checks: boolean }
  | { kind: "words"; parts: DiffPart[] }
  /** Too different to compare word by word: show both texts in full instead. */
  | { kind: "tooLong" };

/** The words alone, without the spaces and line breaks between them. */
function wordsOf(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

function sameList(a: (string | number | null)[], b: (string | number | null)[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

/**
 * What in a document is more than layout while not being a word: which
 * letters carry a link (and where it leads), and which checkboxes are
 * ticked. Places are counted in letters, leaving out spaces, so two
 * documents with the same words can be compared place by place however
 * their paragraphs, lists and tables are laid out.
 */
function beyondLayout(doc: RichDoc): { links: (string | number | null)[]; ticked: number[] } {
  // Runs of letters with the same link address: [address or null, letters], ...
  const links: (string | number | null)[] = [];
  const ticked: number[] = [];
  let letters = 0;
  const walk = (node: RichNode) => {
    if (typeof node.text === "string") {
      const count = node.text.replace(/\s+/g, "").length;
      if (count === 0) return;
      const link = node.marks?.find((mark) => mark.type === "link");
      const href = typeof link?.attrs?.href === "string" ? link.attrs.href : null;
      if (links.length > 0 && links[links.length - 2] === href) {
        links[links.length - 1] = (links[links.length - 1] as number) + count;
      } else {
        links.push(href, count);
      }
      letters += count;
      return;
    }
    if (node.type === "taskItem" && node.attrs?.checked === true) ticked.push(letters);
    for (const child of node.content ?? []) walk(child);
  };
  for (const node of doc.content) walk(node);
  return { links, ticked };
}

/** Compare official text before and after a change. `before` is null when there was none. */
export function compareDocs(before: RichDoc | null, after: RichDoc): DocComparison {
  const beforeText = before ? docToText(before) : "";
  const afterText = docToText(after);
  // The same words in the same order: whatever else differs, no word was
  // added, removed or changed. (Spaces and line breaks between words are
  // layout: a paragraph split in two, a table laid out differently.)
  if (beforeText === afterText || sameList(wordsOf(beforeText), wordsOf(afterText))) {
    if (!before || sameDoc(before, after)) return { kind: "same" };
    const was = beyondLayout(before);
    const is = beyondLayout(after);
    return { kind: "formatting", links: !sameList(was.links, is.links), checks: !sameList(was.ticked, is.ticked) };
  }
  const parts = diffWords(beforeText, afterText);
  return parts ? { kind: "words", parts } : { kind: "tooLong" };
}
