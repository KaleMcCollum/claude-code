import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { asSystem } from "@/db/client";
import { officialVersions, sections } from "@/db/schema";
import { addComment, addNote, removeNote, restoreNote, sortNote } from "@/lib/notes";
import { saveOfficial } from "@/lib/official";
import {
  addProposalComment,
  approveAlone,
  approveProposal,
  createProposal,
  declineProposal,
  displayTitle,
  proposalsForNotes,
  withdrawProposal,
} from "@/lib/proposals";
import type { RichDoc } from "@/lib/richtext";
import { type SearchFilters, search, searchWords } from "@/lib/search";
import { archiveSection, createSection, flattenTree, loadTree, renameSection } from "@/lib/sections";
import { addDays, centralDateKey } from "@/lib/time";
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
    expect(await run("s")).toEqual({ sections: [], official: [], notes: [], comments: [], proposals: [], moreNotes: false, moreComments: false });
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
      proposals: [],
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

describe("search over proposals", () => {
  beforeAll(async () => {
    const kale = await actorFor("kale@example.com");
    const casey = await actorFor("casey@example.com");
    await createProposal(
      kale,
      {
        kind: "decision",
        sectionId: await sectionId("Wages"),
        title: "Raise the quokka wage",
        description: doc("Karen recommended matching what the wombat registers pay."),
        businessTag: "coffee_shop",
        proposedOfficial: doc("Starting wage, Coffee Shop: $15.00/hr for every quokka."),
      },
      { now: new Date("2026-11-17T16:00:00Z") },
    );
    const winter = await createProposal(
      casey,
      {
        kind: "official_text",
        sectionId: await sectionId("Store Hours"),
        title: "Winter hours",
        proposedOfficial: doc("Open 9 to 5 from December through February (quokka season)."),
      },
      { now: new Date("2026-11-18T16:00:00Z") },
    );
    await declineProposal(kale, winter, "Too early to say");
    await createProposal(
      casey,
      { kind: "structure", change: { action: "add", parentId: await sectionId("Departments"), title: "Quokka Corner" } },
      { now: new Date("2026-11-19T16:00:00Z") },
    );
    // A direct edit is found through the official text, not as a proposal.
    await saveOfficial(kale, await sectionId("Benefits"), doc("Every quokka gets a free coffee per shift."));
  });

  const titles = async (query: string, filters?: SearchFilters) =>
    (await run(query, filters)).proposals.map((p) => p.title);

  it("finds them by title, description and proposed text, newest first, whatever became of them", async () => {
    const found = (await run("quokka")).proposals;
    expect(found.map((p) => [p.title, p.status, p.proposedByName])).toEqual([
      ['Add a section "Quokka Corner" under 4 Departments', "open", "Casey"],
      ["Winter hours", "declined", "Casey"],
      ["Raise the quokka wage", "open", "Kale"],
    ]);
    expect(await titles("wombat registers")).toEqual(["Raise the quokka wage"]);
    expect((await run("wombat")).proposals[0].excerpt).toContain("matching what the wombat registers pay");
    expect(await titles("december february")).toEqual(["Winter hours"]);
    // Words may be spread over the title, the description and the text.
    expect(await titles("raise wombat $15.00/hr")).toEqual(["Raise the quokka wage"]);
    expect(await titles("quokka giraffe")).toEqual([]);
  });

  it("does not list direct edits as proposals", async () => {
    const results = await run("free coffee per shift");
    expect(results.proposals).toEqual([]);
    expect(results.official.map((s) => s.title)).toEqual(["Benefits"]);
    expect(await titles("edited directly")).toEqual([]);
  });

  it("follows the same filters as everything else", async () => {
    const kale = await actorFor("kale@example.com");
    const casey = await actorFor("casey@example.com");
    expect(await titles("quokka", { sectionId: await sectionId("People") })).toEqual(["Raise the quokka wage"]);
    expect(await titles("quokka", { sectionId: await sectionId("Departments") })).toEqual([
      'Add a section "Quokka Corner" under 4 Departments',
    ]);
    expect(await titles("quokka", { sectionId: await sectionId("Finance") })).toEqual([]);
    expect(await titles("quokka", { business: "coffee_shop" })).toEqual(["Raise the quokka wage"]);
    expect(await titles("quokka", { business: "garden_center" })).toEqual([]);
    expect(await titles("quokka", { authorId: kale.id })).toEqual(["Raise the quokka wage"]);
    expect((await titles("quokka", { authorId: casey.id })).length).toBe(2);
    expect(await titles("quokka", { from: "2026-11-18", to: "2026-11-18" })).toEqual(["Winter hours"]);
    expect(await titles("quokka", { to: "2026-11-17" })).toEqual(["Raise the quokka wage"]);
  });
});

describe("search over what was said about a proposal", () => {
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    const kale = await actorFor("kale@example.com");
    const casey = await actorFor("casey@example.com");
    const karen = await actorFor("karen@example.com");
    const all = (await run("quokka")).proposals;
    ids.wage = all.find((p) => p.title === "Raise the quokka wage")!.proposalId;
    ids.winter = all.find((p) => p.title === "Winter hours")!.proposalId;
    // A comment on an open proposal, on a declined one, and on a direct edit.
    ids.onWage = await addProposalComment(karen, ids.wage, doc("Axolotl-striped aprons would cost extra."));
    ids.onWinter = await addProposalComment(casey, ids.winter, doc("Ask the axolotl again in spring."));
    const benefits = await sectionId("Benefits");
    const [direct] = await asSystem((db) => db.select().from(officialVersions).where(eq(officialVersions.sectionId, benefits)));
    ids.direct = direct.proposalId;
    ids.onDirect = await addProposalComment(kale, ids.direct, doc("The axolotl likes this."));
    // And a comment on a note, for comparison.
    const note = await addNote(casey, { body: doc("Aquarium idea for the coffee shop"), now: new Date("2026-11-12T16:00:00Z") });
    await sortNote(casey, note.id, await tree(), { sectionIds: [await sectionId("Coffee Shop")], businessTag: "coffee_shop", sorted: true });
    ids.note = note.id;
    ids.onNote = await addComment(karen, note.id, doc("An axolotl needs cold water."));
    // Proposals that were declined for a reason, withdrawn, and declined without a word.
    ids.okapi = await createProposal(kale, { kind: "decision", sectionId: await sectionId("Vendor Contacts"), title: "Sign with the feed supplier", proposedOfficial: doc("Feed: one supplier.") });
    await declineProposal(casey, ids.okapi, "Okapi prices   first.\n Then decide. ");
    ids.withdrawn = await createProposal(kale, { kind: "decision", sectionId: await sectionId("Vendor Contacts"), title: "Sign with the seed supplier", proposedOfficial: doc("Seed: one supplier.") });
    await withdrawProposal(kale, ids.withdrawn);
    ids.silent = await createProposal(kale, { kind: "decision", sectionId: await sectionId("Vendor Contacts"), title: "Sign with the pot supplier", proposedOfficial: doc("Pots: one supplier.") });
    await declineProposal(casey, ids.silent, "  ");
  });

  const comments = async (query: string, filters?: SearchFilters) =>
    (await run(query, filters)).comments.map((c) => c.commentId).sort();
  const these = (...names: string[]) => names.map((name) => ids[name]).sort();

  it("finds a comment on a proposal and says which proposal it is on", async () => {
    const found = (await run("axolotl")).comments;
    // Newest first.
    expect(found.map((c) => c.commentId)).toEqual([ids.onNote, ids.onDirect, ids.onWinter, ids.onWage]);
    const today = centralDateKey(new Date());
    expect(found.map((c) => [c.authorName, c.noteId, c.proposalId, c.logDate])).toEqual([
      // On a note: the note, and the Daily Log day the note is on.
      ["Karen", ids.note, null, "2026-11-12"],
      // On a proposal (a direct edit counts): the proposal, and the day the comment was written.
      ["Kale", null, ids.direct, today],
      ["Casey", null, ids.winter, today],
      ["Karen", null, ids.wage, today],
    ]);
    expect(found[3].excerpt).toBe("Axolotl-striped aprons would cost extra.");
    // Exactly one of the two is set on every comment found, here and in the older tests' data.
    for (const hit of [...found, ...(await run("scanners can wait")).comments]) {
      expect([hit.noteId === null, hit.proposalId === null].filter(Boolean)).toHaveLength(1);
    }
    // A comment does not put its proposal in the proposals group: the words are not in the proposal.
    expect((await run("axolotl")).proposals).toEqual([]);
    expect(await comments("axolotl giraffe")).toEqual([]);
  });

  it("applies the filters through what the comment is on", async () => {
    const karen = await actorFor("karen@example.com");
    const kale = await actorFor("kale@example.com");
    // Section: where the note is filed; the section the proposal is about (subsections included).
    expect(await comments("axolotl", { sectionId: await sectionId("People") })).toEqual(these("onWage", "onDirect"));
    expect(await comments("axolotl", { sectionId: await sectionId("Wages") })).toEqual(these("onWage"));
    expect(await comments("axolotl", { sectionId: await sectionId("Store Hours") })).toEqual(these("onWinter"));
    expect(await comments("axolotl", { sectionId: await sectionId("Departments") })).toEqual(these("onNote"));
    expect(await comments("axolotl", { sectionId: await sectionId("Finance") })).toEqual([]);
    // Business: the note's tag, or the proposal's. Untagged proposals and direct edits drop out, as untagged notes do.
    expect(await comments("axolotl", { business: "coffee_shop" })).toEqual(these("onWage", "onNote"));
    expect(await comments("axolotl", { business: "garden_center" })).toEqual([]);
    // Who wrote the comment, not who proposed.
    expect(await comments("axolotl", { authorId: karen.id })).toEqual(these("onWage", "onNote"));
    expect(await comments("axolotl", { authorId: kale.id })).toEqual(these("onDirect"));
    // The day the comment was written (today), not the day of the proposal (November 17 and 18) or of the note.
    const today = centralDateKey(new Date());
    expect(await comments("axolotl", { from: today, to: today })).toEqual(these("onWage", "onWinter", "onDirect", "onNote"));
    expect(await comments("axolotl", { to: addDays(today, -1) })).toEqual([]);
    expect(await comments("axolotl", { from: addDays(today, 1) })).toEqual([]);
    expect(await comments("axolotl", { from: "2026-11-17", to: "2026-11-18" })).toEqual(today >= "2026-11-17" && today <= "2026-11-18" ? these("onWage", "onWinter", "onDirect", "onNote") : []);
    // Several at once.
    expect(await comments("axolotl", { sectionId: await sectionId("People"), business: "coffee_shop", authorId: karen.id })).toEqual(these("onWage"));
  });

  it("finds a proposal by the reason it was declined for", async () => {
    const found = (await run("okapi")).proposals;
    expect(found.map((p) => [p.proposalId, p.title, p.status])).toEqual([[ids.okapi, "Sign with the feed supplier", "declined"]]);
    expect(found[0].excerpt).toContain("Okapi prices first. Then decide.");
    // Words spread over the title and the reason.
    expect((await run("feed okapi decide")).proposals.map((p) => p.proposalId)).toEqual([ids.okapi]);
    expect((await run("okapi giraffe")).proposals).toEqual([]);
    // Proposals without a reason are found as before, by their own words.
    expect((await run("seed supplier")).proposals.map((p) => p.proposalId)).toEqual([ids.withdrawn]);
    expect((await run("pot supplier")).proposals.map((p) => p.proposalId)).toEqual([ids.silent]);
    expect((await run("supplier")).proposals.map((p) => p.proposalId)).toEqual([ids.silent, ids.withdrawn, ids.okapi]);
  });
});

describe("what a list needs to name a proposal", () => {
  it("comes with every proposal found, so search can show the same title as the other lists", async () => {
    const kale = await actorFor("kale@example.com");
    const departments = await sectionId("Departments");
    const wages = await sectionId("Wages");
    let found = (await run("quokka")).proposals;
    const corner = found.find((p) => p.type === "structure")!;
    expect(corner).toMatchObject({
      title: 'Add a section "Quokka Corner" under 4 Departments',
      type: "structure",
      status: "open",
      direct: false,
      sectionId: departments,
      sectionTitle: "Departments",
      destinationTitle: null,
      structureChange: { action: "add", title: "Quokka Corner" },
      decidedTitle: null,
      resultVersion: null,
    });
    expect(found.find((p) => p.title === "Raise the quokka wage")).toMatchObject({
      type: "decision",
      status: "open",
      direct: false,
      sectionId: wages,
      sectionTitle: "Wages",
      structureChange: null,
      decidedTitle: null,
      resultVersion: null,
    });

    // The section is renamed while the proposal waits. What was stored (and
    // is searched) stays; what the lists show follows the new name.
    await renameSection(kale, departments, "Plant Departments");
    found = (await run("quokka")).proposals;
    const renamed = found.find((p) => p.proposalId === corner.proposalId)!;
    expect(renamed.title).toBe('Add a section "Quokka Corner" under 4 Departments');
    expect(displayTitle(renamed, await tree())).toBe('Add a section "Quokka Corner" under 4 Plant Departments');
    // Approved: the sentence it was approved under, and for a text proposal the version it produced.
    await approveProposal(kale, corner.proposalId, { revision: 1 });
    const wage = found.find((p) => p.title === "Raise the quokka wage")!;
    await approveAlone(kale, wage.proposalId, { revision: 1 });
    await renameSection(kale, departments, "Departments");
    found = (await run("quokka")).proposals;
    const approved = found.find((p) => p.proposalId === corner.proposalId)!;
    expect(approved).toMatchObject({ status: "approved", decidedTitle: 'Add a section "Quokka Corner" under 4 Plant Departments' });
    expect(displayTitle(approved, await tree())).toBe('Add a section "Quokka Corner" under 4 Plant Departments');
    const decidedWage = found.find((p) => p.proposalId === wage.proposalId)!;
    expect(decidedWage.status).toBe("approved");
    expect(decidedWage.resultVersion?.version).toBeGreaterThan(1);
    expect(displayTitle(decidedWage, await tree())).toBe("Raise the quokka wage");
  });

  it("comes with the proposal line on a note as well", async () => {
    const kale = await actorFor("kale@example.com");
    const casey = await actorFor("casey@example.com");
    const signage = await sectionId("Signage");
    const marketing = await sectionId("Marketing and Events");
    const note = await addNote(kale, { body: doc("The old signs can go") });
    const archive = await createProposal(kale, { kind: "structure", change: { action: "archive", sectionId: signage }, noteIds: [note.id] });
    const move = await createProposal(kale, { kind: "structure", change: { action: "move", sectionId: signage, parentId: marketing }, noteIds: [note.id] });
    await renameSection(casey, signage, "Signs and Banners");
    const lines = (await asSystem((db) => proposalsForNotes(db, [note.id]))).get(note.id)!;
    expect(lines.map((line) => line.id)).toEqual([archive, move]);
    // The stored title still carries the old name; the line can show the same title as the Proposals page.
    expect(lines.map((line) => line.title)).toEqual(["Archive 5.2 Signage", "Move 5.2 Signage under 9 Marketing and Events"]);
    const now = await tree();
    expect(lines.map((line) => displayTitle(line, now))).toEqual([
      "Archive 5.2 Signs and Banners",
      "Move 5.2 Signs and Banners under 9 Marketing and Events",
    ]);
    expect(lines[1]).toMatchObject({
      status: "open",
      type: "structure",
      direct: false,
      sectionId: signage,
      sectionTitle: "Signs and Banners",
      destinationTitle: "Marketing and Events",
      structureChange: { action: "move", parentId: marketing },
      decidedTitle: null,
      resultVersion: null,
    });
    // Where it would go is archived: named by its stored name.
    await asSystem((db) => db.update(sections).set({ archivedAt: new Date() }).where(eq(sections.id, marketing)));
    expect(displayTitle(lines[1], await tree())).toBe("Move 5.2 Signs and Banners under Marketing and Events (archived)");
    // The same in search, which finds it by its stored words.
    const hit = (await run("move signage")).proposals.find((p) => p.proposalId === move)!;
    expect(hit.title).toBe("Move 5.2 Signage under 9 Marketing and Events");
    expect(displayTitle(hit, await tree())).toBe("Move 5.2 Signs and Banners under Marketing and Events (archived)");
    expect((await run("banners")).proposals).toEqual([]);
  });
});

describe("a section filter after a subsection was archived", () => {
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    const kale = await actorFor("kale@example.com");
    const casey = await actorFor("casey@example.com");
    const karen = await actorFor("karen@example.com");
    ids.finance = await sectionId("Finance");
    ids.quotes = await sectionId("Quotes");
    // A third level under Quotes, so "everything under it" is more than one step.
    await createSection(kale, { parentId: ids.quotes, title: "Tank Quotes" });
    ids.tank = await sectionId("Tank Quotes");
    await saveOfficial(kale, ids.quotes, doc("Every narwhal quote is kept for a year."));
    ids.open = await createProposal(kale, {
      kind: "decision",
      sectionId: ids.quotes,
      title: "Two signatures on a narwhal quote",
      proposedOfficial: doc("Every narwhal quote is kept for a year and signed twice."),
    });
    ids.declined = await createProposal(kale, {
      kind: "decision",
      sectionId: ids.tank,
      title: "Tank quotes go to the narwhal keeper",
      proposedOfficial: doc("Tank quotes go to the keeper."),
    });
    await declineProposal(casey, ids.declined, "Not yet");
    ids.rename = await createProposal(casey, {
      kind: "structure",
      change: { action: "rename", sectionId: ids.tank, title: "Narwhal Tank Quotes" },
    });
    ids.onOpen = await addProposalComment(karen, ids.open, doc("The narwhal keeper should be one of the two."));
    ids.onDeclined = await addProposalComment(casey, ids.declined, doc("Ask the narwhal keeper first."));
    const note = await addNote(casey, { body: doc("Narwhal tank quote came in high") });
    await sortNote(casey, note.id, await tree(), { sectionIds: [ids.quotes], businessTag: null, sorted: true });
    ids.note = note.id;
    ids.onNote = await addComment(karen, note.id, doc("The narwhal can wait a month."));
  });

  const found = async (filters?: SearchFilters) => {
    const results = await run("narwhal", filters);
    return {
      proposals: results.proposals.map((p) => p.proposalId).sort(),
      comments: results.comments.map((c) => c.commentId).sort(),
      notes: results.notes.map((n) => n.noteId),
      official: results.official.map((s) => s.title),
    };
  };
  const these = (...names: string[]) => names.map((name) => ids[name]).sort();

  it("keeps proposals and the comments on them under the section above; notes and official text follow the sections as they are now", async () => {
    const kale = await actorFor("kale@example.com");
    const everything = {
      proposals: these("open", "declined", "rename"),
      comments: these("onOpen", "onDeclined", "onNote"),
      notes: [ids.note],
      official: ["Quotes"],
    };
    // Before anything is archived, all of it is found under Finance.
    expect(await found({ sectionId: ids.finance })).toEqual(everything);
    expect(await found()).toEqual(everything);

    // Quotes is archived, and Tank Quotes goes with it.
    await archiveSection(kale, ids.quotes);
    expect(flattenTree(await tree()).some((node) => node.id === ids.quotes || node.id === ids.tank)).toBe(false);

    const underFinance = await found({ sectionId: ids.finance });
    // Proposals about the archived subsection, and about the section under
    // it, open or declined, text or section change: still under Finance.
    expect(underFinance.proposals).toEqual(these("open", "declined", "rename"));
    // So are the comments on those proposals. The comment on the note is not:
    // it follows its note.
    expect(underFinance.comments).toEqual(these("onOpen", "onDeclined"));
    // Unchanged: a note filed only under an archived section is left out by a
    // section filter, and so is the official text of an archived section.
    expect(underFinance.notes).toEqual([]);
    expect(underFinance.official).toEqual([]);

    // Without a section filter: everything but the official text of the
    // archived section, which search leaves out altogether.
    expect(await found()).toEqual({ ...everything, official: [] });
    // Another section's filter finds none of it.
    expect(await found({ sectionId: await sectionId("People") })).toEqual({ proposals: [], comments: [], notes: [], official: [] });
    // The other filters still apply on top of the section.
    expect((await found({ sectionId: ids.finance, authorId: kale.id })).proposals).toEqual(these("open", "declined"));
    expect((await found({ sectionId: ids.finance, authorId: kale.id })).comments).toEqual([]);
    // An archived section cannot be chosen as the filter itself (the screen
    // does not offer it): nothing is found, as before.
    expect(await found({ sectionId: ids.quotes })).toEqual({ proposals: [], comments: [], notes: [], official: [] });
  });
});
