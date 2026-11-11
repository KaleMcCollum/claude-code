import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { asSystem } from "@/db/client";
import { sections } from "@/db/schema";
import { addComment, addNote, removeNote, restoreNote, sortNote } from "@/lib/notes";
import { saveOfficial } from "@/lib/official";
import type { RichDoc } from "@/lib/richtext";
import { type SearchFilters, search, searchWords } from "@/lib/search";
import { flattenTree, loadTree } from "@/lib/sections";
import { actorFor, insertUser, withTestDatabase } from "./helpers/db";

withTestDatabase();

const doc = (text: string): RichDoc => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

const tree = () => asSystem((db) => loadTree(db));
const run = (query: string, filters?: SearchFilters) =>
  asSystem(async (db) => search(db, await loadTree(db), query, filters));

async function sectionId(title: string): Promise<string> {
  const node = flattenTree(await tree()).find((n) => n.title === title);
  if (!node) throw new Error(`No section called ${title}`);
  return node.id;
}

beforeAll(async () => {
  const kale = await actorFor("kale@example.com");
  const casey = await actorFor("casey@example.com");
  const karen = await insertUser("Karen", "karen@example.com", "advisor");
  const wages = await sectionId("Wages");
  const pos = await sectionId("Point of Sale");
  const coffee = await sectionId("Coffee Shop");

  await saveOfficial(kale, wages, doc("Starting wage, Coffee Shop: $13.00/hr."));

  const scanners = await addNote(kale, {
    body: doc("We need to figure out what scanners to use for line busters"),
    now: new Date("2026-11-10T16:00:00Z"),
  });
  await sortNote(kale, scanners.id, await tree(), { sectionIds: [pos], businessTag: "garden_center", sorted: true });

  const espresso = await addNote(casey, {
    body: doc("Espresso machine quote came in, scanners not included"),
    now: new Date("2026-11-12T16:00:00Z"),
  });
  await sortNote(casey, espresso.id, await tree(), { sectionIds: [coffee], businessTag: "coffee_shop", sorted: true });

  const wagesNote = await addNote(kale, {
    body: doc("Kale suggests coffee staff at $15/hr"),
    now: new Date("2026-11-14T16:00:00Z"),
  });
  await sortNote(kale, wagesNote.id, await tree(), { sectionIds: [wages], businessTag: "both", sorted: true });
  await addComment(karen, wagesNote.id, doc("Matches what the registers pay. Scanners can wait."));

  await addNote(casey, { body: doc("100% sure about the pylon_sign"), now: new Date("2026-11-15T16:00:00Z") });
  // Decoys: these must NOT be found when searching for the literal text above.
  await addNote(casey, { body: doc("ordered the pylonXsign bracket and 1000 screws"), now: new Date("2026-11-15T17:00:00Z") });
  await addNote(casey, { body: doc("plant list is in C:\\plants\\2027"), now: new Date("2026-11-15T18:00:00Z") });
});

describe("search", () => {
  it("finds notes word for word, newest first, with where they are filed", async () => {
    const results = await run("scanners");
    expect(results.notes.map((n) => `${n.logDate} ${n.authorName}`)).toEqual(["2026-11-12 Casey", "2026-11-10 Kale"]);
    expect(results.notes[1].excerpt).toBe("We need to figure out what scanners to use for line busters");
    expect(results.notes[1].sections.map((s) => `${s.number} ${s.title}`)).toEqual(["6.1 Point of Sale"]);
    expect(results.notes[1].businessTag).toBe("garden_center");
  });

  it("finds comments and points at the note they are on", async () => {
    const results = await run("scanners can wait");
    expect(results.notes).toEqual([]);
    expect(results.comments).toHaveLength(1);
    expect(results.comments[0]).toMatchObject({ authorName: "Karen", logDate: "2026-11-14" });
  });

  it("groups results by type", async () => {
    const results = await run("coffee");
    expect(results.sections.map((s) => s.title)).toEqual(["Coffee Shop", "Coffee Equipment"]);
    expect(results.official.map((s) => s.title)).toEqual(["Wages"]);
    expect(results.notes.map((n) => n.excerpt)).toEqual(["Kale suggests coffee staff at $15/hr"]);
  });

  it("matches every word in any order, not only the exact phrase", async () => {
    expect((await run("scanner line buster")).notes.map((n) => n.authorName)).toEqual(["Kale"]);
    expect((await run("busters   scanners")).notes.map((n) => n.authorName)).toEqual(["Kale"]);
    expect((await run("staff coffee")).notes.map((n) => n.excerpt)).toEqual(["Kale suggests coffee staff at $15/hr"]);
    // Every word has to be there.
    expect((await run("scanners espresso")).notes.map((n) => n.authorName)).toEqual(["Casey"]);
    expect((await run("scanners giraffe")).notes).toEqual([]);
    expect((await run("shop coffee")).sections.map((s) => s.title)).toEqual(["Coffee Shop"]);
    expect(searchWords("  Coffee   coffee SHOP ")).toEqual(["coffee", "shop"]);
    expect(searchWords("a")).toEqual([]);
  });

  it("is not case sensitive and treats symbols as plain text", async () => {
    expect((await run("SCANNERS")).notes).toHaveLength(2);
    // "%" and "_" mean themselves, not "anything": the decoy notes with
    // "1000" and "pylonXsign" must not match.
    expect((await run("100%")).notes.map((n) => n.excerpt)).toEqual(["100% sure about the pylon_sign"]);
    expect((await run("pylon_sign")).notes.map((n) => n.excerpt)).toEqual(["100% sure about the pylon_sign"]);
    expect((await run("pylonXsign")).notes).toHaveLength(1);
    expect((await run("%%")).notes).toHaveLength(0);
    expect((await run("__")).notes).toHaveLength(0);
    // A backslash is found as typed and does not break the search.
    expect((await run("C:\\plants")).notes.map((n) => n.excerpt)).toEqual(["plant list is in C:\\plants\\2027"]);
    expect((await run("plants\\")).notes).toHaveLength(1);
    expect((await run("\\screws")).notes).toHaveLength(0);
    expect(await run("s")).toEqual({ sections: [], official: [], notes: [], comments: [], moreNotes: false, moreComments: false });
  });

  it("filters by date range (Central days)", async () => {
    expect((await run("scanners", { from: "2026-11-11" })).notes.map((n) => n.logDate)).toEqual(["2026-11-12"]);
    expect((await run("scanners", { to: "2026-11-10" })).notes.map((n) => n.logDate)).toEqual(["2026-11-10"]);
    expect((await run("scanners", { from: "2026-11-10", to: "2026-11-12" })).notes).toHaveLength(2);
    expect((await run("scanners", { from: "2026-11-13" })).notes).toEqual([]);
    // Dated filters leave out section names, which have no date.
    expect((await run("coffee", { from: "2026-01-01" })).sections).toEqual([]);
  });

  it("filters by section, including its subsections", async () => {
    const pos = await sectionId("Point of Sale");
    const equipment = await sectionId("Equipment and Technology");
    const departments = await sectionId("Departments");
    expect((await run("scanners", { sectionId: pos })).notes.map((n) => n.authorName)).toEqual(["Kale"]);
    expect((await run("scanners", { sectionId: equipment })).notes.map((n) => n.authorName)).toEqual(["Kale"]);
    expect((await run("scanners", { sectionId: departments })).notes.map((n) => n.authorName)).toEqual(["Casey"]);
    expect((await run("coffee", { sectionId: departments })).sections.map((s) => s.title)).toEqual(["Coffee Shop"]);
    expect((await run("coffee", { sectionId: departments })).official).toEqual([]);
    const people = await sectionId("People");
    expect((await run("coffee", { sectionId: people })).official.map((s) => s.title)).toEqual(["Wages"]);
    expect((await run("scanners can wait", { sectionId: people })).comments).toHaveLength(1);
    expect((await run("scanners can wait", { sectionId: pos })).comments).toEqual([]);
    expect(await run("scanners", { sectionId: "00000000-0000-4000-8000-000000000000" })).toEqual({
      sections: [],
      official: [],
      notes: [],
      comments: [],
      moreNotes: false,
      moreComments: false,
    });
  });

  it("filters by business, where Both counts for each", async () => {
    expect((await run("scanners", { business: "garden_center" })).notes.map((n) => n.authorName)).toEqual(["Kale"]);
    expect((await run("scanners", { business: "coffee_shop" })).notes.map((n) => n.authorName)).toEqual(["Casey"]);
    expect((await run("coffee staff", { business: "garden_center" })).notes).toHaveLength(1);
    expect((await run("coffee staff", { business: "coffee_shop" })).notes).toHaveLength(1);
    // Untagged notes and untagged kinds of result drop out under a business filter.
    expect((await run("pylon", { business: "garden_center" })).notes).toEqual([]);
    expect((await run("coffee", { business: "coffee_shop" })).official).toEqual([]);
    expect((await run("coffee", { business: "coffee_shop" })).sections).toEqual([]);
  });

  it("filters by author", async () => {
    const casey = await actorFor("casey@example.com");
    const karen = await actorFor("karen@example.com");
    const kale = await actorFor("kale@example.com");
    expect((await run("scanners", { authorId: casey.id })).notes.map((n) => n.authorName)).toEqual(["Casey"]);
    expect((await run("scanners", { authorId: karen.id })).notes).toEqual([]);
    expect((await run("scanners", { authorId: karen.id })).comments).toHaveLength(1);
    expect((await run("coffee", { authorId: kale.id })).official.map((s) => s.title)).toEqual(["Wages"]);
    expect((await run("coffee", { authorId: casey.id })).official).toEqual([]);
  });

  it("under a section filter, leaves out a note that was taken out of that section", async () => {
    const casey = await actorFor("casey@example.com");
    const coffee = await sectionId("Coffee Shop");
    const wages = await sectionId("Wages");
    const [espresso] = (await run("espresso", { sectionId: coffee })).notes;
    expect(espresso).toBeDefined();
    await sortNote(casey, espresso.noteId, await tree(), { sectionIds: [wages], businessTag: "coffee_shop", sorted: true });
    expect((await run("espresso", { sectionId: coffee })).notes).toEqual([]);
    expect((await run("espresso", { sectionId: wages })).notes).toHaveLength(1);
    await sortNote(casey, espresso.noteId, await tree(), { sectionIds: [coffee], businessTag: "coffee_shop", sorted: true });
    expect((await run("espresso", { sectionId: coffee })).notes).toHaveLength(1);
  });

  it("does not find removed notes, or comments on them", async () => {
    const kale = await actorFor("kale@example.com");
    const [hit] = (await run("coffee staff")).notes;
    await removeNote(kale, hit.noteId);
    expect((await run("coffee staff")).notes).toEqual([]);
    expect((await run("scanners can wait")).comments).toEqual([]);
    await restoreNote(kale, hit.noteId);
    expect((await run("coffee staff")).notes).toHaveLength(1);
    expect((await run("scanners can wait")).comments).toHaveLength(1);
  });

  it("leaves out notes filed only under an archived section when filtering by section", async () => {
    const pos = await sectionId("Point of Sale");
    const equipment = await sectionId("Equipment and Technology");
    await asSystem((db) => db.update(sections).set({ archivedAt: new Date() }).where(eq(sections.id, pos)));
    expect((await run("scanners", { sectionId: equipment })).notes).toEqual([]);
    // The note itself is still found without a section filter.
    const found = (await run("line busters")).notes;
    expect(found).toHaveLength(1);
    expect(found[0].sections).toEqual([{ id: pos, number: null, title: "Point of Sale", byAi: false }]);
  });
});

describe("search with very many matches", () => {
  it("shows the newest 50 notes and says there are more", async () => {
    const kale = await actorFor("kale@example.com");
    for (let i = 0; i < 52; i += 1) {
      await addNote(kale, { body: doc(`zebragrass order line ${i}`), now: new Date(Date.UTC(2026, 10, 16, 15, 0, i)) });
    }
    const results = await run("zebragrass");
    expect(results.notes).toHaveLength(50);
    expect(results.moreNotes).toBe(true);
    expect(results.notes[0].excerpt).toBe("zebragrass order line 51");
    expect((await run("zebragrass line 7")).moreNotes).toBe(false);
  });
});
