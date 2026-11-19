import { describe, expect, it } from "vitest";
import {
  commentDraftKey,
  newNoteDraftKey,
  newProposalDraftKey,
  noteDraftKey,
  officialDraftKey,
  proposalCommentDraftKey,
  proposalDraftKey,
} from "@/lib/drafts";

/**
 * Text that is typed and not yet saved is kept in the browser, on that
 * device. A copy belongs to the person who typed it: on a shared computer
 * the next person to sign in must never be offered it as their own words.
 * So the signed-in person's id is part of every key the copies are kept under.
 */

const KALE = "11111111-1111-4111-8111-111111111111";
const CASEY = "22222222-2222-4222-8222-222222222222";
const THING = "33333333-3333-4333-8333-333333333333";

/** Every kind of copy the app keeps, for one person and one section, note or proposal. */
const keysFor = (owner: string, thing: string) => [
  officialDraftKey(owner, thing),
  newNoteDraftKey(owner),
  noteDraftKey(owner, thing),
  commentDraftKey(owner, thing),
  newProposalDraftKey(owner, thing),
  proposalDraftKey(owner, thing),
  proposalCommentDraftKey(owner, thing),
];

/** The keys used before a copy knew whose it was. Copies under them are no longer offered to anyone. */
const OLD_KEYS = [
  `ppf:draft:official:${THING}`,
  "ppf:draft:note:new",
  `ppf:draft:note:${THING}`,
  `ppf:draft:comment:${THING}`,
  `ppf:draft:proposal:new:${THING}`,
  `ppf:draft:proposal:${THING}`,
  `ppf:draft:comment:proposal:${THING}`,
];

describe("where unsaved text is kept on a device", () => {
  it("every key names the person who typed it, right after the app's own prefix", () => {
    for (const key of keysFor(KALE, THING)) {
      expect(key.startsWith(`ppf:draft:${KALE}:`)).toBe(true);
    }
  });

  it("two people never share a key, whatever they are typing", () => {
    const kale = keysFor(KALE, THING);
    const casey = keysFor(CASEY, THING);
    expect(new Set([...kale, ...casey]).size).toBe(kale.length + casey.length);
    expect(kale.filter((key) => casey.includes(key))).toEqual([]);
  });

  it("one person's seven kinds of copy are kept apart, and are the same every time", () => {
    expect(new Set(keysFor(KALE, THING)).size).toBe(7);
    expect(keysFor(KALE, THING)).toEqual(keysFor(KALE, THING));
    expect(keysFor(KALE, THING)).toEqual([
      `ppf:draft:${KALE}:official:${THING}`,
      `ppf:draft:${KALE}:note:new`,
      `ppf:draft:${KALE}:note:${THING}`,
      `ppf:draft:${KALE}:comment:${THING}`,
      `ppf:draft:${KALE}:proposal:new:${THING}`,
      `ppf:draft:${KALE}:proposal:${THING}`,
      `ppf:draft:${KALE}:comment:proposal:${THING}`,
    ]);
  });

  it("a copy kept under one of the old keys, which named no person, is not anybody's", () => {
    const now = [...keysFor(KALE, THING), ...keysFor(CASEY, THING)];
    for (const old of OLD_KEYS) expect(now).not.toContain(old);
  });
});
