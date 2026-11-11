import { describe, expect, it } from "vitest";
import { MAX_DIFF_WORDS, diffWords } from "@/lib/diff";

const show = (before: string, after: string) =>
  diffWords(before, after)!
    .map((p) => (p.kind === "same" ? p.text : p.kind === "added" ? `[+${p.text}]` : `[-${p.text}]`))
    .join("");

describe("word-by-word difference", () => {
  it("marks what was removed and what was added, keeping the rest", () => {
    expect(show("Starting wage, Coffee Shop: $13.00/hr.", "Starting wage, Coffee Shop: $15.00/hr.")).toBe(
      "Starting wage, Coffee Shop: [-$13.00/hr.][+$15.00/hr.]",
    );
    expect(show("Open 9 to 6.", "Open 9 to 6. Closed Sundays.")).toBe("Open 9 to 6.[+ Closed Sundays.]");
    expect(show("Closed Sundays and Mondays.", "Closed Mondays.")).toBe("Closed [-Sundays and ]Mondays.");
  });

  it("puts both texts back together exactly", () => {
    const before = "Line one\n\nLine  two with   spaces\tand a tab";
    const after = "Line one\n\nLine two with   spaces and more";
    const parts = diffWords(before, after)!;
    expect(parts.filter((p) => p.kind !== "added").map((p) => p.text).join("")).toBe(before);
    expect(parts.filter((p) => p.kind !== "removed").map((p) => p.text).join("")).toBe(after);
  });

  it("handles empty texts and identical texts", () => {
    expect(diffWords("", "")).toEqual([]);
    expect(diffWords("", "New text.")).toEqual([{ kind: "added", text: "New text." }]);
    expect(diffWords("Old text.", "")).toEqual([{ kind: "removed", text: "Old text." }]);
    expect(diffWords("Same words.", "Same words.")).toEqual([{ kind: "same", text: "Same words." }]);
  });

  it("gives up on very long texts instead of slowing the page down", () => {
    const long = Array.from({ length: MAX_DIFF_WORDS }, (_, i) => `w${i}`).join(" ");
    expect(diffWords(long, "short")).toBeNull();
    expect(diffWords("short", long)).toBeNull();
    const fits = Array.from({ length: 1000 }, (_, i) => `w${i}`).join(" ");
    expect(diffWords(fits, `${fits} more`)?.at(-1)).toEqual({ kind: "added", text: " more" });
  });
});
