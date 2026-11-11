import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { asSystem, asUser } from "@/db/client";
import { dailyLogs, notes, sections, users } from "@/db/schema";
import { addNote, removeNote, restoreNote, setNoteSorted } from "@/lib/notes";
import { saveOfficial } from "@/lib/official";
import type { Actor } from "@/lib/permissions";
import type { RichDoc } from "@/lib/richtext";
import { archiveSection, createSection, moveSection, renameSection, restoreSection } from "@/lib/sections";
import { centralDateKey } from "@/lib/time";
import { addUser, changeUserRole, removeUser } from "@/lib/users";
import { actorFor, fakeMailer, insertUser, refusal, withRealTimeOnly, withTestDatabase } from "./helpers/db";

withTestDatabase();

/**
 * "Who" and "when" on people, sections and notes, straight at the database
 * as the app's limited role. Whatever a request sends, a change is stamped
 * with the person who is signed in, and a time that is sent must be the
 * real time. Exactly one thing is wrong in each attempt, and each test
 * checks WHY it was refused, so no rule can be taken away unnoticed behind
 * another.
 */

const doc = (text: string): RichDoc => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});
const OLD = new Date("2020-01-01T15:00:00Z");
const HOURS = 60 * 60 * 1000;
/** The database's own code and words for "this is not the current time". */
const NOT_NOW = /^PPF02: [\s\S]*must be the current time/;
const isNow = (time: Date | null) => time !== null && Math.abs(time.getTime() - Date.now()) < HOURS;

async function section(title: string) {
  const [row] = await asSystem((db) => db.select().from(sections).where(eq(sections.title, title)));
  if (!row) throw new Error(`No section called ${title}`);
  return row;
}
const personRow = async (id: string) => (await asSystem((db) => db.select().from(users).where(eq(users.id, id))))[0];
const noteRow = async (id: string) => (await asSystem((db) => db.select().from(notes).where(eq(notes.id, id))))[0];

let kale: Actor;
let casey: Actor;
let karen: Actor;

beforeAll(async () => {
  kale = await actorFor("kale@example.com");
  casey = await actorFor("casey@example.com");
  karen = await insertUser("Karen", "karen@example.com", "advisor");
});

describe("database rules: who and when on a person", () => {
  type NewPerson = typeof users.$inferInsert;
  let n = 0;
  /** Kale adds a person straight at the database, with `wrong` changed from what the app sends. */
  const add = (wrong: Partial<NewPerson> = {}) => {
    n += 1;
    return asUser(kale.id, (tx) =>
      tx
        .insert(users)
        .values({ name: `Person ${n}`, email: `person${n}@example.com`, roleKey: "advisor", createdBy: kale.id, updatedBy: kale.id, ...wrong })
        .returning(),
    );
  };
  const change = (id: string, values: Partial<NewPerson>) =>
    asUser(kale.id, (tx) => tx.update(users).set(values).where(eq(users.id, id)).returning());

  it("a person is added in your own name, not removed and not yet signed in", async () => {
    const IN_YOUR_OWN_NAME = /A person can only be added in your own name/;
    const NOT_REMOVED_YET = /A person who is being added has not been removed and has not signed in/;
    expect(await refusal(add({ createdBy: casey.id }))).toMatch(IN_YOUR_OWN_NAME);
    expect(await refusal(add({ createdBy: null }))).toMatch(IN_YOUR_OWN_NAME);
    expect(await refusal(add({ removedAt: new Date() }))).toMatch(NOT_REMOVED_YET);
    expect(await refusal(add({ removedBy: kale.id }))).toMatch(NOT_REMOVED_YET);
    expect(await refusal(add({ lastActiveAt: new Date() }))).toMatch(NOT_REMOVED_YET);

    // "Last changed by / at" are stamped, whatever is sent.
    const [made] = await add({ updatedBy: casey.id, updatedAt: OLD });
    expect(made).toMatchObject({ createdBy: kale.id, updatedBy: kale.id, removedAt: null, lastActiveAt: null });
    expect(made.updatedAt).toEqual(made.createdAt);
  });

  it("a person cannot be added, or removed, at a time in the past", async () => {
    await withRealTimeOnly(async () => {
      expect(await refusal(add({ createdAt: OLD }))).toMatch(NOT_NOW);
      expect(await refusal(add({ createdAt: new Date(Date.now() + 30 * 24 * HOURS) }))).toMatch(NOT_NOW);
      expect(await refusal(change(karen.id, { removedAt: OLD, removedBy: kale.id }))).toMatch(NOT_NOW);
      const [made] = await add({ createdAt: new Date() });
      expect(isNow(made.createdAt)).toBe(true);
      // Through the app, with the real time, everything is accepted.
      const mail = fakeMailer();
      const added = await addUser(kale, { name: "Robin", email: "robin@example.com", roleKey: "advisor" }, { baseUrl: "https://manual.example.com", send: mail.send });
      await changeUserRole(kale, added.userId, "owner");
      await removeUser(kale, added.userId);
      expect(await personRow(added.userId)).toMatchObject({ removedBy: kale.id, updatedBy: kale.id });
      expect(isNow((await personRow(added.userId)).removedAt)).toBe(true);
    });
    // With the switch on (tests and test seeds only) a set time is taken.
    const [dated] = await add({ createdAt: OLD });
    expect(dated.createdAt).toEqual(OLD);
  });

  it("a person is removed in your own name, and brought back with that name cleared", async () => {
    expect(await refusal(change(karen.id, { removedAt: new Date(), removedBy: casey.id }))).toMatch(/A person can only be removed in your own name/);
    expect((await personRow(karen.id)).removedAt).toBeNull();
    // Left empty, it is filled in.
    const [removed] = await change(karen.id, { removedAt: new Date() });
    expect(removed.removedBy).toBe(kale.id);
    // Who removed them cannot be re-written afterwards.
    expect(await refusal(change(karen.id, { removedBy: casey.id }))).toMatch(/Who removed a person is set only when they are removed/);
    expect(await refusal(change(karen.id, { removedBy: null }))).toMatch(/Who removed a person is set only when they are removed/);
    // Re-dating the removal makes it yours.
    expect(await refusal(asUser(casey.id, (tx) => tx.update(users).set({ removedAt: new Date(Date.now() + 1000), removedBy: kale.id }).where(eq(users.id, karen.id))))).toMatch(
      /A person can only be removed in your own name/,
    );
    // Brought back: "removed by" goes with "removed at", even when a name is sent.
    const [back] = await change(karen.id, { removedAt: null, removedBy: casey.id });
    expect(back).toMatchObject({ removedAt: null, removedBy: null });
    // Someone who was never removed has nobody who removed them.
    const [untouched] = await change(karen.id, { removedBy: casey.id });
    expect(untouched.removedBy).toBeNull();
  });

  it("every change to a person is stamped with who made it and when", async () => {
    const [changed] = await change(karen.id, { roleKey: "advisor", updatedBy: casey.id, updatedAt: OLD });
    expect(changed.updatedBy).toBe(kale.id);
    expect(isNow(changed.updatedAt)).toBe(true);
    const [byCasey] = await asUser(casey.id, (tx) => tx.update(users).set({ roleKey: "advisor", updatedBy: kale.id }).where(eq(users.id, karen.id)).returning());
    expect(byCasey.updatedBy).toBe(casey.id);
  });

  it("the name of someone who has signed in cannot be changed", async () => {
    const SIGNED_IN = /The name of a person who has signed in cannot be changed/;
    // Karen has not signed in yet: her name can still be corrected.
    expect(await change(karen.id, { name: "Karen M" })).toMatchObject([{ name: "Karen M" }]);
    expect(await change(karen.id, { name: "Karen" })).toMatchObject([{ name: "Karen" }]);
    // The two Owners have signed in. One query cannot swap their names on everything they approved.
    await asSystem((db) => db.update(users).set({ lastActiveAt: new Date() }));
    expect(await refusal(change(karen.id, { name: "Karen M" }))).toMatch(SIGNED_IN);
    expect(await refusal(change(casey.id, { name: "Tmp" }))).toMatch(SIGNED_IN);
    expect(await refusal(change(kale.id, { name: "Casey B" }))).toMatch(SIGNED_IN);
    // Not while they are removed either, and not in the step that brings them back.
    await removeUser(kale, karen.id);
    expect(await refusal(change(karen.id, { name: "Our accountant" }))).toMatch(SIGNED_IN);
    expect(await refusal(change(karen.id, { name: "Our accountant", removedAt: null, removedBy: null }))).toMatch(SIGNED_IN);
    // Sending the same name again changes nothing and is fine.
    expect(await change(karen.id, { name: "Karen", removedAt: null, removedBy: null })).toMatchObject([{ name: "Karen", removedAt: null }]);
  });

  it("code with full database access (setup, sign-in, a database step) is not bound", async () => {
    // A database step may correct a name, as the step that cleaned up look-alike names did.
    await asSystem((db) => db.update(users).set({ name: "Karen M" }).where(eq(users.id, karen.id)));
    expect((await personRow(karen.id)).name).toBe("Karen M");
    await asSystem((db) => db.update(users).set({ name: "Karen" }).where(eq(users.id, karen.id)));
    // Sign-in stamps "last active" without being anybody.
    const [signedIn] = await asSystem((db) => db.update(users).set({ lastActiveAt: OLD }).where(eq(users.id, karen.id)).returning());
    expect(signedIn.lastActiveAt).toEqual(OLD);
    // First-time setup adds people in nobody's name, and may carry over old records as they were.
    const [carried] = await asSystem((db) =>
      db
        .insert(users)
        .values({ name: "Old Timer", email: "old.timer@example.com", roleKey: "advisor", createdAt: OLD, updatedAt: OLD, lastActiveAt: OLD, removedAt: OLD, removedBy: casey.id })
        .returning(),
    );
    expect(carried).toMatchObject({ createdBy: null, updatedBy: null, removedBy: casey.id });
    expect(carried.updatedAt).toEqual(OLD);
  });
});

describe("database rules: who and when on a section", () => {
  type NewSection = typeof sections.$inferInsert;
  let n = 0;
  const add = (wrong: Partial<NewSection> = {}) => {
    n += 1;
    return asUser(kale.id, (tx) =>
      tx.insert(sections).values({ title: `Made by hand ${n}`, position: 90 + n, createdBy: kale.id, updatedBy: kale.id, ...wrong }).returning(),
    );
  };
  const change = (id: string, values: Partial<NewSection>, by: Actor = kale) =>
    asUser(by.id, (tx) => tx.update(sections).set(values).where(eq(sections.id, id)).returning());

  it("a section is added in your own name, and not already archived", async () => {
    const IN_YOUR_OWN_NAME = /A section can only be added in your own name/;
    const NOT_ARCHIVED = /A section that is being added is not archived/;
    expect(await refusal(add({ createdBy: casey.id }))).toMatch(IN_YOUR_OWN_NAME);
    expect(await refusal(add({ createdBy: null }))).toMatch(IN_YOUR_OWN_NAME);
    expect(await refusal(add({ archivedAt: new Date() }))).toMatch(NOT_ARCHIVED);
    expect(await refusal(add({ archivedBy: kale.id }))).toMatch(NOT_ARCHIVED);
    const [made] = await add({ updatedBy: casey.id, updatedAt: OLD });
    expect(made).toMatchObject({ createdBy: kale.id, updatedBy: kale.id, archivedAt: null });
    expect(made.updatedAt).toEqual(made.createdAt);
  });

  it("when and by whom a section was added never change", async () => {
    const wages = await section("Wages");
    const FIXED = /When and by whom a section was added cannot be changed/;
    expect(await refusal(change(wages.id, { createdAt: new Date() }))).toMatch(FIXED);
    expect(await refusal(change(wages.id, { createdBy: casey.id }))).toMatch(FIXED);
    const [made] = await add();
    expect(await refusal(change(made.id, { createdBy: null }))).toMatch(FIXED);
    expect(await section("Wages")).toMatchObject({ createdAt: wages.createdAt, createdBy: wages.createdBy });
  });

  it("a section is archived in your own name, and restored with that name cleared", async () => {
    const hiring = await section("Hiring");
    expect(await refusal(change(hiring.id, { archivedAt: new Date(), archivedBy: casey.id }))).toMatch(/A section can only be archived in your own name/);
    expect((await section("Hiring")).archivedAt).toBeNull();
    const [archived] = await change(hiring.id, { archivedAt: new Date() });
    expect(archived.archivedBy).toBe(kale.id);
    expect(await refusal(change(hiring.id, { archivedBy: casey.id }))).toMatch(/Who archived a section is set only when it is archived/);
    expect(await refusal(change(hiring.id, { archivedBy: null }))).toMatch(/Who archived a section is set only when it is archived/);
    const [restored] = await change(hiring.id, { archivedAt: null, archivedBy: casey.id });
    expect(restored).toMatchObject({ archivedAt: null, archivedBy: null });
    const [untouched] = await change(hiring.id, { archivedBy: casey.id });
    expect(untouched.archivedBy).toBeNull();
  });

  it("'last updated by' is the person who changed the name or the 'last updated' time, and reordering leaves it alone", async () => {
    const benefits = await section("Benefits");
    // Casey renames it for real, so that she is the one on record.
    await renameSection(casey, benefits.id, "Benefits and Perks");
    expect(await section("Benefits and Perks")).toMatchObject({ updatedBy: casey.id });
    // Kale renames it "by Casey".
    const [renamed] = await change(benefits.id, { title: "Benefits", updatedBy: casey.id, updatedAt: new Date() });
    expect(renamed.updatedBy).toBe(kale.id);
    // Only the name, with nothing said about who or when.
    const [nameOnly] = await change(benefits.id, { title: "Benefits!" }, casey);
    expect(nameOnly.updatedBy).toBe(casey.id);
    // Only the time.
    const [timeOnly] = await change(benefits.id, { updatedAt: new Date(Date.now() + 1000) });
    expect(timeOnly.updatedBy).toBe(kale.id);
    // Only the name of the person (Casey puts Karen's there): it becomes the one who is really doing it.
    const [whoOnly] = await change(benefits.id, { updatedBy: karen.id }, casey);
    expect(whoOnly.updatedBy).toBe(casey.id);
    await renameSection(casey, benefits.id, "Benefits");
    // Moving it up or down is not a change to its content: "last updated" stays Casey's.
    const before = await section("Benefits");
    await moveSection(kale, benefits.id, "up");
    const [moved] = await change(benefits.id, { position: 7 });
    expect(moved).toMatchObject({ updatedBy: casey.id, updatedAt: before.updatedAt });
  });

  it("a section cannot be added, archived or marked as updated at a time in the past", async () => {
    const training = await section("Training");
    await withRealTimeOnly(async () => {
      expect(await refusal(add({ createdAt: OLD }))).toMatch(NOT_NOW);
      expect(await refusal(change(training.id, { archivedAt: OLD, archivedBy: kale.id }))).toMatch(NOT_NOW);
      expect(await refusal(change(training.id, { updatedAt: OLD }))).toMatch(NOT_NOW);
      expect(await refusal(change(training.id, { title: "Training!", updatedAt: new Date(Date.now() + 30 * 24 * HOURS) }))).toMatch(NOT_NOW);
      const [made] = await add({ createdAt: new Date() });
      expect(isNow(made.createdAt)).toBe(true);
      // Through the app, with the real time, everything is accepted.
      const id = await createSection(kale, { parentId: null, title: "Seasonal Plans" });
      await renameSection(casey, id, "Seasonal Plan");
      await saveOfficial(kale, id, doc("Spring: annuals."));
      await archiveSection(casey, id);
      expect((await asSystem((db) => db.select().from(sections).where(eq(sections.id, id))))[0]).toMatchObject({
        createdBy: kale.id,
        updatedBy: kale.id,
        archivedBy: casey.id,
      });
      await restoreSection(kale, id);
      expect((await asSystem((db) => db.select().from(sections).where(eq(sections.id, id))))[0]).toMatchObject({ archivedAt: null, archivedBy: null });
    });
    // With the switch on (tests and test seeds only) a set time is taken.
    const [dated] = await change(training.id, { archivedAt: OLD, archivedBy: kale.id });
    expect(dated.archivedAt).toEqual(OLD);
    await restoreSection(kale, training.id);
  });
});

describe("database rules: who and when on sections and notes, for code with full database access", () => {
  it("is not bound: setup adds sections in nobody's name, and old records can be carried over as they were", async () => {
    const [made] = await asSystem((db) =>
      db
        .insert(sections)
        .values({ title: "Carried over", position: 80, createdAt: OLD, updatedAt: OLD, updatedBy: casey.id, archivedAt: OLD, archivedBy: casey.id })
        .returning(),
    );
    expect(made).toMatchObject({ createdBy: null, updatedBy: casey.id, archivedBy: casey.id });
    expect(made.updatedAt).toEqual(OLD);
    const [changed] = await asSystem((db) =>
      db.update(sections).set({ createdBy: kale.id, title: "Carried over, renamed" }).where(eq(sections.id, made.id)).returning(),
    );
    expect(changed).toMatchObject({ createdBy: kale.id, updatedBy: casey.id });

    await asSystem((db) => db.insert(dailyLogs).values({ logDate: "2020-01-01", createdAt: OLD, createdBy: kale.id }).onConflictDoNothing());
    const [note] = await asSystem((db) =>
      db
        .insert(notes)
        .values({
          logDate: "2020-01-01",
          body: doc("an old note"),
          bodyText: "an old note",
          createdAt: OLD,
          createdBy: kale.id,
          updatedAt: new Date("2020-02-01T15:00:00Z"),
          updatedBy: casey.id,
          sortedAt: OLD,
          sortedBy: casey.id,
        })
        .returning(),
    );
    expect(note).toMatchObject({ updatedBy: casey.id, sortedBy: casey.id });
    expect(note.updatedAt).toEqual(new Date("2020-02-01T15:00:00Z"));
  });
});

describe("database rules: who and when on a note", () => {
  type NewNote = typeof notes.$inferInsert;
  /** Kale adds a note straight at the database, with `extra` on top of what the app sends. */
  const add = async (extra: Partial<NewNote> = {}) => {
    const now = new Date();
    const logDate = centralDateKey(now);
    return asUser(kale.id, async (tx) => {
      await tx.insert(dailyLogs).values({ logDate, createdAt: now, createdBy: kale.id }).onConflictDoNothing();
      return tx
        .insert(notes)
        .values({ logDate, body: doc("a note"), bodyText: "a note", createdAt: now, createdBy: kale.id, updatedAt: now, updatedBy: kale.id, ...extra })
        .returning();
    });
  };
  const change = (id: string, values: Partial<NewNote>) =>
    asUser(kale.id, (tx) => tx.update(notes).set(values).where(eq(notes.id, id)).returning());

  it("a new note is not already sorted, removed or edited, and is last changed by its writer", async () => {
    const PLAIN = /A note that is being added has not been sorted, removed or edited yet/;
    expect(await refusal(add({ sortedAt: OLD }))).toMatch(PLAIN);
    expect(await refusal(add({ sortedBy: casey.id }))).toMatch(PLAIN);
    expect(await refusal(add({ removedAt: OLD }))).toMatch(PLAIN);
    expect(await refusal(add({ removedBy: casey.id }))).toMatch(PLAIN);
    expect(await refusal(add({ editedAt: OLD }))).toMatch(PLAIN);
    const [made] = await add({ updatedBy: casey.id, updatedAt: OLD });
    expect(made).toMatchObject({ createdBy: kale.id, updatedBy: kale.id, sortedAt: null, removedAt: null, editedAt: null });
    expect(made.updatedAt).toEqual(made.createdAt);
  });

  it("a note cannot be marked sorted, or removed, at a time in the past", async () => {
    const { id } = await addNote(kale, { body: doc("Order the pylon sign") });
    await withRealTimeOnly(async () => {
      expect(await refusal(change(id, { sortedAt: OLD, sortedBy: kale.id }))).toMatch(NOT_NOW);
      expect(await refusal(change(id, { removedAt: OLD, removedBy: kale.id }))).toMatch(NOT_NOW);
      expect(await refusal(change(id, { removedAt: new Date(Date.now() + 30 * 24 * HOURS), removedBy: kale.id }))).toMatch(NOT_NOW);
      expect(await noteRow(id)).toMatchObject({ sortedAt: null, removedAt: null });
      // Through the app, with the real time, everything is accepted.
      await setNoteSorted(casey, id, true);
      await removeNote(kale, id);
      const row = await noteRow(id);
      expect(row).toMatchObject({ sortedBy: casey.id, removedBy: kale.id });
      expect(isNow(row.sortedAt) && isNow(row.removedAt)).toBe(true);
      await restoreNote(casey, id);
      await setNoteSorted(kale, id, false);
      expect(await noteRow(id)).toMatchObject({ sortedAt: null, sortedBy: null, removedAt: null, removedBy: null });
    });
    // With the switch on (tests and test seeds only) a set time is taken.
    const [dated] = await change(id, { sortedAt: OLD, sortedBy: kale.id });
    expect(dated.sortedAt).toEqual(OLD);
  });
});
