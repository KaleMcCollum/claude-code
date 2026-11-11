/**
 * People's names: how they are tidied, compared and checked.
 *
 * A name is what everyone reads next to "Approved by", so two people must
 * never have names that look the same. Some characters draw nothing at all
 * on a screen (a zero-width space, a soft hyphen, a direction mark ...), and
 * a name with one of them in it looks exactly like the name without it. Such
 * characters are refused in a name, and left out when two names are compared.
 *
 * The database has the same list (`unseen_characters()` in
 * drizzle/0011_decisions_review_security.sql) and the same way of comparing
 * (`user_name_key`). tests/names.test.ts checks that the two agree.
 *
 * This does not catch letters that merely look alike (a capital I for a
 * small l, or a letter from another alphabet). Nothing short of a person
 * looking can.
 */

type Range = readonly [first: number, last: number];

/**
 * Characters that draw nothing: control characters, soft hyphen, zero-width
 * and joiner characters, direction marks, variation selectors, blank fillers
 * and the like. (Tab and the line-break characters are listed separately
 * below, because where names are compared they count as spaces.)
 */
export const UNSEEN_RANGES: readonly Range[] = [
  [0x0001, 0x0008],
  [0x000e, 0x001f],
  [0x007f, 0x0084],
  [0x0086, 0x009f],
  [0x00ad, 0x00ad], // soft hyphen
  [0x034f, 0x034f], // combining grapheme joiner
  [0x061c, 0x061c], // Arabic letter mark
  [0x115f, 0x1160], // Hangul fillers
  [0x17b4, 0x17b5], // Khmer inherent vowels
  [0x180b, 0x180f], // Mongolian variation selectors and vowel separator
  [0x200b, 0x200f], // zero-width space, non-joiner, joiner, direction marks
  [0x202a, 0x202e], // direction embeddings and overrides
  [0x2060, 0x206f], // word joiner, invisible operators, direction isolates
  [0x2800, 0x2800], // Braille blank
  [0x3164, 0x3164], // Hangul filler
  [0xfe00, 0xfe0f], // variation selectors
  [0xfeff, 0xfeff], // zero-width no-break space
  [0xffa0, 0xffa0], // half-width Hangul filler
  [0xfff0, 0xfffb], // interlinear annotation marks
  [0x1bca0, 0x1bca3], // shorthand format controls
  [0x1d173, 0x1d17a], // musical format controls
  [0xe0000, 0xe0fff], // tags and more variation selectors
];

/** Tab and the line-break characters. Compared as spaces; never stored in a name. */
export const LINE_BREAK_RANGES: readonly Range[] = [
  [0x0000, 0x0000],
  [0x0009, 0x000d],
  [0x0085, 0x0085],
  [0x2028, 0x2029],
];

const inRanges = (ranges: readonly Range[], codePoint: number) =>
  ranges.some(([first, last]) => codePoint >= first && codePoint <= last);

function leaveOut(text: string, ranges: readonly Range[]): string {
  let kept = "";
  for (const character of text) {
    if (!inRanges(ranges, character.codePointAt(0)!)) kept += character;
  }
  return kept;
}

/** A name as it is stored: a run of spaces, tabs or line breaks becomes one space, none at the ends. */
export function tidyPersonName(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

/**
 * True when a name has a character in it that cannot be seen, or a tab or
 * line break. Such a name cannot be stored (the database refuses it too).
 */
export function hasUnseenCharacter(name: string): boolean {
  for (const character of name) {
    const codePoint = character.codePointAt(0)!;
    if (inRanges(UNSEEN_RANGES, codePoint) || inRanges(LINE_BREAK_RANGES, codePoint)) return true;
  }
  return false;
}

/** What the person adding a name is told when it has such a character in it. */
export const UNSEEN_CHARACTER_MESSAGE =
  "That name has a character in it that cannot be seen (it may have come along when the name was pasted). Type the name by hand.";

/**
 * What two names are compared by, the same way the database's
 * `user_name_key` does it: one standard form of each character (so
 * full-width letters and no-break spaces count as the plain ones),
 * characters that draw nothing left out, a run of spaces counted as one,
 * capitals not counted. Two names with the same key are the same name.
 */
export function personNameKey(name: string): string {
  return leaveOut(name.normalize("NFKC"), UNSEEN_RANGES)
    .replace(/[\s\u0085]+/g, " ")
    .replace(/^ +| +$/g, "")
    .toLowerCase();
}
