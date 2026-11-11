import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { asSystem, asUser } from "@/db/client";
import { comments, dailyLogs, noteRevisions, noteSections, notes, sections, settings } from "@/db/schema";
import { addComment, addNote, sortNote } from "@/lib/notes";
import type { RichDoc } from "@/lib/richtext";
import { loadTree } from "@/lib/sections";
import { centralDateKey } from "@/lib/time";
import { actorFor, insertUser, withTestDatabase } from "./helpers/db";

withTestDatabase();

/**
 * These tests skip the app's own checks and talk to the database directly as
 * each kind of user, to prove the database itself protects notes, comments
 * and settings (row level security, column permissions and the trigger that
 * guards a note's wording).
 */

const doc = (text: string): RichDoc => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

async function setup() {
  const kale = await actorFor("kale@example.com");
  const casey = await actorFor("casey@example.com");
  const karen =
    (await asSystem((db) => db.query.users.findFirst({ where: (u, { eq: is }) => is(u.email, "karen@example.com") })))
      ? await actorFor("karen@example.com")
      : await insertUser("Karen", "karen@example.com", "advisor");
  return { kale, casey, karen };
}

async function wages(): Promise<string> {
  const [row] = await asSystem((db) => db.select().from(sections).where(eq(sections.title, "Wages")));
  return row.id;
}

describe("database rules: notes", () => {
  it("lets an Owner write a note only in their own name", async () => {
    const { kale, casey } = await setup();
    const today = centralDateKey();
    await asSystem((db) => db.insert(dailyLogs).values({ logDate: today }).onConflictDoNothing());
    const mine = await asUser(kale.id, (tx) =>
      tx
        .insert(notes)
        .values({ logDate: today, body: doc("mine"), bodyText: "mine", createdBy: kale.id })
        .returning(),
    );
    expect(mine).toHaveLength(1);
    await expect(
      asUser(kale.id, (tx) =>
        tx.insert(notes).values({ logDate: today, body: doc("forged"), bodyText: "forged", createdBy: casey.id }),
      ),
    ).rejects.toThrow();
  });

  it("refuses a note whose day does not match the time it was written", async () => {
    const { kale } = await setup();
    await asSystem((db) => db.insert(dailyLogs).values({ logDate: "2020-01-01" }).onConflictDoNothing());
    await expect(
      asUser(kale.id, (tx) =>
        tx.insert(notes).values({ logDate: "2020-01-01", body: doc("backdated"), bodyText: "backdated", createdBy: kale.id }),
      ),
    ).rejects.toThrow();
  });

  it("refuses filing a note in someone else's name", async () => {
    const { kale, casey } = await setup();
    const { id } = await addNote(kale, { body: doc("file me") });
    const sectionId = await wages();
    await expect(
      asUser(kale.id, (tx) => tx.insert(noteSections).values({ noteId: id, sectionId, createdBy: casey.id })),
    ).rejects.toThrow();
    const ok = await asUser(kale.id, (tx) =>
      tx.insert(noteSections).values({ noteId: id, sectionId, createdBy: kale.id }).returning(),
    );
    expect(ok).toHaveLength(1);
    // Only one live filing per note and section.
    await expect(
      asUser(kale.id, (tx) => tx.insert(noteSections).values({ noteId: id, sectionId, createdBy: kale.id })),
    ).rejects.toThrow();
  });

  it("refuses notes, filing and day rows from an Advisor", async () => {
    const { kale, karen } = await setup();
    const { id } = await addNote(kale, { body: doc("owner note") });
    await expect(
      asUser(karen.id, (tx) =>
        tx.insert(notes).values({ logDate: centralDateKey(), body: doc("x"), bodyText: "x", createdBy: karen.id }),
      ),
    ).rejects.toThrow();
    const sectionId = await wages();
    await expect(
      asUser(karen.id, (tx) => tx.insert(noteSections).values({ noteId: id, sectionId, createdBy: karen.id })),
    ).rejects.toThrow();
    await expect(asUser(karen.id, (tx) => tx.insert(dailyLogs).values({ logDate: "2030-01-01" }))).rejects.toThrow();
    const touched = await asUser(karen.id, (tx) =>
      tx.update(notes).set({ sortedAt: new Date() }).where(eq(notes.id, id)).returning(),
    );
    expect(touched).toHaveLength(0);
    // But she can read it.
    expect((await asUser(karen.id, (tx) => tx.select().from(notes).where(eq(notes.id, id)))).length).toBe(1);
  });

  it("stops everyone but the author from changing a note's wording", async () => {
    const { kale, casey } = await setup();
    const { id } = await addNote(kale, { body: doc("Kale's exact words") });
    await expect(
      asUser(casey.id, (tx) =>
        tx.update(notes).set({ body: doc("rewritten"), bodyText: "rewritten" }).where(eq(notes.id, id)),
      ),
    ).rejects.toThrow();
    await expect(
      asUser(casey.id, (tx) => tx.update(notes).set({ bodyText: "only the search copy" }).where(eq(notes.id, id))),
    ).rejects.toThrow();
    // The other Owner can still sort it.
    const sorted = await asUser(casey.id, (tx) =>
      tx.update(notes).set({ sortedAt: new Date(), sortedBy: casey.id }).where(eq(notes.id, id)).returning(),
    );
    expect(sorted).toHaveLength(1);
    const [row] = await asSystem((db) => db.select().from(notes).where(eq(notes.id, id)));
    expect(row.bodyText).toBe("Kale's exact words");
    expect(await asSystem((db) => db.select().from(noteRevisions).where(eq(noteRevisions.noteId, id)))).toEqual([]);
  });

  it("keeps the earlier wording by itself whenever the author edits", async () => {
    const { kale } = await setup();
    const { id } = await addNote(kale, { body: doc("first wording") });
    // Straight to the database, without the app's edit function.
    await asUser(kale.id, (tx) =>
      tx.update(notes).set({ body: doc("second wording"), bodyText: "second wording" }).where(eq(notes.id, id)),
    );
    await asUser(kale.id, (tx) =>
      tx.update(notes).set({ body: doc("third wording"), bodyText: "third wording" }).where(eq(notes.id, id)),
    );
    const history = await asSystem((db) => db.select().from(noteRevisions).where(eq(noteRevisions.noteId, id)));
    expect(history.map((r) => r.bodyText).sort()).toEqual(["first wording", "second wording"]);
    expect(history.every((r) => r.createdBy === kale.id)).toBe(true);
    // Sorting does not add to the history.
    await asUser(kale.id, (tx) => tx.update(notes).set({ sortedAt: new Date() }).where(eq(notes.id, id)));
    expect(await asSystem((db) => db.select().from(noteRevisions).where(eq(noteRevisions.noteId, id)))).toHaveLength(2);
  });

  it("never lets who wrote a note, when, or its day be changed", async () => {
    const { kale, casey } = await setup();
    const { id } = await addNote(kale, { body: doc("authorship is fixed") });
    const [before] = await asSystem((db) => db.select().from(notes).where(eq(notes.id, id)));
    await expect(asUser(kale.id, (tx) => tx.update(notes).set({ createdBy: casey.id }).where(eq(notes.id, id)))).rejects.toThrow();
    await expect(asUser(kale.id, (tx) => tx.update(notes).set({ createdAt: new Date(0) }).where(eq(notes.id, id)))).rejects.toThrow();
    // Even a small shift within the same day is refused.
    const aMinuteEarlier = new Date(before.createdAt.getTime() - 60_000);
    await expect(asUser(kale.id, (tx) => tx.update(notes).set({ createdAt: aMinuteEarlier }).where(eq(notes.id, id)))).rejects.toThrow();
    await expect(asUser(kale.id, (tx) => tx.update(notes).set({ logDate: "2020-01-01" }).where(eq(notes.id, id)))).rejects.toThrow();
    const [after] = await asSystem((db) => db.select().from(notes).where(eq(notes.id, id)));
    expect(after.createdAt.toISOString()).toBe(before.createdAt.toISOString());
    expect(after.createdBy).toBe(kale.id);
  });

  it("stamps the edited mark itself and lets nobody set, clear or fake it", async () => {
    const { kale, casey } = await setup();
    const { id } = await addNote(kale, { body: doc("first") });
    // The author changes the wording without sending any edited time.
    await asUser(kale.id, (tx) => tx.update(notes).set({ body: doc("second"), bodyText: "second" }).where(eq(notes.id, id)));
    const [edited] = await asSystem((db) => db.select().from(notes).where(eq(notes.id, id)));
    expect(edited.editedAt).not.toBeNull();
    // Nobody can clear it or move it, not the other Owner and not the author.
    await expect(asUser(casey.id, (tx) => tx.update(notes).set({ editedAt: null }).where(eq(notes.id, id)))).rejects.toThrow();
    await expect(asUser(kale.id, (tx) => tx.update(notes).set({ editedAt: new Date(0) }).where(eq(notes.id, id)))).rejects.toThrow();
    // Nobody can put an edited mark on a note that was never changed.
    const untouched = await addNote(kale, { body: doc("never edited") });
    await expect(
      asUser(casey.id, (tx) => tx.update(notes).set({ editedAt: new Date() }).where(eq(notes.id, untouched.id))),
    ).rejects.toThrow();
    const [still] = await asSystem((db) => db.select().from(notes).where(eq(notes.id, untouched.id)));
    expect(still.editedAt).toBeNull();
  });

  it("has no back door: wording cannot be changed without a signed-in author, even with full database rights", async () => {
    const { kale } = await setup();
    const { id } = await addNote(kale, { body: doc("no back door") });
    await expect(
      asSystem((db) => db.update(notes).set({ body: doc("rewritten by a script"), bodyText: "rewritten by a script" }).where(eq(notes.id, id))),
    ).rejects.toThrow();
    const [row] = await asSystem((db) => db.select().from(notes).where(eq(notes.id, id)));
    expect(row.bodyText).toBe("no back door");
  });

  it("refuses a removal, a sort or a change recorded in someone else's name", async () => {
    const { kale, casey } = await setup();
    const { id } = await addNote(casey, { body: doc("Casey's note") });
    const now = new Date();
    await expect(
      asUser(kale.id, (tx) => tx.update(notes).set({ removedAt: now, removedBy: casey.id }).where(eq(notes.id, id))),
    ).rejects.toThrow();
    await expect(
      asUser(kale.id, (tx) => tx.update(notes).set({ sortedAt: now, sortedBy: casey.id }).where(eq(notes.id, id))),
    ).rejects.toThrow();
    await expect(
      asUser(kale.id, (tx) => tx.update(notes).set({ removedAt: now }).where(eq(notes.id, id))),
    ).rejects.toThrow();
    const [row] = await asSystem((db) => db.select().from(notes).where(eq(notes.id, id)));
    expect(row.removedAt).toBeNull();
    expect(row.sortedAt).toBeNull();
    // "Last changed by" is stamped by the database, whatever the app sends.
    await asUser(kale.id, (tx) =>
      tx.update(notes).set({ businessTag: "both", updatedBy: casey.id, updatedAt: new Date(0) }).where(eq(notes.id, id)),
    );
    const [changed] = await asSystem((db) => db.select().from(notes).where(eq(notes.id, id)));
    expect(changed.updatedBy).toBe(kale.id);
    expect(changed.updatedAt.getTime()).toBeGreaterThan(now.getTime() - 60_000);
  });

  it("refuses a day row in someone else's name, and never changes a day row", async () => {
    const { kale, casey, karen } = await setup();
    await expect(
      asUser(kale.id, (tx) => tx.insert(dailyLogs).values({ logDate: "2019-05-05", createdBy: casey.id })),
    ).rejects.toThrow();
    await addNote(kale, { body: doc("makes today's row") });
    await expect(asUser(kale.id, (tx) => tx.update(dailyLogs).set({ createdBy: casey.id }))).rejects.toThrow();
    await expect(asUser(karen.id, (tx) => tx.update(dailyLogs).set({ createdBy: karen.id }))).rejects.toThrow();
  });

  it("only stores text that is a real document", async () => {
    const { kale, karen } = await setup();
    const { id } = await addNote(kale, { body: doc("a real note") });
    const today = centralDateKey();
    await expect(
      asUser(kale.id, (tx) => tx.insert(notes).values({ logDate: today, body: "just a string", bodyText: "x", createdBy: kale.id })),
    ).rejects.toThrow();
    await expect(
      asUser(kale.id, (tx) => tx.insert(notes).values({ logDate: today, body: { type: "doc" }, bodyText: "x", createdBy: kale.id })),
    ).rejects.toThrow();
    await expect(
      asUser(karen.id, (tx) => tx.insert(comments).values({ noteId: id, body: ["not", "a", "doc"], bodyText: "x", createdBy: karen.id })),
    ).rejects.toThrow();
  });

  it("keeps the history and the notes themselves safe from deletion or tampering", async () => {
    const { kale } = await setup();
    const { id } = await addNote(kale, { body: doc("permanent") });
    await expect(asUser(kale.id, (tx) => tx.delete(notes))).rejects.toThrow();
    await expect(asUser(kale.id, (tx) => tx.delete(noteRevisions))).rejects.toThrow();
    await expect(asUser(kale.id, (tx) => tx.delete(noteSections))).rejects.toThrow();
    await expect(asUser(kale.id, (tx) => tx.delete(dailyLogs))).rejects.toThrow();
    await expect(
      asUser(kale.id, (tx) =>
        tx.insert(noteRevisions).values({ noteId: id, body: doc("fake history"), bodyText: "fake history", createdBy: kale.id }),
      ),
    ).rejects.toThrow();
    await expect(asUser(kale.id, (tx) => tx.update(noteRevisions).set({ bodyText: "edited history" }))).rejects.toThrow();
  });

  it("lets an Owner remove a note only by marking it removed", async () => {
    const { kale, casey, karen } = await setup();
    const { id } = await addNote(kale, { body: doc("to remove") });
    const hidden = await asUser(casey.id, (tx) =>
      tx.update(notes).set({ removedAt: new Date(), removedBy: casey.id }).where(eq(notes.id, id)).returning(),
    );
    expect(hidden).toHaveLength(1);
    const byAdvisor = await asUser(karen.id, (tx) =>
      tx.update(notes).set({ removedAt: null, removedBy: null }).where(eq(notes.id, id)).returning(),
    );
    expect(byAdvisor).toHaveLength(0);
    await expect(asUser(casey.id, (tx) => tx.delete(notes).where(eq(notes.id, id)))).rejects.toThrow();
    const [row] = await asSystem((db) => db.select().from(notes).where(eq(notes.id, id)));
    expect(row.bodyText).toBe("to remove");
    expect(row.removedAt).not.toBeNull();
  });

  it("only lets a filing be taken out, once, in your own name", async () => {
    const { kale, casey, karen } = await setup();
    const { id } = await addNote(kale, { body: doc("to file") });
    const sectionId = await wages();
    await sortNote(kale, id, await asSystem((db) => loadTree(db)), { sectionIds: [sectionId], businessTag: null, sorted: true });
    const link = and(eq(noteSections.noteId, id), eq(noteSections.sectionId, sectionId));
    const now = new Date();
    await expect(asUser(kale.id, (tx) => tx.update(noteSections).set({ byAi: true }).where(link))).rejects.toThrow();
    await expect(asUser(kale.id, (tx) => tx.update(noteSections).set({ createdBy: casey.id }).where(link))).rejects.toThrow();
    // An Advisor cannot take it out.
    const byAdvisor = await asUser(karen.id, (tx) =>
      tx.update(noteSections).set({ removedAt: now, removedBy: karen.id }).where(link).returning(),
    );
    expect(byAdvisor).toHaveLength(0);
    // Not in someone else's name.
    await expect(
      asUser(casey.id, (tx) => tx.update(noteSections).set({ removedAt: now, removedBy: kale.id }).where(link)),
    ).rejects.toThrow();
    const out = await asUser(casey.id, (tx) =>
      tx.update(noteSections).set({ removedAt: now, removedBy: casey.id }).where(link).returning(),
    );
    expect(out).toHaveLength(1);
    // Once out, the record of it cannot be re-stamped or undone.
    await expect(
      asUser(casey.id, (tx) => tx.update(noteSections).set({ removedAt: new Date(0), removedBy: casey.id }).where(link)),
    ).rejects.toThrow();
    await expect(
      asUser(kale.id, (tx) => tx.update(noteSections).set({ removedAt: null, removedBy: null }).where(link)),
    ).rejects.toThrow();
    const [row] = await asSystem((db) => db.select().from(noteSections).where(link));
    expect(row.removedBy).toBe(casey.id);
    expect(row.createdBy).toBe(kale.id);
  });

  it("refuses a new filing that is already taken out or marked as the AI's", async () => {
    const { kale, casey } = await setup();
    const { id } = await addNote(kale, { body: doc("file me properly") });
    const sectionId = await wages();
    await expect(
      asUser(kale.id, (tx) =>
        tx.insert(noteSections).values({ noteId: id, sectionId, createdBy: kale.id, removedAt: new Date(), removedBy: casey.id }),
      ),
    ).rejects.toThrow();
    await expect(
      asUser(kale.id, (tx) => tx.insert(noteSections).values({ noteId: id, sectionId, createdBy: kale.id, byAi: true })),
    ).rejects.toThrow();
  });
});

describe("database rules: comments", () => {
  it("lets Owners and Advisors comment only in their own name, and never change a comment", async () => {
    const { kale, karen } = await setup();
    const { id } = await addNote(kale, { body: doc("comment on me") });
    await addComment(karen, id, doc("Advisor comment"));
    await expect(
      asUser(karen.id, (tx) =>
        tx.insert(comments).values({ noteId: id, body: doc("as Kale"), bodyText: "as Kale", createdBy: kale.id }),
      ),
    ).rejects.toThrow();
    await expect(asUser(karen.id, (tx) => tx.update(comments).set({ bodyText: "changed" }))).rejects.toThrow();
    await expect(asUser(kale.id, (tx) => tx.update(comments).set({ bodyText: "changed" }))).rejects.toThrow();
    await expect(asUser(kale.id, (tx) => tx.delete(comments))).rejects.toThrow();
    const [row] = await asSystem((db) => db.select().from(comments).where(eq(comments.noteId, id)));
    expect(row.bodyText).toBe("Advisor comment");
  });

  it("refuses comments from someone who has been removed", async () => {
    const { kale } = await setup();
    const gone = await insertUser("Gone", "gone@example.com", "advisor");
    const { id } = await addNote(kale, { body: doc("another note") });
    const { users } = await import("@/db/schema");
    await asSystem((db) => db.update(users).set({ removedAt: new Date() }).where(eq(users.id, gone.id)));
    await expect(
      asUser(gone.id, (tx) =>
        tx.insert(comments).values({ noteId: id, body: doc("late"), bodyText: "late", createdBy: gone.id }),
      ),
    ).rejects.toThrow();
  });
});

describe("database rules: settings", () => {
  it("can be read by everyone signed in but changed only by Owners", async () => {
    const { kale, karen } = await setup();
    await asUser(kale.id, (tx) => tx.insert(settings).values({ key: "stale_days", value: 45, updatedBy: kale.id }));
    expect((await asUser(karen.id, (tx) => tx.select().from(settings))).length).toBe(1);
    await expect(asUser(karen.id, (tx) => tx.insert(settings).values({ key: "opening_date", value: "2030-01-01" }))).rejects.toThrow();
    const changed = await asUser(karen.id, (tx) => tx.update(settings).set({ value: 1 }).returning());
    expect(changed).toHaveLength(0);
    await expect(asUser(kale.id, (tx) => tx.delete(settings))).rejects.toThrow();
    // And only in your own name.
    const casey = await actorFor("casey@example.com");
    await expect(
      asUser(kale.id, (tx) => tx.insert(settings).values({ key: "opening_date", value: "2027-03-01", updatedBy: casey.id })),
    ).rejects.toThrow();
    await expect(
      asUser(kale.id, (tx) => tx.update(settings).set({ value: 60, updatedBy: casey.id }).where(eq(settings.key, "stale_days"))),
    ).rejects.toThrow();
  });
});
