import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { asSystem } from "@/db/client";
import { users } from "@/db/schema";
import { parseSeedOwners } from "@/db/seed";
import {
  COMPARED_AS_SPACE_RANGES,
  LINE_BREAK_RANGES,
  UNSEEN_CHARACTER_MESSAGE,
  UNSEEN_RANGES,
  hasUnseenCharacter,
  personNameKey,
  tidyPersonName,
} from "@/lib/names";
import { addUser } from "@/lib/users";
import { actorFor, fakeMailer, refusal, withTestDatabase } from "./helpers/db";

withTestDatabase();

/**
 * People's names are what everyone reads next to "Approved by". A name that
 * only looks the same as someone else's (because it has a character in it
 * that draws nothing, or is written in another form of the same letters)
 * must count as the same name, in the app and in the database alike.
 *
 * Every unusual character in this file is made from its number, never
 * typed, so that nothing in here is invisible.
 */

const ch = (...codePoints: number[]) => String.fromCodePoint(...codePoints);
const ZERO_WIDTH_SPACE = ch(0x200b);
const ZERO_WIDTH_JOINER = ch(0x200d);
const SOFT_HYPHEN = ch(0x00ad);
const WORD_JOINER = ch(0x2060);
const GRAPHEME_JOINER = ch(0x034f);
const LEFT_TO_RIGHT_MARK = ch(0x200e);
const ZERO_WIDTH_NO_BREAK_SPACE = ch(0xfeff);
const VARIATION_SELECTOR = ch(0xfe0f);
const BELL = ch(0x0007);
const TAB = ch(0x0009);
const LINE_BREAK = ch(0x000a);
const NEXT_LINE = ch(0x0085);
const NO_BREAK_SPACE = ch(0x00a0);
const EM_SPACE = ch(0x2003);
const IDEOGRAPHIC_SPACE = ch(0x3000);
const OGHAM_SPACE = ch(0x1680);
const LINE_SEPARATOR = ch(0x2028);
const PARAGRAPH_SEPARATOR = ch(0x2029);
/** "Casey" in full-width letters. */
const FULL_WIDTH_CASEY = ch(0xff23, 0xff41, 0xff53, 0xff45, 0xff59);
const E_ACUTE = ch(0x00e9);
const CAPITAL_E_ACUTE = ch(0x00c9);
const COMBINING_ACUTE = ch(0x0301);
/** The single character for "fi" joined together. */
const FI_LIGATURE = ch(0xfb01);

function rows<T>(result: unknown): T[] {
  return (Array.isArray(result) ? result : (result as { rows: T[] }).rows) as T[];
}
const inUnseenRanges = (codePoint: number) => UNSEEN_RANGES.some(([first, last]) => codePoint >= first && codePoint <= last);
/** What the database makes of a name: how it compares it, and whether it would refuse to store it. */
async function inDatabase(name: string): Promise<{ key: string; unseen: boolean; refused: boolean }> {
  const result = await asSystem((db) =>
    db.execute(sql`
      select public.user_name_key(${name}) as key,
             ${name} ~ ('[' || public.unseen_characters() || ']') as unseen,
             ${name} ~ ('[\\u0009-\\u000D\\u0085\\u2028\\u2029' || public.unseen_characters() || ']') as refused
    `),
  );
  return rows<{ key: string; unseen: boolean; refused: boolean }>(result)[0];
}

describe("the app and the database agree on names", () => {
  it("have the same list of characters that cannot be seen", async () => {
    // The database writes the list as the inside of a search pattern: each
    // character as its number (\u and four digits, or \U and eight), a
    // range as first-last.
    const number = (codePoint: number) =>
      codePoint <= 0xffff
        ? `\\u${codePoint.toString(16).toUpperCase().padStart(4, "0")}`
        : `\\U${codePoint.toString(16).toUpperCase().padStart(8, "0")}`;
    const expected = UNSEEN_RANGES.map(([first, last]) => (first === last ? number(first) : `${number(first)}-${number(last)}`)).join("");
    const result = await asSystem((db) => db.execute(sql`select public.unseen_characters() as list`));
    expect(rows<{ list: string }>(result)[0].list).toBe(expected);
  });

  it("treat the first and last character of every range, and the ones just outside, the same way", async () => {
    const edges = new Set<number>();
    for (const [first, last] of [...UNSEEN_RANGES, ...LINE_BREAK_RANGES, ...COMPARED_AS_SPACE_RANGES]) {
      for (const codePoint of [first - 1, first, last, last + 1]) {
        // (The database cannot store character 0 at all.)
        if (codePoint > 0) edges.add(codePoint);
      }
    }
    expect(edges.size).toBeGreaterThan(80);
    for (const codePoint of edges) {
      const name = `Ca${ch(codePoint)}sey`;
      const database = await inDatabase(name);
      const where = `character number ${codePoint.toString(16)}`;
      expect(database.unseen, where).toBe(inUnseenRanges(codePoint));
      expect(database.refused, where).toBe(hasUnseenCharacter(name));
      expect(database.key, where).toBe(personNameKey(name));
      // A character that cannot be seen leaves the name as it was.
      if (inUnseenRanges(codePoint)) expect(database.key, where).toBe("casey");
    }
  });

  it("compare two names the same way", async () => {
    const sameAsCasey = [
      "Casey",
      "  cAsEy ",
      "CASEY",
      FULL_WIDTH_CASEY,
      `Casey${NO_BREAK_SPACE}`,
      `${EM_SPACE}Casey${IDEOGRAPHIC_SPACE}`,
      `Casey${ZERO_WIDTH_SPACE}`,
      `Ca${ZERO_WIDTH_JOINER}sey`,
      `Ca${SOFT_HYPHEN}sey`,
      `Casey${WORD_JOINER}`,
      `Casey${GRAPHEME_JOINER}`,
      `${LEFT_TO_RIGHT_MARK}Casey`,
      `${ZERO_WIDTH_NO_BREAK_SPACE}Casey${VARIATION_SELECTOR}`,
      `Ca${BELL}sey`,
      `${TAB}Casey${LINE_BREAK}`,
    ];
    for (const name of sameAsCasey) {
      expect(personNameKey(name)).toBe("casey");
      expect((await inDatabase(name)).key).toBe("casey");
    }
    const sameAsMaryAnn = [
      "Mary Ann",
      "mary   ann",
      `Mary${TAB}Ann`,
      `Mary${LINE_BREAK}Ann`,
      `Mary${NEXT_LINE}Ann`,
      `Mary${NO_BREAK_SPACE}Ann`,
      `Mary${EM_SPACE}${EM_SPACE}Ann`,
      `Mary${OGHAM_SPACE}Ann`,
      `Mary${LINE_SEPARATOR}${PARAGRAPH_SEPARATOR}Ann`,
      `Mary ${ZERO_WIDTH_SPACE} Ann`,
    ];
    for (const name of sameAsMaryAnn) {
      expect(personNameKey(name)).toBe("mary ann");
      expect((await inDatabase(name)).key).toBe("mary ann");
    }
    // Letters with marks, written as one character or as two, and joined letters.
    const jose = `jos${E_ACUTE}`;
    for (const name of [`Jos${E_ACUTE}`, `JOS${CAPITAL_E_ACUTE}`, `Jose${COMBINING_ACUTE}`]) {
      expect(personNameKey(name)).toBe(jose);
      expect((await inDatabase(name)).key).toBe(jose);
    }
    expect(personNameKey(`${FI_LIGATURE}ona`)).toBe("fiona");
    expect((await inDatabase(`${FI_LIGATURE}ona`)).key).toBe("fiona");
    // Different names stay different.
    for (const name of ["Casey B", "Casey.", "Maryann", "Jose"]) {
      expect(["casey", "mary ann", jose]).not.toContain(personNameKey(name));
      expect((await inDatabase(name)).key).toBe(personNameKey(name));
    }
  });
});

describe("a name as it is typed", () => {
  it("is tidied: spaces of any kind, tabs and line breaks become one space", () => {
    expect(tidyPersonName(`  Mary${TAB}${NO_BREAK_SPACE} Ann${LINE_BREAK}`)).toBe("Mary Ann");
    expect(tidyPersonName(`Mary${EM_SPACE}Ann${IDEOGRAPHIC_SPACE}`)).toBe("Mary Ann");
    expect(tidyPersonName(`Mary${NEXT_LINE}Ann`)).toBe("Mary Ann");
    expect(tidyPersonName("   ")).toBe("");
    // What cannot be seen is not tidied away: it is refused, so the person knows.
    expect(tidyPersonName(`Casey${ZERO_WIDTH_NO_BREAK_SPACE}`)).toBe(`Casey${ZERO_WIDTH_NO_BREAK_SPACE}`);
    expect(hasUnseenCharacter(`Casey${ZERO_WIDTH_NO_BREAK_SPACE}`)).toBe(true);
    expect(hasUnseenCharacter(`Ca${SOFT_HYPHEN}sey`)).toBe(true);
    expect(hasUnseenCharacter(`Casey${TAB}B`)).toBe(true);
    expect(hasUnseenCharacter(`Mary-Ann O'Neil ${E_ACUTE}`)).toBe(false);
  });

  it("is refused when it has a character in it that cannot be seen, and compared in its plain form", async () => {
    const kale = await actorFor("kale@example.com");
    const mail = fakeMailer();
    const options = { baseUrl: "https://manual.example.com", send: mail.send };
    let n = 0;
    const add = (name: string) => {
      n += 1;
      return addUser(kale, { name, email: `second${n}@example.com`, roleKey: "owner" }, options);
    };
    // A second "Casey" that only looks the same.
    for (const name of [
      `Casey${ZERO_WIDTH_SPACE}`,
      `Ca${ZERO_WIDTH_JOINER}sey`,
      `Ca${SOFT_HYPHEN}sey`,
      `Casey${WORD_JOINER}`,
      `Casey${GRAPHEME_JOINER}`,
      `${LEFT_TO_RIGHT_MARK}Casey`,
      `Casey${ZERO_WIDTH_NO_BREAK_SPACE}`,
      `Casey${VARIATION_SELECTOR}`,
      `Ca${BELL}sey`,
      // Not only when it would look like someone else's name.
      `Robin${ZERO_WIDTH_SPACE}`,
    ]) {
      await expect(add(name)).rejects.toThrow(UNSEEN_CHARACTER_MESSAGE);
    }
    expect(UNSEEN_CHARACTER_MESSAGE).toBe(
      "That name has a character in it that cannot be seen (it may have come along when the name was pasted). Type the name by hand.",
    );
    // The same letters in another form, or with another kind of space.
    for (const name of [FULL_WIDTH_CASEY, `Casey${NO_BREAK_SPACE}`, `${IDEOGRAPHIC_SPACE}casey`]) {
      await expect(add(name)).rejects.toThrow("Someone here is already called Casey. Add a last initial so the two can be told apart.");
    }
    expect(mail.sent).toHaveLength(0);
    expect((await asSystem((db) => db.select().from(users))).map((u) => u.name).sort()).toEqual(["Casey", "Kale"]);
    // An ordinary name with a mark, an apostrophe and a hyphen is fine.
    await add(`Jos${E_ACUTE} O'Neil-Smith`);
    expect(mail.sent).toHaveLength(1);
  });
});

describe("database rules: names", () => {
  const add = (name: string, email: string) => asSystem((db) => db.insert(users).values({ name, email, roleKey: "advisor" }).returning());
  const CANNOT_BE_SEEN = /^23514: [\s\S]*users_name_can_be_seen/;
  const SAME_NAME = /^23505: [\s\S]*users_name_unique/;

  it("a name with a character that cannot be seen, a tab or a line break cannot be stored", async () => {
    for (const name of [
      `Casey${ZERO_WIDTH_SPACE}`,
      `Ca${SOFT_HYPHEN}sey`,
      `Casey${WORD_JOINER}`,
      `${LEFT_TO_RIGHT_MARK}Robin`,
      `Robin${ZERO_WIDTH_NO_BREAK_SPACE}`,
      `Ro${BELL}bin`,
      `Robin${TAB}B`,
      `Robin${LINE_BREAK}B`,
      `Robin${NEXT_LINE}B`,
      `Robin${LINE_SEPARATOR}B`,
    ]) {
      expect(await refusal(add(name, "robin@example.com"))).toMatch(CANNOT_BE_SEEN);
    }
    // And an existing name cannot be changed into one.
    expect(
      await refusal(asSystem((db) => db.update(users).set({ name: `Kale${ZERO_WIDTH_SPACE}` }).where(eq(users.email, "kale@example.com")))),
    ).toMatch(CANNOT_BE_SEEN);
    expect(await add(`Robin O'Neil-Smith ${E_ACUTE}`, "robin@example.com")).toHaveLength(1);
  });

  it("the same name in another form is still the same name", async () => {
    expect(await refusal(add(FULL_WIDTH_CASEY, "casey.two@example.com"))).toMatch(SAME_NAME);
    expect(await refusal(add(`Casey${NO_BREAK_SPACE}`, "casey.two@example.com"))).toMatch(SAME_NAME);
    expect(await refusal(add(`KALE${EM_SPACE}`, "kale.two@example.com"))).toMatch(SAME_NAME);
  });
});

describe("the starting Owners", () => {
  it("cannot be two people with the same name, or the same email address", () => {
    // The same name in other capitals.
    expect(() => parseSeedOwners("Kale <kale@example.com>, kale <kale2@example.com>")).toThrow(
      'SEED_OWNERS has two starting Owners with the same name (Kale): "Kale <kale@example.com>" and "kale <kale2@example.com>". Give each a different name, like this: Kale <kale@example.com>, Casey <casey@example.com>',
    );
    // Two addresses without a name that begin the same way.
    expect(() => parseSeedOwners("info@gardencenter.example.com, info@coffeeshop.example.com")).toThrow(
      'two starting Owners with the same name (info): "info@gardencenter.example.com" and "info@coffeeshop.example.com"',
    );
    // The same letters in another form, or with another kind of space.
    expect(() => parseSeedOwners(`Casey <casey@example.com>, ${FULL_WIDTH_CASEY} <casey2@example.com>`)).toThrow("with the same name (Casey)");
    expect(() => parseSeedOwners(`Mary Ann <mary@example.com>, mary${NO_BREAK_SPACE}${NO_BREAK_SPACE}ann <mary2@example.com>`)).toThrow(
      "with the same name (Mary Ann)",
    );
    // The same address twice, however it is written.
    expect(() => parseSeedOwners("Kale <kale@example.com>, Casey <Kale@Example.com>")).toThrow(
      'SEED_OWNERS has the same email address twice: "Kale <kale@example.com>" and "Casey <Kale@Example.com>". Each starting Owner needs their own email address.',
    );
    // A name with something in it that cannot be seen.
    expect(() => parseSeedOwners(`Kale <kale@example.com>, Casey${ZERO_WIDTH_SPACE} <casey@example.com>`)).toThrow(
      "SEED_OWNERS has a name with a character in it that cannot be seen",
    );
    // The usual two are fine, and names are tidied the way the app tidies them.
    expect(parseSeedOwners(`Kale <kale@example.com>,  Casey${TAB} B  <casey@example.com>`)).toEqual([
      { name: "Kale", email: "kale@example.com" },
      { name: "Casey B", email: "casey@example.com" },
    ]);
  });
});
