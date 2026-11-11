import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { asSystem, asUser } from "@/db/client";
import {
  activityLog,
  approvals,
  comments,
  dailyLogs,
  endorsements,
  noteSections,
  notes,
  officialVersions,
  proposalNotes,
  proposals,
  sections,
} from "@/db/schema";
import { addNote } from "@/lib/notes";
import { loadOfficial, saveOfficial } from "@/lib/official";
import type { Actor } from "@/lib/permissions";
import { approveAlone, createProposal, listOneOwnerDecisions } from "@/lib/proposals";
import type { RichDoc } from "@/lib/richtext";
import { centralDateKey } from "@/lib/time";
import { actorFor, insertUser, refusal, withRealTimeOnly, withTestDatabase } from "./helpers/db";

withTestDatabase();

/**
 * "When" is part of every record (who approved, and when). Through the
 * app's limited role the database only accepts the real time on a new
 * record, so nothing can be dated into the past (for example to slip a
 * one-person approval past its 14 days on Today) or into the future.
 *
 * Every other test file runs with the `allow_set_time` switch on, so that
 * tests can build history through the rules' own `now` options. These tests
 * take the switch away for their duration, which is how the app always runs.
 */

const doc = (text: string): RichDoc => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

async function section(title: string): Promise<string> {
  const [row] = await asSystem((db) => db.select().from(sections).where(eq(sections.title, title)));
  return row.id;
}

const OLD = new Date("2026-06-01T15:00:00Z");
const FUTURE = new Date(Date.now() + 30 * 86_400_000);
const HOURS = 60 * 60 * 1000;
/** What the database says, with its own error code for this rule. */
const NOT_NOW = /^PPF02: [\s\S]*must be the current time/;

let kale: Actor;
let casey: Actor;
let karen: Actor;

beforeAll(async () => {
  kale = await actorFor("kale@example.com");
  casey = await actorFor("casey@example.com");
  karen = await insertUser("Karen", "karen@example.com", "advisor");
});

async function propose(by: Actor, sectionTitle: string, text: string): Promise<string> {
  return createProposal(by, { kind: "decision", sectionId: await section(sectionTitle), title: text, proposedOfficial: doc(text) });
}

describe("database rules: times are the real time", () => {
  it("a proposal cannot be dated in the past or the future", async () => {
    const wages = await section("Wages");
    const insert = (createdAt?: Date) =>
      asUser(kale.id, (tx) =>
        tx
          .insert(proposals)
          .values({ type: "decision", title: "Dated", sectionId: wages, proposedOfficial: doc("x"), proposedOfficialText: "x", proposedBy: kale.id, createdAt })
          .returning(),
      );
    await withRealTimeOnly(async () => {
      expect(await refusal(insert(OLD))).toMatch(NOT_NOW);
      expect(await refusal(insert(FUTURE))).toMatch(NOT_NOW);
      // Two hours off is refused; half an hour either way is allowed, so a
      // clock that is a little off never stops the app from working.
      expect(await refusal(insert(new Date(Date.now() - 2 * HOURS)))).toMatch(NOT_NOW);
      expect(await refusal(insert(new Date(Date.now() + 2 * HOURS)))).toMatch(NOT_NOW);
      expect(await insert(new Date(Date.now() - HOURS / 2))).toHaveLength(1);
      expect(await insert(new Date(Date.now() + HOURS / 2))).toHaveLength(1);
      expect(await insert(new Date())).toHaveLength(1);
      expect(await insert()).toHaveLength(1);
    });
    // With the switch on (as in every other test file) a set time is taken.
    expect(await insert(OLD)).toMatchObject([{ createdAt: OLD }]);
  });

  it("an approval and an endorsement cannot be dated in the past or the future", async () => {
    const id = await propose(kale, "Benefits", "Benefits text.");
    const approve = (createdAt: Date) =>
      asUser(casey.id, (tx) => tx.insert(approvals).values({ proposalId: id, userId: casey.id, revision: 1, createdAt }).returning());
    const endorse = (createdAt: Date) =>
      asUser(karen.id, (tx) => tx.insert(endorsements).values({ proposalId: id, userId: karen.id, revision: 1, createdAt }).returning());
    await withRealTimeOnly(async () => {
      expect(await refusal(approve(OLD))).toMatch(NOT_NOW);
      expect(await refusal(approve(FUTURE))).toMatch(NOT_NOW);
      expect(await refusal(endorse(OLD))).toMatch(NOT_NOW);
      expect(await refusal(endorse(FUTURE))).toMatch(NOT_NOW);
      expect(await approve(new Date())).toHaveLength(1);
      expect(await endorse(new Date())).toHaveLength(1);
    });
  });

  it("a decision cannot be dated in the past or the future, and neither can the version it saves", async () => {
    const hiring = await section("Hiring");
    const id = await propose(kale, "Hiring", "Hiring text.");
    const decline = (decidedAt?: Date) =>
      asUser(casey.id, (tx) =>
        tx.update(proposals).set({ status: "declined", decidedBy: casey.id, decidedAt }).where(eq(proposals.id, id)).returning(),
      );
    /** Kale approves alone and saves the version, the way the app does, with the two times given. */
    const approve = (proposalId: string, times: { decidedAt?: Date; createdAt?: Date }) =>
      asUser(kale.id, async (tx) => {
        await tx.update(proposals).set({ status: "approved", decidedBy: kale.id, decidedAt: times.decidedAt }).where(eq(proposals.id, proposalId));
        return tx
          .insert(officialVersions)
          .values({ sectionId: hiring, version: 1, content: doc("Hiring text."), contentText: "Hiring text.", createdBy: kale.id, proposalId, createdAt: times.createdAt })
          .returning();
      });
    await withRealTimeOnly(async () => {
      expect(await refusal(decline(OLD))).toMatch(NOT_NOW);
      expect(await refusal(decline(FUTURE))).toMatch(NOT_NOW);
      // Approving alone five months ago would keep it off the other Owner's Today list.
      expect(await refusal(approve(id, { decidedAt: OLD }))).toMatch(NOT_NOW);
      expect(await refusal(approve(id, { decidedAt: FUTURE }))).toMatch(NOT_NOW);
      expect(await refusal(approve(id, { createdAt: OLD }))).toMatch(NOT_NOW);
      expect(await refusal(approve(id, { createdAt: FUTURE }))).toMatch(NOT_NOW);

      const [version] = await approve(id, { decidedAt: new Date(), createdAt: new Date() });
      expect(Math.abs(version.createdAt.getTime() - Date.now())).toBeLessThan(HOURS);
      expect((await asSystem((db) => listOneOwnerDecisions(db))).map((d) => d.id)).toContain(id);

      const other = await propose(kale, "Hiring", "Hiring text, second.");
      const [declined] = await asUser(casey.id, (tx) =>
        tx.update(proposals).set({ status: "declined", decidedBy: casey.id, decidedAt: new Date() }).where(eq(proposals.id, other)).returning(),
      );
      expect(declined.status).toBe("declined");
      // Left empty, the database fills in the time itself.
      const third = await propose(kale, "Hiring", "Hiring text, third.");
      const [filled] = await asUser(casey.id, (tx) =>
        tx.update(proposals).set({ status: "declined", decidedBy: casey.id }).where(eq(proposals.id, third)).returning(),
      );
      expect(Math.abs(filled.decidedAt!.getTime() - Date.now())).toBeLessThan(HOURS);
    });
  });

  it("a comment and an activity-log entry cannot be dated in the past or the future", async () => {
    const id = await propose(kale, "Training", "Training text.");
    const comment = (createdAt: Date) =>
      asUser(karen.id, (tx) =>
        tx.insert(comments).values({ proposalId: id, body: doc("hi"), bodyText: "hi", createdBy: karen.id, createdAt }).returning(),
      );
    const log = (at: Date) =>
      asUser(karen.id, (tx) =>
        tx.insert(activityLog).values({ userId: karen.id, at, action: "comment.added", entityType: "proposal", entityId: id, summary: "Commented" }).returning(),
      );
    await withRealTimeOnly(async () => {
      expect(await refusal(comment(new Date("2020-01-01T00:00:00Z")))).toMatch(NOT_NOW);
      expect(await refusal(comment(FUTURE))).toMatch(NOT_NOW);
      expect(await refusal(log(new Date("2026-01-01T00:00:00Z")))).toMatch(NOT_NOW);
      expect(await refusal(log(FUTURE))).toMatch(NOT_NOW);
      expect(await comment(new Date())).toHaveLength(1);
      expect(await log(new Date())).toHaveLength(1);
    });
  });

  it("a note, its day, its filing and a proposal's source note cannot be dated in the past or the future", async () => {
    const wages = await section("Wages");
    // An earlier day with a note already on it (made while set times are allowed).
    const earlier = await addNote(kale, { body: doc("written back then"), now: OLD });
    const id = await propose(kale, "Policies and Expectations", "Policies text.");
    const note = (createdAt: Date) =>
      asUser(kale.id, (tx) =>
        tx
          .insert(notes)
          .values({ logDate: centralDateKey(createdAt), body: doc("a note"), bodyText: "a note", createdBy: kale.id, createdAt })
          .returning(),
      );
    const day = (createdAt: Date) =>
      asUser(kale.id, (tx) => tx.insert(dailyLogs).values({ logDate: "2026-06-02", createdAt, createdBy: kale.id }).returning());
    const filing = (createdAt: Date) =>
      asUser(kale.id, (tx) => tx.insert(noteSections).values({ noteId: earlier.id, sectionId: wages, createdBy: kale.id, createdAt }).returning());
    const source = (createdAt: Date) =>
      asUser(kale.id, (tx) => tx.insert(proposalNotes).values({ proposalId: id, noteId: earlier.id, createdBy: kale.id, createdAt }).returning());
    await withRealTimeOnly(async () => {
      // The day OLD falls on exists, so only the note's own time is wrong.
      expect(await refusal(note(OLD))).toMatch(NOT_NOW);
      expect(await refusal(note(FUTURE))).toMatch(NOT_NOW);
      expect(await refusal(day(new Date("2026-06-02T15:00:00Z")))).toMatch(NOT_NOW);
      expect(await refusal(day(FUTURE))).toMatch(NOT_NOW);
      expect(await refusal(filing(OLD))).toMatch(NOT_NOW);
      expect(await refusal(filing(FUTURE))).toMatch(NOT_NOW);
      expect(await refusal(source(OLD))).toMatch(NOT_NOW);
      expect(await refusal(source(FUTURE))).toMatch(NOT_NOW);

      // Through the app, with the real time, everything is accepted.
      const today = await addNote(kale, { body: doc("written today") });
      expect(today.logDate).toBe(centralDateKey(new Date()));
      expect(await note(new Date())).toHaveLength(1);
      expect(await filing(new Date())).toHaveLength(1);
      expect(await source(new Date())).toHaveLength(1);
    });
  });

  it("the app's own functions cannot be used to back-date either", async () => {
    const budget = await section("Budget");
    const id = await propose(kale, "Quotes", "Quotes text.");
    await withRealTimeOnly(async () => {
      expect(await refusal(saveOfficial(kale, budget, doc("Budget, back-dated."), { now: OLD }))).toMatch(NOT_NOW);
      expect(await refusal(addNote(kale, { body: doc("back-dated"), now: OLD }))).toMatch(NOT_NOW);
      expect(await refusal(approveAlone(kale, id, { revision: 1, currentVersionId: null }, { now: OLD }))).toMatch(NOT_NOW);
      expect(await refusal(createProposal(kale, { kind: "decision", sectionId: budget, title: "Back-dated", proposedOfficial: doc("y") }, { now: OLD }))).toMatch(NOT_NOW);
      expect(await asSystem((db) => loadOfficial(db, budget))).toBeNull();

      // The same, without a time: saved now.
      expect(await saveOfficial(kale, budget, doc("Budget, today."))).toEqual({ changed: true, version: 1 });
      await approveAlone(kale, id, { revision: 1, currentVersionId: null });
      const saved = await asSystem((db) => loadOfficial(db, budget));
      expect(Math.abs(saved!.savedAt.getTime() - Date.now())).toBeLessThan(HOURS);
    });
  });

  it("only binds the app's role, and only someone with full database access can lift it", async () => {
    await withRealTimeOnly(async () => {
      const allowed = async (userId: string) => {
        const result = await asUser(userId, (tx) => tx.execute(sql`select public.time_may_be_set() as allowed`));
        const rows = (Array.isArray(result) ? result : (result as { rows: unknown[] }).rows) as { allowed: boolean }[];
        return rows[0].allowed;
      };
      expect(await allowed(kale.id)).toBe(false);
      // Carrying over old records is a job for code with full database access, which is not bound.
      const [carried] = await asSystem((db) =>
        db.insert(activityLog).values({ at: OLD, action: "carried.over", entityType: "test", summary: "Carried over" }).returning(),
      );
      expect(carried.at).toEqual(OLD);
    });
  });

  it("is attached to every table that records when something happened", async () => {
    const result = await asSystem((db) =>
      db.execute(sql`
        select c.relname as "table",
               replace(encode(t.tgargs, 'escape'), '\\000', '') as "column",
               (t.tgtype & 2) <> 0 as before,
               (t.tgtype & 4) <> 0 as on_insert,
               (t.tgtype & 16) <> 0 as on_update,
               t.tgenabled::text as enabled
        from pg_trigger t
        join pg_class c on c.oid = t.tgrelid
        join pg_proc p on p.oid = t.tgfoid
        where p.proname = 'recent_time_only' and not t.tgisinternal
      `),
    );
    type Found = { table: string; column: string; before: boolean; on_insert: boolean; on_update: boolean; enabled: string };
    const found = (Array.isArray(result) ? result : (result as { rows: unknown[] }).rows) as Found[];
    expect(found.every((t) => t.before && t.enabled === "O")).toBe(true);
    expect(found.map((t) => `${t.table}.${t.column} on ${t.on_insert ? "insert" : ""}${t.on_update ? "update" : ""}`).sort()).toEqual([
      "activity_log.at on insert",
      "approvals.created_at on insert",
      "comments.created_at on insert",
      "daily_logs.created_at on insert",
      "endorsements.created_at on insert",
      "note_revisions.created_at on insert",
      "note_sections.created_at on insert",
      "notes.created_at on insert",
      "notes.removed_at on update",
      "notes.sorted_at on update",
      "official_versions.created_at on insert",
      "proposal_notes.created_at on insert",
      "proposals.created_at on insert",
      "proposals.decided_at on update",
      "sections.archived_at on update",
      "sections.created_at on insert",
      "sections.updated_at on update",
      "users.created_at on insert",
      "users.removed_at on update",
    ]);
  });
});
