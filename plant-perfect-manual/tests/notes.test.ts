import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { asSystem } from "@/db/client";
import { activityLog, dailyLogs, noteRevisions, noteSections, notes, sections } from "@/db/schema";
import {
  addComment,
  addNote,
  adjacentLogDays,
  editNote,
  listLogDays,
  listUnsortedNotes,
  loadDay,
  loadDiscussion,
  loadNote,
  removeNote,
  restoreNote,
  setNoteSorted,
  sortNote,
} from "@/lib/notes";
import { AppError } from "@/lib/permissions";
import { type RichDoc, docToText } from "@/lib/richtext";
import { archiveSection, flattenTree, loadTree, restoreSection } from "@/lib/sections";
import { actorFor, insertUser, withTestDatabase } from "./helpers/db";

withTestDatabase();

function doc(...paragraphs: string[]): RichDoc {
  return {
    type: "doc",
    content: paragraphs.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })),
  };
}

const tree = () => asSystem((db) => loadTree(db));
async function sectionId(title: string): Promise<string> {
  const node = flattenTree(await tree()).find((n) => n.title === title);
  if (!node) throw new Error(`No section called ${title}`);
  return node.id;
}
const note = async (id: string) => (await asSystem(async (db) => loadNote(db, await loadTree(db), id)))!;

const SCANNERS = "We need to figure out what scanners to use for line busters";

describe("writing notes", () => {
  it("keeps a note word for word and puts it on today's Daily Log", async () => {
    const kale = await actorFor("kale@example.com");
    // 9:30 PM Central on Nov 12 is already Nov 13 in UTC.
    const now = new Date("2026-11-13T03:30:00Z");
    const { id, logDate } = await addNote(kale, { body: doc(SCANNERS), now });
    expect(logDate).toBe("2026-11-12");

    const saved = await note(id);
    expect(docToText(saved.body)).toBe(SCANNERS);
    expect(saved).toMatchObject({
      logDate: "2026-11-12",
      authorName: "Kale",
      authorId: kale.id,
      sorted: false,
      businessTag: null,
      editedAt: null,
      revisions: [],
      sections: [],
      comments: [],
      removedAt: null,
    });
    expect(saved.createdAt.toISOString()).toBe(now.toISOString());

    const days = await asSystem((db) => db.select().from(dailyLogs));
    expect(days.map((d) => d.logDate)).toEqual(["2026-11-12"]);
    const log = await asSystem((db) => db.select().from(activityLog).where(eq(activityLog.entityId, id)));
    expect(log.map((e) => e.summary)).toEqual(["Added a note to the Daily Log for Nov 12, 2026"]);
    expect(log[0].userId).toBe(kale.id);
  });

  it("never changes odd spacing, symbols or capitals", async () => {
    const casey = await actorFor("casey@example.com");
    const typed = "  talked to  HOLLY lumber -- $4,200??   (call back thurs)\tok ☕ ";
    const { id } = await addNote(casey, { body: doc(typed), now: new Date("2026-11-13T15:00:00Z") });
    expect((await note(id)).body.content[0].content?.[0].text).toBe(typed);
  });

  it("shows a day's notes from all users in the order written", async () => {
    const kale = await actorFor("kale@example.com");
    const casey = await actorFor("casey@example.com");
    await addNote(casey, { body: doc("second on the 14th"), now: new Date("2026-11-14T18:00:00Z") });
    await addNote(kale, { body: doc("first on the 14th"), now: new Date("2026-11-14T15:00:00Z") });
    await addNote(kale, { body: doc("third on the 14th"), now: new Date("2026-11-14T22:00:00Z") });
    const day = await asSystem(async (db) => loadDay(db, await loadTree(db), "2026-11-14"));
    expect(day.map((n) => `${n.authorName}: ${docToText(n.body)}`)).toEqual([
      "Kale: first on the 14th",
      "Casey: second on the 14th",
      "Kale: third on the 14th",
    ]);
    expect(await asSystem(async (db) => loadDay(db, await loadTree(db), "2026-11-01"))).toEqual([]);
  });

  it("lists the days that have notes, newest first, with counts", async () => {
    const days = await asSystem((db) => listLogDays(db));
    expect(days).toEqual([
      { logDate: "2026-11-14", noteCount: 3, unsortedCount: 3 },
      { logDate: "2026-11-13", noteCount: 1, unsortedCount: 1 },
      { logDate: "2026-11-12", noteCount: 1, unsortedCount: 1 },
    ]);
  });

  it("finds the nearest days with notes for Previous and Next", async () => {
    expect(await asSystem((db) => adjacentLogDays(db, "2026-11-13"))).toEqual({ previous: "2026-11-12", next: "2026-11-14" });
    expect(await asSystem((db) => adjacentLogDays(db, "2026-11-12"))).toEqual({ previous: null, next: "2026-11-13" });
    expect(await asSystem((db) => adjacentLogDays(db, "2026-11-14"))).toEqual({ previous: "2026-11-13", next: null });
    // A day without notes still finds its neighbours.
    expect(await asSystem((db) => adjacentLogDays(db, "2026-12-25"))).toEqual({ previous: "2026-11-14", next: null });
    expect(await asSystem((db) => adjacentLogDays(db, "2026-01-01"))).toEqual({ previous: null, next: "2026-11-12" });
  });

  it("refuses an empty note", async () => {
    const kale = await actorFor("kale@example.com");
    await expect(addNote(kale, { body: doc("   ") })).rejects.toThrow(AppError);
    await expect(addNote(kale, { body: { type: "doc", content: [{ type: "paragraph" }] } })).rejects.toThrow(AppError);
    await expect(addNote(kale, { body: "just a string" })).rejects.toThrow(AppError);
  });

  it("is for Owners only", async () => {
    const karen = await insertUser("Karen", "karen@example.com", "advisor");
    await expect(addNote(karen, { body: doc("Advisor note") })).rejects.toThrow(AppError);
  });
});

describe("editing a note", () => {
  it("lets the author change the wording and keeps the earlier wording", async () => {
    const kale = await actorFor("kale@example.com");
    const { id } = await addNote(kale, { body: doc("Sign qoute from Holly"), now: new Date("2026-11-15T15:00:00Z") });
    expect(await editNote(kale, id, doc("Sign quote from Holly"))).toEqual({ changed: true });

    const saved = await note(id);
    expect(docToText(saved.body)).toBe("Sign quote from Holly");
    expect(saved.editedAt).not.toBeNull();
    // The earlier wording stays viewable.
    expect(saved.revisions.map((r) => docToText(r.body))).toEqual(["Sign qoute from Holly"]);
    const history = await asSystem((db) => db.select().from(noteRevisions).where(eq(noteRevisions.noteId, id)));
    expect(history.map((r) => r.bodyText)).toEqual(["Sign qoute from Holly"]);
    expect(history[0].createdBy).toBe(kale.id);

    // Saving the same words again changes nothing.
    expect(await editNote(kale, id, doc("Sign quote from Holly"))).toEqual({ changed: false });
    expect(await asSystem((db) => db.select().from(noteRevisions).where(eq(noteRevisions.noteId, id)))).toHaveLength(1);
  });

  it("does not let anyone else change the wording, not even the other Owner", async () => {
    const kale = await actorFor("kale@example.com");
    const casey = await actorFor("casey@example.com");
    const { id } = await addNote(kale, { body: doc("Kale's own words"), now: new Date("2026-11-15T16:00:00Z") });
    await expect(editNote(casey, id, doc("Casey's version"))).rejects.toThrow("Only the person who wrote");
    const karen = await actorFor("karen@example.com");
    await expect(editNote(karen, id, doc("Karen's version"))).rejects.toThrow(AppError);
    expect(docToText((await note(id)).body)).toBe("Kale's own words");
  });

  it("refuses to blank a note or edit one that does not exist", async () => {
    const kale = await actorFor("kale@example.com");
    const { id } = await addNote(kale, { body: doc("keep me"), now: new Date("2026-11-15T17:00:00Z") });
    await expect(editNote(kale, id, doc(""))).rejects.toThrow(AppError);
    await expect(editNote(kale, "00000000-0000-4000-8000-000000000000", doc("x"))).rejects.toThrow(AppError);
    await expect(editNote(kale, "not-an-id", doc("x"))).rejects.toThrow(AppError);
  });
});

describe("sorting a note by hand", () => {
  it("files the note under sections, where it shows word for word with a link back to its day", async () => {
    const kale = await actorFor("kale@example.com");
    const now = new Date("2026-11-16T15:00:00Z");
    const { id } = await addNote(kale, { body: doc(SCANNERS), now });
    const pos = await sectionId("Point of Sale");
    const registers = await sectionId("Registers and Customer Service");

    await sortNote(kale, id, await tree(), { sectionIds: [pos, registers], businessTag: "garden_center", sorted: true });

    const saved = await note(id);
    expect(saved.sorted).toBe(true);
    expect(saved.businessTag).toBe("garden_center");
    expect(saved.sections.map((s) => `${s.number} ${s.title}`)).toEqual([
      "4.1 Registers and Customer Service",
      "6.1 Point of Sale",
    ]);
    expect(saved.sections.every((s) => s.byAi === false)).toBe(true);

    const discussion = await asSystem(async (db) => loadDiscussion(db, await loadTree(db), pos));
    expect(discussion).toHaveLength(1);
    expect(discussion[0].id).toBe(id);
    expect(docToText(discussion[0].body)).toBe(SCANNERS);
    expect(discussion[0]).toMatchObject({ authorName: "Kale", logDate: "2026-11-16" });
    expect(discussion[0].createdAt.toISOString()).toBe(now.toISOString());

    // Filing a note counts as activity in the section.
    const [section] = await asSystem((db) => db.select().from(sections).where(eq(sections.id, pos)));
    expect(section.updatedBy).toBe(kale.id);

    const log = await asSystem((db) => db.select().from(activityLog).where(eq(activityLog.entityId, id)));
    expect(log.map((e) => e.summary)).toContain(
      "Sorted a note from Nov 16, 2026: filed it under 4.1 Registers and Customer Service, 6.1 Point of Sale; tagged it Garden Center; marked it Sorted",
    );
  });

  it("is the same note everywhere, not a copy", async () => {
    const kale = await actorFor("kale@example.com");
    const pos = await sectionId("Point of Sale");
    const [entry] = await asSystem(async (db) => loadDiscussion(db, await loadTree(db), pos));
    await editNote(kale, entry.id, doc(`${SCANNERS} (ask Casey)`));
    const after = await asSystem(async (db) => loadDiscussion(db, await loadTree(db), pos));
    expect(docToText(after[0].body)).toBe(`${SCANNERS} (ask Casey)`);
    expect(await asSystem((db) => db.select().from(notes).where(eq(notes.id, entry.id)))).toHaveLength(1);
  });

  it("takes a note out of a section without deleting anything, and can file it again", async () => {
    const kale = await actorFor("kale@example.com");
    const casey = await actorFor("casey@example.com");
    const pos = await sectionId("Point of Sale");
    const registers = await sectionId("Registers and Customer Service");
    const [entry] = await asSystem(async (db) => loadDiscussion(db, await loadTree(db), pos));

    await sortNote(casey, entry.id, await tree(), { sectionIds: [registers], businessTag: "garden_center", sorted: true });
    expect(await asSystem(async (db) => loadDiscussion(db, await loadTree(db), pos))).toEqual([]);
    const links = await asSystem((db) => db.select().from(noteSections).where(eq(noteSections.noteId, entry.id)));
    expect(links).toHaveLength(2);
    const removed = links.find((l) => l.sectionId === pos)!;
    expect(removed.removedAt).not.toBeNull();
    expect(removed.removedBy).toBe(casey.id);
    expect(removed.createdBy).toBe(kale.id);

    // Filing it again is a new record, so the first filing's who and when are kept.
    await sortNote(casey, entry.id, await tree(), { sectionIds: [registers, pos], businessTag: "garden_center", sorted: true });
    expect(await asSystem(async (db) => loadDiscussion(db, await loadTree(db), pos))).toHaveLength(1);
    const after = await asSystem((db) => db.select().from(noteSections).where(eq(noteSections.noteId, entry.id)));
    expect(after).toHaveLength(3);
    const posRows = after.filter((l) => l.sectionId === pos);
    expect(posRows.map((l) => [l.createdBy, l.removedAt === null]).sort()).toEqual(
      [
        [kale.id, false],
        [casey.id, true],
      ].sort(),
    );
    expect((await note(entry.id)).sections.map((x) => x.title)).toEqual(["Registers and Customer Service", "Point of Sale"]);
  });

  it("keeps a filing under a section that is archived later, and shows it again when restored", async () => {
    const kale = await actorFor("kale@example.com");
    const { id } = await addNote(kale, { body: doc("perennials delivery in April"), now: new Date("2026-11-16T18:00:00Z") });
    const perennials = await sectionId("Perennials");
    const wages = await sectionId("Wages");
    await sortNote(kale, id, await tree(), { sectionIds: [perennials], businessTag: null, sorted: true });
    await archiveSection(kale, perennials);

    // The note still says where it was filed, without a number (the section is hidden).
    expect((await note(id)).sections).toEqual([{ id: perennials, number: null, title: "Perennials", byAi: false }]);
    // Sorting it elsewhere does not disturb the hidden filing.
    await sortNote(kale, id, await tree(), { sectionIds: [wages], businessTag: null, sorted: true });
    expect((await note(id)).sections.map((x) => x.title)).toEqual(["Wages", "Perennials"]);

    await restoreSection(kale, perennials);
    const discussion = await asSystem(async (db) => loadDiscussion(db, await loadTree(db), perennials));
    expect(discussion.map((n) => n.id)).toEqual([id]);
  });

  it("lets Sorted be ticked and unticked on its own", async () => {
    const kale = await actorFor("kale@example.com");
    const { id } = await addNote(kale, { body: doc("tick me"), now: new Date("2026-11-17T15:00:00Z") });
    await setNoteSorted(kale, id, true);
    expect((await note(id)).sorted).toBe(true);
    await setNoteSorted(kale, id, false);
    expect((await note(id)).sorted).toBe(false);
    // Choosing sections does not force Sorted on: it is the user's call.
    await sortNote(kale, id, await tree(), { sectionIds: [await sectionId("Wages")], businessTag: null, sorted: false });
    const saved = await note(id);
    expect(saved.sorted).toBe(false);
    expect(saved.sections.map((s) => s.title)).toEqual(["Wages"]);
  });

  it("lists unsorted notes, newest first", async () => {
    const result = await asSystem(async (db) => listUnsortedNotes(db, await loadTree(db), 3));
    expect(result.total).toBeGreaterThan(3);
    expect(result.notes).toHaveLength(3);
    expect(result.notes.every((n) => !n.sorted)).toBe(true);
    const times = result.notes.map((n) => n.createdAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it("refuses unknown or archived sections, bad tags, and Advisors", async () => {
    const kale = await actorFor("kale@example.com");
    const karen = await actorFor("karen@example.com");
    const { id } = await addNote(kale, { body: doc("to sort"), now: new Date("2026-11-17T16:00:00Z") });
    const wages = await sectionId("Wages");
    const current = await tree();

    await expect(
      sortNote(kale, id, current, { sectionIds: ["00000000-0000-4000-8000-000000000000"], businessTag: null, sorted: true }),
    ).rejects.toThrow(AppError);
    await expect(sortNote(kale, id, current, { sectionIds: "nope", businessTag: null, sorted: true })).rejects.toThrow(AppError);
    await expect(sortNote(kale, id, current, { sectionIds: [wages], businessTag: "bakery", sorted: true })).rejects.toThrow(AppError);
    await expect(sortNote(karen, id, current, { sectionIds: [wages], businessTag: null, sorted: true })).rejects.toThrow(AppError);
    await expect(setNoteSorted(karen, id, true)).rejects.toThrow(AppError);

    const annuals = await sectionId("Annuals");
    await archiveSection(kale, annuals);
    await expect(
      sortNote(kale, id, await tree(), { sectionIds: [annuals], businessTag: null, sorted: true }),
    ).rejects.toThrow(AppError);
    expect((await note(id)).sections).toEqual([]);
  });

  it("orders and filters a Discussion", async () => {
    const kale = await actorFor("kale@example.com");
    const hiring = await sectionId("Hiring");
    const make = async (text: string, at: string, tag: "garden_center" | "coffee_shop" | "both" | null) => {
      const { id } = await addNote(kale, { body: doc(text), now: new Date(at) });
      await sortNote(kale, id, await tree(), { sectionIds: [hiring], businessTag: tag, sorted: true });
    };
    await make("garden hire", "2026-11-18T15:00:00Z", "garden_center");
    await make("coffee hire", "2026-11-18T16:00:00Z", "coffee_shop");
    await make("both hire", "2026-11-18T17:00:00Z", "both");
    await make("untagged hire", "2026-11-18T18:00:00Z", null);

    const texts = async (options?: Parameters<typeof loadDiscussion>[3]) =>
      (await asSystem(async (db) => loadDiscussion(db, await loadTree(db), hiring, options))).map((n) => docToText(n.body));

    expect(await texts()).toEqual(["untagged hire", "both hire", "coffee hire", "garden hire"]);
    expect(await texts({ order: "oldest" })).toEqual(["garden hire", "coffee hire", "both hire", "untagged hire"]);
    // "Both" concerns each business, so it shows under either filter.
    expect(await texts({ business: "garden_center" })).toEqual(["both hire", "garden hire"]);
    expect(await texts({ business: "coffee_shop" })).toEqual(["both hire", "coffee hire"]);
  });
});

describe("comments on notes", () => {
  it("lets Owners and Advisors comment, word for word, in order", async () => {
    const kale = await actorFor("kale@example.com");
    const karen = await actorFor("karen@example.com");
    const { id } = await addNote(kale, { body: doc("Thinking $15/hr for coffee staff"), now: new Date("2026-11-19T15:00:00Z") });

    await addComment(karen, id, doc("  I'd go $15 -- matches the registers  "));
    await addComment(kale, id, doc("Agreed."));

    const saved = await note(id);
    expect(saved.comments.map((c) => `${c.authorName}: ${c.body.content[0].content?.[0].text}`)).toEqual([
      "Karen:   I'd go $15 -- matches the registers  ",
      "Kale: Agreed.",
    ]);
    const log = await asSystem((db) => db.select().from(activityLog).where(eq(activityLog.action, "comment.added")));
    expect(log.map((e) => e.userId).sort()).toEqual([kale.id, karen.id].sort());
  });

  it("refuses empty comments and comments on notes that do not exist", async () => {
    const karen = await actorFor("karen@example.com");
    const kale = await actorFor("kale@example.com");
    const { id } = await addNote(kale, { body: doc("a note"), now: new Date("2026-11-19T16:00:00Z") });
    await expect(addComment(karen, id, doc(" "))).rejects.toThrow(AppError);
    await expect(addComment(karen, "00000000-0000-4000-8000-000000000000", doc("hello"))).rejects.toThrow(AppError);
  });
});

describe("removing a note", () => {
  it("hides the note everywhere but keeps it, and an Owner can restore it", async () => {
    const kale = await actorFor("kale@example.com");
    const casey = await actorFor("casey@example.com");
    const karen = await actorFor("karen@example.com");
    const { id } = await addNote(kale, { body: doc("pasted in by mistake"), now: new Date("2026-11-20T15:00:00Z") });
    const training = await sectionId("Training");
    await sortNote(kale, id, await tree(), { sectionIds: [training], businessTag: null, sorted: false });
    await addComment(karen, id, doc("is this right?"));

    await removeNote(casey, id);

    const day = (options?: { includeRemoved?: boolean }) =>
      asSystem(async (db) => loadDay(db, await loadTree(db), "2026-11-20", options));
    expect(await day()).toEqual([]);
    expect(await asSystem(async (db) => loadDiscussion(db, await loadTree(db), training))).toEqual([]);
    expect((await asSystem((db) => listLogDays(db))).map((d) => d.logDate)).not.toContain("2026-11-20");
    const unsorted = await asSystem(async (db) => listUnsortedNotes(db, await loadTree(db), 100));
    expect(unsorted.notes.map((n) => n.id)).not.toContain(id);

    // Owners can still see that a note was removed, and by whom.
    const withRemoved = await day({ includeRemoved: true });
    expect(withRemoved).toHaveLength(1);
    expect(withRemoved[0].removedAt).not.toBeNull();
    expect(withRemoved[0].removedByName).toBe("Casey");
    expect(await asSystem((db) => db.select().from(notes).where(eq(notes.id, id)))).toHaveLength(1);

    // A removed note cannot be changed until it is restored.
    await expect(editNote(kale, id, doc("changed"))).rejects.toThrow("was removed");
    await expect(addComment(karen, id, doc("still there?"))).rejects.toThrow("was removed");
    await expect(setNoteSorted(kale, id, true)).rejects.toThrow("was removed");

    await restoreNote(kale, id);
    const back = await day();
    expect(back).toHaveLength(1);
    expect(docToText(back[0].body)).toBe("pasted in by mistake");
    expect(back[0].sections.map((x) => x.title)).toEqual(["Training"]);
    expect(back[0].comments).toHaveLength(1);
    expect(await asSystem(async (db) => loadDiscussion(db, await loadTree(db), training))).toHaveLength(1);

    const log = await asSystem((db) => db.select().from(activityLog).where(eq(activityLog.entityId, id)));
    expect(log.map((e) => e.action)).toEqual(expect.arrayContaining(["note.removed", "note.restored"]));
  });

  it("is for Owners only", async () => {
    const kale = await actorFor("kale@example.com");
    const karen = await actorFor("karen@example.com");
    const { id } = await addNote(kale, { body: doc("stays put"), now: new Date("2026-11-20T16:00:00Z") });
    await expect(removeNote(karen, id)).rejects.toThrow(AppError);
    await expect(restoreNote(karen, id)).rejects.toThrow(AppError);
    expect((await note(id)).removedAt).toBeNull();
  });
});
