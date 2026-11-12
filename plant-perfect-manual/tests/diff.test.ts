import { describe, expect, it } from "vitest";
import { type DiffPart, MAX_DIFF_WORDS, compareDocs, diffWords } from "@/lib/diff";
import { type RichDoc, type RichNode, sanitizeDoc } from "@/lib/richtext";

const show = (before: string, after: string) =>
  diffWords(before, after)!
    .map((p) => (p.kind === "same" ? p.text : p.kind === "added" ? `[+${p.text}]` : `[-${p.text}]`))
    .join("");

/** Both texts can be put back together exactly from the parts. */
function expectExact(parts: DiffPart[] | null, before: string, after: string): DiffPart[] {
  expect(parts).not.toBeNull();
  expect(parts!.filter((p) => p.kind !== "added").map((p) => p.text).join("")).toBe(before);
  expect(parts!.filter((p) => p.kind !== "removed").map((p) => p.text).join("")).toBe(after);
  // No two neighbours of the same kind, and nothing empty.
  parts!.forEach((part, index) => {
    expect(part.text.length).toBeGreaterThan(0);
    if (index > 0) expect(part.kind).not.toBe(parts![index - 1].kind);
  });
  return parts!;
}

/** How many pieces (words, and gaps between words) were removed or added. */
const piecesChanged = (parts: DiffPart[]) =>
  parts.filter((p) => p.kind !== "same").reduce((sum, p) => sum + (p.text.match(/\s+|[^\s]+/g) ?? []).length, 0);

/** `count` different words, e.g. "a0 a1 a2". */
const words = (prefix: string, count: number, gap = " ") => Array.from({ length: count }, (_, i) => `${prefix}${i}`).join(gap);

/** The same "random" numbers on every run. */
function dice(seed: number): (below: number) => number {
  let state = seed;
  return (below) => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state % below;
  };
}

describe("word-by-word difference", () => {
  it("marks what was removed and what was added, keeping the rest", () => {
    expect(show("Starting wage, Coffee Shop: $13.00/hr.", "Starting wage, Coffee Shop: $15.00/hr.")).toBe(
      "Starting wage, Coffee Shop: [-$13.00/hr.][+$15.00/hr.]",
    );
    expect(show("Open 9 to 6.", "Open 9 to 6. Closed Sundays.")).toBe("Open 9 to 6.[+ Closed Sundays.]");
    expect(show("Closed Sundays and Mondays.", "Closed Mondays.")).toBe("Closed [-Sundays and ]Mondays.");
    // A change in the middle, at the very start and at the very end.
    expect(show("Open 9 to 6 on weekdays.", "Open 8 to 6 on weekdays.")).toBe("Open [-9][+8] to 6 on weekdays.");
    expect(show("We open at 9.", "They open at 9.")).toBe("[-We][+They] open at 9.");
    expect(show("Pay is $13", "Pay is $15")).toBe("Pay is [-$13][+$15]");
    // Where words were replaced, the removed ones come first.
    expect(show("one two three", "uno dos three")).toBe("[-one][+uno] [-two][+dos] three");
  });

  it("puts both texts back together exactly", () => {
    const before = "Line one\n\nLine  two with   spaces\tand a tab";
    const after = "Line one\n\nLine two with   spaces and more";
    expectExact(diffWords(before, after), before, after);
  });

  it("handles empty texts and identical texts", () => {
    expect(diffWords("", "")).toEqual([]);
    expect(diffWords("", "New text.")).toEqual([{ kind: "added", text: "New text." }]);
    expect(diffWords("Old text.", "")).toEqual([{ kind: "removed", text: "Old text." }]);
    expect(diffWords("Same words.", "Same words.")).toEqual([{ kind: "same", text: "Same words." }]);
    // One text is the start, or the end, of the other.
    expect(diffWords("a b", "a b c d")).toEqual([
      { kind: "same", text: "a b" },
      { kind: "added", text: " c d" },
    ]);
    expect(diffWords("a b c d", "c d")).toEqual([
      { kind: "removed", text: "a b " },
      { kind: "same", text: "c d" },
    ]);
    // The same word at the start and the end is not counted twice.
    expect(diffWords("a", "a a")).toEqual([
      { kind: "same", text: "a" },
      { kind: "added", text: " a" },
    ]);
  });

  it("gives up on very different long texts instead of slowing the page down", () => {
    const long = words("w", MAX_DIFF_WORDS);
    expect(diffWords(long, "short")).toBeNull();
    expect(diffWords("short", long)).toBeNull();
    const fits = words("w", 1000);
    expect(diffWords(fits, `${fits} more`)?.at(-1)).toEqual({ kind: "added", text: " more" });
  });
});

describe("long texts", () => {
  /** 500 sentences of ten words: 5,000 words. */
  const sentences = Array.from({ length: 500 }, (_, i) => `Sentence ${i} says the staff of the store open early.`);
  const text = (list: string[]) => list.join(" ");
  const changed = (...places: number[]) =>
    sentences.map((sentence, i) => (places.includes(i) ? `Rule ${i} now says everyone starts work at eight sharp.` : sentence));

  it("a 5,000-word text with three changed sentences is compared, wherever they are, in well under a second", () => {
    const before = text(sentences);
    expect(before.split(" ")).toHaveLength(5000);
    for (const places of [
      [3, 250, 496], // near the start, in the middle, near the end
      [0, 1, 499], // the very first and the very last sentence
      [200, 201, 202], // next to each other
      [10, 11, 480],
    ]) {
      const after = text(changed(...places));
      const started = performance.now();
      const parts = diffWords(before, after);
      const took = performance.now() - started;
      expectExact(parts, before, after);
      // Only the three sentences are marked: ten words and nine gaps each
      // way at most, per sentence.
      expect(piecesChanged(parts!)).toBeLessThanOrEqual(3 * 2 * 19);
      expect(piecesChanged(parts!)).toBeGreaterThan(3 * 10);
      const marked = (kind: DiffPart["kind"]) => parts!.filter((p) => p.kind === kind).map((p) => p.text).join(" ");
      expect(marked("added").match(/eight sharp\./g)).toHaveLength(3);
      expect(marked("removed").match(/open early\./g)).toHaveLength(3);
      expect(took).toBeLessThan(500);
    }
    // The other way round, and a sentence added or taken out.
    const shorter = text(sentences.filter((_, i) => i !== 7 && i !== 300));
    expect(piecesChanged(expectExact(diffWords(before, shorter), before, shorter))).toBe(2 * 20);
    expect(piecesChanged(expectExact(diffWords(shorter, before), shorter, before))).toBe(2 * 20);
  });

  it("the limit is 2,500 words-and-gaps, counted in what is left after the unchanged start and end", () => {
    expect(MAX_DIFF_WORDS).toBe(2500);
    const start = words("start", 3000);
    const end = words("end", 3000);
    const around = (middle: string) => `${start} ${middle} ${end}`;

    // 1,250 words are 2,499 pieces (1,250 words and the 1,249 gaps between
    // them). Everything in them differs, the gaps too: that is 4,998
    // differences, and it is still compared, because what is left after the
    // unchanged start and end fits the limit on both sides.
    const a = words("a", 1250, " ");
    const b = words("b", 1250, "  ");
    expect(piecesChanged(expectExact(diffWords(a, b), a, b))).toBe(4998);
    expect(piecesChanged(expectExact(diffWords(around(a), around(b)), around(a), around(b)))).toBe(4998);
    // One side of 2,500 pieces against nothing at all.
    const exactly = `${words("a", 1250)} `;
    expect(piecesChanged(expectExact(diffWords(around(exactly), around("")), around(exactly), around("")))).toBe(2500);

    // One word more on one side (2,501 pieces left) and it is too much.
    const a1 = words("a", 1251, " ");
    const b1 = words("b", 1251, "  ");
    expect(diffWords(a1, b)).toBeNull();
    expect(diffWords(a, b1)).toBeNull();
    expect(diffWords(around(a1), around(b))).toBeNull();
  });

  it("more than that is left: compared while at most 2,500 words-and-gaps were removed or added in all", () => {
    // 6,000 different words; every fourth one of the first 5,000 is replaced.
    const original = Array.from({ length: 6000 }, (_, i) => `w${i}`);
    const replaced = (count: number) => original.map((word, i) => (i % 4 === 0 && i / 4 < count ? `x${i}` : word));
    const before = original.join(" ");
    // 1,250 words replaced: 1,250 removed and 1,250 added.
    const atTheLimit = replaced(1250).join(" ");
    expect(piecesChanged(expectExact(diffWords(before, atTheLimit), before, atTheLimit))).toBe(2500);
    expect(piecesChanged(expectExact(diffWords(atTheLimit, before), atTheLimit, before))).toBe(2500);
    // One more.
    const over = replaced(1251).join(" ");
    expect(diffWords(before, over)).toBeNull();
    expect(diffWords(over, before)).toBeNull();
    // Words taken out here and there: 2,500 of them is fine, 2,501 is not.
    const without = (count: number) => original.filter((_, i) => !(i % 2 === 1 && (i - 1) / 2 < count)).join(" ");
    expect(piecesChanged(expectExact(diffWords(before, without(1250)), before, without(1250)))).toBe(2500);
    expect(diffWords(before, without(1251))).toBeNull();
  });

  it("one comparison never needs more than about 15 MB of working memory", () => {
    // Count what the comparison sets aside for its tables.
    const real = { Uint16Array: globalThis.Uint16Array, Int32Array: globalThis.Int32Array, Uint8Array: globalThis.Uint8Array };
    let bytes = 0;
    const counting = <T extends object>(target: T): T =>
      new Proxy(target, {
        construct(made, args, newTarget) {
          const array = Reflect.construct(made as never, args, newTarget === undefined ? (made as never) : newTarget) as { byteLength: number };
          bytes += array.byteLength;
          return array;
        },
      });
    const measure = (before: string, after: string): { bytes: number; compared: boolean } => {
      bytes = 0;
      Object.assign(globalThis, {
        Uint16Array: counting(real.Uint16Array),
        Int32Array: counting(real.Int32Array),
        Uint8Array: counting(real.Uint8Array),
      });
      try {
        return { compared: diffWords(before, after) !== null, bytes };
      } finally {
        Object.assign(globalThis, real);
      }
    };
    const MB = 1_000_000;
    const original = Array.from({ length: 6000 }, (_, i) => `w${i}`);
    const replaced = (count: number) => original.map((word, i) => (i % 4 === 0 && i / 4 < count ? `x${i}` : word)).join(" ");
    const cases: [string, string, string, boolean][] = [
      // The most that is compared with a table: 2,500 pieces a side, all different.
      ["table, at the limit", `${words("a", 1250)} `, `${words("b", 1250, "  ")}  `, true],
      // The most differences in a longer text.
      ["few changes, at the limit", original.join(" "), replaced(1250), true],
      // Given up on: must not cost more than that either.
      ["few changes, over the limit", original.join(" "), replaced(1500), false],
      ["two different long texts", words("a", 20000), words("b", 20000), false],
      // A 5,000-word text with three changed sentences needs next to nothing.
      ["three sentences", words("w", 5000), words("w", 5000).replace("w10 ", "x ").replace(" w2500 ", " y ").replace(" w4990", " z"), true],
    ];
    const used: Record<string, number> = {};
    for (const [name, before, after, compared] of cases) {
      const result = measure(before, after);
      expect([name, result.compared]).toEqual([name, compared]);
      used[name] = result.bytes;
      expect(result.bytes).toBeLessThan(15 * MB);
    }
    // The counting works (the two big cases really are big), and the small one is small.
    expect(used["table, at the limit"]).toBeGreaterThan(12 * MB);
    expect(used["few changes, at the limit"]).toBeGreaterThan(12 * MB);
    expect(used["three sentences"]).toBeLessThan(MB / 4);
  });

  it("finds the fewest changes in a long text, the same number the table finds in a short one", () => {
    const roll = dice(20261112);
    // Few different words, so the same word turns up again and again.
    const vocabulary = ["the", "store", "opens", "at", "nine", "and", "closes", "six", "on", "weekdays", "only"];
    const gaps = [" ", " ", " ", "\n", "  "];
    const filler = words("filler", 1400);
    for (let round = 0; round < 60; round += 1) {
      const length = 20 + roll(60);
      const beforeWords = Array.from({ length }, () => vocabulary[roll(vocabulary.length)]);
      const afterWords = [...beforeWords];
      for (let edits = roll(12); edits > 0; edits -= 1) {
        const at = roll(afterWords.length + 1);
        const kind = roll(3);
        if (kind === 0) afterWords.splice(at, 0, vocabulary[roll(vocabulary.length)]);
        else if (kind === 1) afterWords.splice(at, 1);
        else afterWords.splice(at, 1, vocabulary[roll(vocabulary.length)]);
      }
      const join = (list: string[]) => list.map((word, i) => (i === 0 ? word : gaps[(i * 7 + word.length) % gaps.length] + word)).join("");
      const before = join(beforeWords);
      const after = join(afterWords);
      // Short: compared with the table.
      const short = expectExact(diffWords(before, after), before, after);
      // The same two texts after a long stretch that is the same on both
      // sides, with one more difference in front of it: too much is left for
      // the table, so the other method is used. It must find exactly as few
      // changes (the two extra pieces are the word in front).
      const longBefore = `first ${filler}\n${before}`;
      const longAfter = `changed ${filler}\n${after}`;
      const long = expectExact(diffWords(longBefore, longAfter), longBefore, longAfter);
      expect([round, piecesChanged(long)]).toEqual([round, piecesChanged(short) + 2]);
    }
  });
});

describe("comparing two versions of official text", () => {
  const p = (text: string, ...marks: { type: string; attrs?: Record<string, unknown> }[]): RichNode => ({
    type: "paragraph",
    content: [{ type: "text", text, ...(marks.length > 0 ? { marks } : {}) }],
  });
  const d = (...content: RichNode[]): RichDoc => sanitizeDoc({ type: "doc", content });
  const link = (href: string) => ({ type: "link", attrs: { href } });
  const tasks = (...items: [boolean, string][]): RichNode => ({
    type: "taskList",
    content: items.map(([checked, text]) => ({ type: "taskItem", attrs: { checked }, content: [p(text)] })),
  });
  const cell = (text: string): RichNode => ({ type: "tableCell", content: [p(text)] });
  const row = (...cells: string[]): RichNode => ({ type: "tableRow", content: cells.map(cell) });
  const onlyLayout = { kind: "formatting", links: false, checks: false };

  it("says nothing differs, or only the formatting", () => {
    const plain = d(p("Starting wage: $15.00/hr."));
    expect(compareDocs(plain, plain)).toEqual({ kind: "same" });
    expect(compareDocs(plain, d(p("Starting wage: $15.00/hr.", { type: "bold" })))).toEqual(onlyLayout);
    expect(compareDocs(d(p("Open")), d({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Open" }] }))).toEqual(onlyLayout);
    // A numbered list that now starts at 5.
    const list = (start: number): RichNode => ({ type: "orderedList", attrs: { start }, content: [{ type: "listItem", content: [p("Open")] }] });
    expect(compareDocs(d(list(1)), d(list(5)))).toEqual(onlyLayout);
    expect(compareDocs(null, d({ type: "paragraph" }))).toEqual({ kind: "same" });
    expect(compareDocs(null, d(p("   ")))).toEqual({ kind: "same" });
  });

  it("says when a link's address was added, removed or changed, although the words are the same", () => {
    const to = (href: string) => d(p("Order form", link(href)));
    expect(compareDocs(to("https://vendor-a.example.com/order"), to("https://vendor-b.example.com/order"))).toEqual({
      kind: "formatting",
      links: true,
      checks: false,
    });
    expect(compareDocs(to("https://vendor-a.example.com/order"), to("https://vendor-a.example.com/order"))).toEqual({ kind: "same" });
    // Added, and removed.
    expect(compareDocs(d(p("Order form")), to("https://vendor-a.example.com/order"))).toMatchObject({ links: true, checks: false });
    expect(compareDocs(to("https://vendor-a.example.com/order"), d(p("Order form")))).toMatchObject({ links: true, checks: false });
    // The same address on other words.
    const onFirst = d({ type: "paragraph", content: [{ type: "text", text: "Order", marks: [link("https://example.com/")] }, { type: "text", text: " form" }] });
    const onSecond = d({ type: "paragraph", content: [{ type: "text", text: "Order " }, { type: "text", text: "form", marks: [link("https://example.com/")] }] });
    expect(compareDocs(onFirst, onSecond)).toMatchObject({ kind: "formatting", links: true });
    // The same link, cut up differently or made bold as well: only formatting.
    const inTwo = d({
      type: "paragraph",
      content: [
        { type: "text", text: "Order ", marks: [link("https://example.com/")] },
        { type: "text", text: "form", marks: [{ type: "bold" }, link("https://example.com/")] },
      ],
    });
    expect(compareDocs(d(p("Order form", link("https://example.com/"))), inTwo)).toEqual(onlyLayout);
    // A link changed and the paragraph split in two at once.
    expect(
      compareDocs(d(p("Order form. Call first.", link("https://example.com/a"))), d(p("Order form.", link("https://example.com/b")), p("Call first."))),
    ).toEqual({ kind: "formatting", links: true, checks: false });
  });

  it("says when a checkbox was ticked or unticked, although the words are the same", () => {
    const list = (...ticks: boolean[]) => d(tasks(...ticks.map((t, i): [boolean, string] => [t, ["Lock the back door", "Count the till", "Lights off"][i]])));
    expect(compareDocs(list(false, false, false), list(false, true, false))).toEqual({ kind: "formatting", links: false, checks: true });
    expect(compareDocs(list(true, true, false), list(true, false, false))).toEqual({ kind: "formatting", links: false, checks: true });
    // As many ticks as before, on other lines.
    expect(compareDocs(list(true, false, false), list(false, true, false))).toMatchObject({ checks: true });
    expect(compareDocs(list(true, false, true), list(true, false, true))).toEqual({ kind: "same" });
    // Plain lines made into a checklist with nothing ticked: layout. With one ticked: more than layout.
    const plain = d(p("Lock the back door"), p("Count the till"), p("Lights off"));
    expect(compareDocs(plain, list(false, false, false))).toEqual(onlyLayout);
    expect(compareDocs(plain, list(false, false, true))).toMatchObject({ kind: "formatting", checks: true });
    expect(compareDocs(list(true, false, false), plain)).toMatchObject({ kind: "formatting", checks: true });
    // Both at once.
    expect(
      compareDocs(d(tasks([false, "Lock up"]), p("Form", link("https://example.com/a"))), d(tasks([true, "Lock up"]), p("Form", link("https://example.com/b")))),
    ).toEqual({ kind: "formatting", links: true, checks: true });
  });

  it("calls it formatting when only the spaces and line breaks between the words differ", () => {
    // One paragraph split in two.
    expect(compareDocs(d(p("Starting wage is $15. Reviewed yearly.")), d(p("Starting wage is $15."), p("Reviewed yearly.")))).toEqual(onlyLayout);
    // A table of two rows laid out as one row.
    expect(
      compareDocs(
        d({ type: "table", content: [row("Garden Center", "$15"), row("Coffee Shop", "$13")] }),
        d({ type: "table", content: [row("Garden Center", "$15", "Coffee Shop", "$13")] }),
      ),
    ).toEqual(onlyLayout);
    expect(compareDocs(d(p("Open 9  to 6.")), d(p("Open 9 to 6.")))).toEqual(onlyLayout);
    expect(compareDocs(d(p("A"), p("B")), d(p("A"), { type: "paragraph" }, { type: "paragraph" }, p("B")))).toEqual(onlyLayout);
    // Two words run together, or one cut in two, is a change of words.
    expect(compareDocs(d(p("Lock the back door")), d(p("Lock the backdoor")))).toMatchObject({ kind: "words" });
    expect(compareDocs(d(p("Lock the backdoor")), d(p("Lock the back door")))).toMatchObject({ kind: "words" });
    // The same words in another order are not the same words.
    expect(compareDocs(d({ type: "table", content: [row("$15", "$13")] }), d({ type: "table", content: [row("$13", "$15")] }))).toMatchObject({ kind: "words" });
  });

  it("marks the words when words changed, whatever else did", () => {
    const plain = d(p("Starting wage: $15.00/hr."));
    expect(compareDocs(null, plain)).toEqual({ kind: "words", parts: [{ kind: "added", text: "Starting wage: $15.00/hr." }] });
    expect(compareDocs(plain, d(p("Starting wage: $16.00/hr.", link("https://example.com/"))))).toEqual({
      kind: "words",
      parts: [
        { kind: "same", text: "Starting wage: " },
        { kind: "removed", text: "$15.00/hr." },
        { kind: "added", text: "$16.00/hr." },
      ],
    });
    expect(compareDocs(plain, d(p(words("w", 3000))))).toEqual({ kind: "tooLong" });
    // A long text with one changed word is compared.
    const long = words("w", 5000);
    expect(compareDocs(d(p(long)), d(p(long.replace(" w2500 ", " changed "))))).toEqual({
      kind: "words",
      parts: [
        { kind: "same", text: `${words("w", 2500)} ` },
        { kind: "removed", text: "w2500" },
        { kind: "added", text: "changed" },
        { kind: "same", text: ` ${Array.from({ length: 2499 }, (_, i) => `w${i + 2501}`).join(" ")}` },
      ],
    });
  });
});
