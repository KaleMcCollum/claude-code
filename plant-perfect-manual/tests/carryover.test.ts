import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { type Db, sqlErrorText } from "@/db/client";
import * as schema from "@/db/schema";
import { approvalLine, listVersions, loadOfficial, saveOfficial } from "@/lib/official";
import type { Actor } from "@/lib/permissions";
import {
  type ProposalView,
  activeApprovers,
  approveProposal,
  displayTitle,
  editProposal,
  endorseProposal,
  listDecisions,
  listOneOwnerDecisions,
  listOpenProposals,
  loadProposal,
  loadTextChange,
  waitingText,
} from "@/lib/proposals";
import { docToText } from "@/lib/richtext";
import { loadTree } from "@/lib/sections";
import { addUser, removeUser } from "@/lib/users";

/**
 * Official text saved before proposals existed (Phases 1 and 2) must come
 * through the Phase 3 database change with nothing lost: same words, same
 * approvals, same dates. The first test builds the database the old way,
 * saves text the way Phase 1 did, then applies the newer steps on top.
 *
 * The second test does the same for a database that already had proposals
 * (Phase 3 as first built) and then gets the hardening steps. The third
 * starts from the hardened database (step 0009), with people and proposals
 * in every state, and applies the steps from the second review.
 *
 * All write their starting data with full database access, which the rule
 * against back-dating does not bind, so they need no `allow_set_time` switch.
 */

const REAL_FOLDER = path.join(process.cwd(), "drizzle");
/** The last database step of Phase 2. */
const LAST_OLD_STEP = "0004_capture_hardening";
/** The last database step of Phase 3 as it was first built. */
const LAST_PHASE_3_STEP = "0007_decisions_security";
/** The last database step of the Phase 3 hardening. */
const LAST_HARDENING_STEP = "0009_decisions_hardening_security";

type Handle = {
  db: Db;
  migrate: (folder: string) => Promise<void>;
  close: () => Promise<void>;
};

const cleanups: (() => Promise<void>)[] = [];
afterAll(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
});

/** A brand-new, completely empty database on whichever engine the tests run on. */
async function emptyDatabase(): Promise<Handle> {
  const serverUrl = process.env.TEST_DATABASE_URL;
  if (serverUrl) {
    const { default: postgres } = await import("postgres");
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    const name = `ppf_test_carry_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const admin = postgres(serverUrl, { max: 1, onnotice: () => {} });
    await admin.unsafe(`create database ${name}`);
    await admin.end();
    const url = new URL(serverUrl);
    url.pathname = `/${name}`;
    const client = postgres(url.toString(), { prepare: false, max: 1, onnotice: () => {} });
    const db = drizzle(client, { schema });
    return {
      db: db as unknown as Db,
      migrate: (folder) => migrate(db, { migrationsFolder: folder }),
      close: async () => {
        await client.end();
        const again = postgres(serverUrl, { max: 1, onnotice: () => {} });
        await again.unsafe(`drop database if exists ${name}`);
        await again.end();
      },
    };
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const client = new PGlite();
  const db = drizzle(client, { schema });
  return {
    db: db as unknown as Db,
    migrate: (folder) => migrate(db, { migrationsFolder: folder }),
    close: () => client.close(),
  };
}

/** A copy of the database steps that stops after the step called `lastStep`. */
async function oldStepsFolder(lastStep: string = LAST_OLD_STEP): Promise<string> {
  const folder = await mkdtemp(path.join(os.tmpdir(), "ppf-old-steps-"));
  cleanups.push(() => rm(folder, { recursive: true, force: true }));
  await cp(REAL_FOLDER, folder, { recursive: true });
  const journalPath = path.join(folder, "meta", "_journal.json");
  const journal = JSON.parse(await readFile(journalPath, "utf8")) as { entries: { tag: string }[] };
  const last = journal.entries.findIndex((entry) => entry.tag === lastStep);
  if (last < 0) throw new Error(`No database step called ${lastStep}`);
  journal.entries = journal.entries.slice(0, last + 1);
  await writeFile(journalPath, JSON.stringify(journal));
  return folder;
}

/**
 * A copy of all the database steps with one more, made-up step after them
 * (as a later phase might add), so it can be applied the way a deploy does.
 */
async function folderWithLaterStep(statements: string[]): Promise<string> {
  const folder = await mkdtemp(path.join(os.tmpdir(), "ppf-later-step-"));
  cleanups.push(() => rm(folder, { recursive: true, force: true }));
  await cp(REAL_FOLDER, folder, { recursive: true });
  const journalPath = path.join(folder, "meta", "_journal.json");
  const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
    entries: { idx: number; version: string; when: number; tag: string; breakpoints: boolean }[];
  };
  const last = journal.entries.at(-1)!;
  const tag = "9999_made_up_later_step";
  journal.entries.push({ idx: last.idx + 1, version: last.version, when: last.when + 60_000, tag, breakpoints: true });
  await writeFile(journalPath, JSON.stringify(journal));
  await writeFile(path.join(folder, `${tag}.sql`), statements.join("--> statement-breakpoint\n"));
  return folder;
}

/**
 * Let the app's own functions (which open "the" database themselves) work on
 * this test's database for the rest of the test file.
 */
function useAsTheAppDatabase(handle: Handle): void {
  globalThis.__ppfDb = Promise.resolve({ db: handle.db, close: async () => {} });
  cleanups.push(async () => {
    globalThis.__ppfDb = undefined;
  });
}

function rowsOf<T>(result: unknown): T[] {
  return (Array.isArray(result) ? result : (result as { rows: T[] }).rows) as T[];
}

const doc = (text: string) =>
  JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

describe("official text saved before proposals existed", () => {
  it("keeps its words, approvals and dates, and shows up as one-person decisions", async () => {
    const handle = await emptyDatabase();
    cleanups.push(handle.close);
    const { db } = handle;
    await handle.migrate(await oldStepsFolder());

    // The database as it was at the end of Phase 2: no proposals yet.
    const before = rowsOf<{ name: string }>(
      await db.execute(sql`select table_name as name from information_schema.tables where table_schema = 'public'`),
    ).map((t) => t.name);
    expect(before).toContain("official_versions");
    expect(before).not.toContain("proposals");

    const one = async <T>(query: ReturnType<typeof sql>) => rowsOf<T>(await db.execute(query))[0];
    const kale = (await one<{ id: string }>(
      sql`insert into users (name, email, role_key) values ('Kale', 'kale@example.com', 'owner') returning id`,
    )).id;
    const casey = (await one<{ id: string }>(
      sql`insert into users (name, email, role_key) values ('Casey', 'casey@example.com', 'owner') returning id`,
    )).id;
    const karen = (await one<{ id: string }>(
      sql`insert into users (name, email, role_key) values ('Karen', 'karen@example.com', 'advisor') returning id`,
    )).id;
    const wages = (await one<{ id: string }>(
      sql`insert into sections (title, position, created_by, updated_by) values ('Wages', 1, ${kale}, ${kale}) returning id`,
    )).id;
    const hours = (await one<{ id: string }>(
      sql`insert into sections (title, position, created_by, updated_by) values ('Store Hours', 2, ${kale}, ${kale}) returning id`,
    )).id;

    // Phase 1 "Edit official": a version, approved by the Owner who saved it.
    const saveOldWay = async (section: string, version: number, text: string, by: string, at: string) => {
      const { id } = await one<{ id: string }>(sql`
        insert into official_versions (section_id, version, content, content_text, created_by, created_at)
        values (${section}, ${version}, ${doc(text)}::jsonb, ${text}, ${by}, ${at}::timestamptz) returning id`);
      await db.execute(sql`
        insert into approvals (official_version_id, user_id, created_at) values (${id}, ${by}, ${at}::timestamptz)`);
      return id;
    };
    const v1 = await saveOldWay(wages, 1, "Starting wage, Coffee Shop: $13.00/hr.", kale, "2026-11-02T16:00:00Z");
    const v2 = await saveOldWay(wages, 2, "Starting wage, Coffee Shop: $15.00/hr.", casey, "2026-11-09T21:30:00Z");
    const h1 = await saveOldWay(hours, 1, "Open 9 to 6, every day.", kale, "2026-09-01T15:00:00Z");
    // The second Owner had added an approval to one of them (Phase 1 allowed that).
    const h2 = await saveOldWay(hours, 2, "Open 9 to 7, every day.", kale, "2026-11-05T15:00:00Z");
    await db.execute(sql`
      insert into approvals (official_version_id, user_id, created_at) values (${h2}, ${casey}, '2026-11-06T15:00:00Z'::timestamptz)`);
    // Two people who were given the same name (one of them removed since),
    // and a third whose name is what the second would otherwise be renamed to.
    const otherCasey = (await one<{ id: string }>(
      sql`insert into users (name, email, role_key, removed_at, created_at)
          values ('casey', 'kale.other@example.com', 'owner', now(), now() + interval '1 second') returning id`,
    )).id;
    const caseyTwo = (await one<{ id: string }>(
      sql`insert into users (name, email, role_key) values ('Casey (2)', 'casey.two@example.com', 'advisor') returning id`,
    )).id;

    // A Phase 2 note with a comment, which must also come through untouched.
    await db.execute(sql`insert into daily_logs (log_date, created_by) values ('2026-11-08', ${kale})`);
    const note = (await one<{ id: string }>(sql`
      insert into notes (body, body_text, log_date, created_by, updated_by, created_at)
      values (${doc("Karen thinks $15 is right")}::jsonb, 'Karen thinks $15 is right', '2026-11-08', ${kale}, ${kale}, '2026-11-08T18:00:00Z')
      returning id`)).id;
    await db.execute(sql`
      insert into comments (note_id, body, body_text, created_by)
      values (${note}, ${doc("Agreed.")}::jsonb, 'Agreed.', ${karen})`);

    // Now the Phase 3 steps.
    await handle.migrate(REAL_FOLDER);

    // Every old version has a proposal of its own, already approved.
    const carried = await db.select().from(schema.proposals);
    expect(carried.map((p) => p.id).sort()).toEqual([v1, v2, h1, h2].sort());
    const second = carried.find((p) => p.id === v2)!;
    expect(second).toMatchObject({
      type: "official_text",
      title: "Edited directly",
      direct: true,
      status: "approved",
      sectionId: wages,
      baseVersionId: v1,
      proposedBy: casey,
      decidedBy: casey,
      proposedOfficialText: "Starting wage, Coffee Shop: $15.00/hr.",
      revision: 1,
    });
    expect(second.decidedAt?.toISOString()).toBe("2026-11-09T21:30:00.000Z");
    expect(second.createdAt.toISOString()).toBe("2026-11-09T21:30:00.000Z");
    expect(carried.find((p) => p.id === v1)?.baseVersionId).toBeNull();

    // The approvals moved onto those proposals; the old column is gone.
    const approvalRows = await db.select().from(schema.approvals);
    expect(approvalRows.map((a) => `${a.proposalId}:${a.userId}`).sort()).toEqual(
      [`${v1}:${kale}`, `${v2}:${casey}`, `${h1}:${kale}`, `${h2}:${kale}`, `${h2}:${casey}`].sort(),
    );
    // Each approval was given on its proposal's one and only wording.
    expect(approvalRows.map((a) => a.revision)).toEqual([1, 1, 1, 1, 1]);
    // Whether one person decided: yes where there is one approval, no where there are two.
    const alone = (id: string) => carried.find((p) => p.id === id)?.decidedAlone;
    expect([alone(v1), alone(v2), alone(h1), alone(h2)]).toEqual([true, true, true, false]);
    // Nothing carried over is tied to a deciding transaction, so no version can be added to it.
    expect(carried.map((p) => p.decidedTxid)).toEqual([null, null, null, null]);
    const columns = rowsOf<{ name: string }>(
      await db.execute(
        sql`select column_name as name from information_schema.columns where table_name = 'approvals'`,
      ),
    ).map((c) => c.name);
    expect(columns).not.toContain("official_version_id");

    // The app reads it exactly as before: same words, same approval line.
    const current = await loadOfficial(db, wages);
    expect(current).toMatchObject({ id: v2, version: 2, origin: "direct", proposedByName: "Casey" });
    expect(JSON.stringify(current!.content)).toContain("Starting wage, Coffee Shop: $15.00/hr.");
    expect(approvalLine(current!.approvals)).toBe("Approved by Casey, Nov 9, 2026");
    const history = await listVersions(db, wages);
    expect(history.map((v) => [v.version, approvalLine(v.approvals)])).toEqual([
      [2, "Approved by Casey, Nov 9, 2026"],
      [1, "Approved by Kale, Nov 2, 2026"],
    ]);
    expect((await loadProposal(db, v2))?.approvals.map((a) => a.name)).toEqual(["Casey"]);

    // They are decisions like any other: in the log, and flagged for the
    // other Owner while recent and still the current text.
    const tree = await loadTree(db);
    const log = await listDecisions(db, tree, {}, 50);
    expect(log.map((p) => p.id)).toEqual([v2, h2, v1, h1]);
    // Flagged for the other Owner while recent: both one-person changes to
    // Wages (the older one marked as no longer the current text), not the
    // one both approved, and not the one from September.
    const flagged = await listOneOwnerDecisions(db, new Date("2026-11-11T18:00:00Z"));
    expect(flagged.map((p) => [p.id, p.superseded])).toEqual([
      [v2, false],
      [v1, true],
    ]);
    expect((await loadProposal(db, h2))?.approvals.map((a) => a.name)).toEqual(["Kale", "Casey"]);
    expect(await loadProposal(db, h2)).toMatchObject({ decidedAlone: false, soloOpen: false, superseded: false });
    expect(await loadProposal(db, h1)).toMatchObject({ decidedAlone: true, soloOpen: true, superseded: true });

    // The two people called Casey can be told apart: the one added later was
    // renamed, the change is in the activity log, and it cannot happen again.
    const names = await db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users);
    expect(names.find((u) => u.id === casey)?.name).toBe("Casey");
    expect(names.find((u) => u.id === caseyTwo)?.name).toBe("Casey (2)");
    expect(names.find((u) => u.id === otherCasey)?.name).toBe("casey (3)");
    const renames = await db.select().from(schema.activityLog);
    expect(renames.map((e) => [e.action, e.entityId, e.summary, e.userId])).toEqual([
      ["user.renamed", otherCasey, "Renamed casey to casey (3), because two people had the same name", null],
    ]);
    await expect(
      db.execute(sql`insert into users (name, email, role_key) values ('KALE', 'kale.two@example.com', 'advisor')`),
    ).rejects.toThrow();

    // The note and its comment are still there, and comments still need a subject.
    const commentRows = await db.select().from(schema.comments);
    expect(commentRows).toHaveLength(1);
    expect(commentRows[0]).toMatchObject({ noteId: note, proposalId: null, bodyText: "Agreed." });
    await expect(
      db.execute(sql`insert into comments (body, body_text, created_by) values (${doc("x")}::jsonb, 'x', ${karen})`),
    ).rejects.toThrow();
  });
});

describe("proposals made before the hardening steps", () => {
  it("keep everything, and each approval and endorsement is tied to its proposal's wording", async () => {
    const handle = await emptyDatabase();
    cleanups.push(handle.close);
    const { db } = handle;
    await handle.migrate(await oldStepsFolder(LAST_PHASE_3_STEP));

    const one = async <T>(query: ReturnType<typeof sql>) => rowsOf<T>(await db.execute(query))[0];
    const person = async (name: string, email: string, role: string) =>
      (await one<{ id: string }>(sql`insert into users (name, email, role_key) values (${name}, ${email}, ${role}) returning id`)).id;
    const kale = await person("Kale", "kale@example.com", "owner");
    const casey = await person("Casey", "casey@example.com", "owner");
    const karen = await person("Karen", "karen@example.com", "advisor");
    const wages = (await one<{ id: string }>(
      sql`insert into sections (title, position, created_by, updated_by) values ('Wages', 1, ${kale}, ${kale}) returning id`,
    )).id;

    // As Phase 3 stored them. An open proposal that its proposer changed
    // twice (revision 3) before Karen endorsed it:
    const open = (await one<{ id: string }>(sql`
      insert into proposals (type, title, section_id, proposed_official, proposed_official_text, proposed_by, revision, created_at)
      values ('decision', 'Raise to $16', ${wages}, ${doc("$16.00/hr")}::jsonb, '$16.00/hr', ${kale}, 3, '2026-11-08T15:00:00Z') returning id`)).id;
    await db.execute(sql`insert into approvals (proposal_id, user_id, created_at) values (${open}, ${kale}, '2026-11-08T15:00:00Z')`);
    await db.execute(sql`insert into endorsements (proposal_id, user_id, created_at) values (${open}, ${karen}, '2026-11-09T15:00:00Z')`);
    // An approved proposal with its version: approved by one person, or by both.
    const approved = async (title: string, text: string, version: number, at: string, approvers: string[]) => {
      const { id } = await one<{ id: string }>(sql`
        insert into proposals (type, title, section_id, proposed_official, proposed_official_text, proposed_by, status, decided_at, decided_by, created_at)
        values ('decision', ${title}, ${wages}, ${doc(text)}::jsonb, ${text}, ${approvers[0]}, 'approved', ${at}::timestamptz, ${approvers.at(-1)!}, ${at}::timestamptz)
        returning id`);
      // One minute apart, in the order given.
      for (const [index, who] of approvers.entries()) {
        await db.execute(sql`
          insert into approvals (proposal_id, user_id, created_at)
          values (${id}, ${who}, ${at}::timestamptz + ${index} * interval '1 minute')`);
      }
      await db.execute(sql`
        insert into official_versions (section_id, version, content, content_text, created_by, created_at, proposal_id)
        values (${wages}, ${version}, ${doc(text)}::jsonb, ${text}, ${approvers.at(-1)!}, ${at}::timestamptz, ${id})`);
      return id;
    };
    const both = await approved("Start at $14", "$14.00/hr", 1, "2026-11-03T15:00:00Z", [kale, casey]);
    const solo = await approved("Start at $15", "$15.00/hr", 2, "2026-11-07T15:00:00Z", [casey]);
    // An open structure proposal.
    const structure = (await one<{ id: string }>(sql`
      insert into proposals (type, title, section_id, structure_change, proposed_by)
      values ('structure', 'Archive 1 Wages', ${wages}, '{"action":"archive"}'::jsonb, ${casey}) returning id`)).id;
    await db.execute(sql`insert into approvals (proposal_id, user_id) values (${structure}, ${casey})`);

    // Now the hardening steps.
    await handle.migrate(REAL_FOLDER);

    const proposalRows = await db.select().from(schema.proposals);
    const byId = (id: string) => proposalRows.find((p) => p.id === id)!;
    expect(proposalRows).toHaveLength(4);
    expect(byId(open)).toMatchObject({ status: "open", revision: 3, decidedAlone: false, decidedTxid: null });
    expect(byId(both)).toMatchObject({ status: "approved", decidedAlone: false, decidedTxid: null });
    expect(byId(solo)).toMatchObject({ status: "approved", decidedAlone: true, decidedTxid: null });
    expect(byId(solo).decidedAt?.toISOString()).toBe("2026-11-07T15:00:00.000Z");
    expect(byId(structure)).toMatchObject({ status: "open", structureChange: { action: "archive" } });

    const approvalRows = await db.select().from(schema.approvals);
    const revisionOf = (proposalId: string, userId: string) =>
      approvalRows.find((a) => a.proposalId === proposalId && a.userId === userId)?.revision;
    expect(approvalRows).toHaveLength(5);
    expect([revisionOf(open, kale), revisionOf(both, kale), revisionOf(both, casey), revisionOf(solo, casey), revisionOf(structure, casey)]).toEqual([
      3, 1, 1, 1, 1,
    ]);
    const endorsementRows = await db.select().from(schema.endorsements);
    expect(endorsementRows.map((e) => [e.proposalId, e.userId, e.revision, e.createdAt.toISOString()])).toEqual([
      [open, karen, 3, "2026-11-09T15:00:00.000Z"],
    ]);

    // The app reads them as before, with the new answers filled in.
    expect(await loadProposal(db, solo)).toMatchObject({ decidedAlone: true, soloOpen: true, superseded: false, resultVersion: { version: 2 } });
    expect(await loadProposal(db, both)).toMatchObject({ decidedAlone: false, soloOpen: false, superseded: true, resultVersion: { version: 1 } });
    const flagged = await listOneOwnerDecisions(db, new Date("2026-11-11T18:00:00Z"));
    expect(flagged.map((p) => p.id)).toEqual([solo]);
    expect((await listVersions(db, wages)).map((v) => [v.version, approvalLine(v.approvals)])).toEqual([
      [2, "Approved by Casey, Nov 7, 2026"],
      [1, "Approved by Kale and Casey, Nov 3, 2026"],
    ]);

    // The new rules hold for what was carried over. An endorsement given on
    // older wording than the proposal's is refused; one on its wording is taken.
    await expect(
      db.execute(sql`insert into endorsements (proposal_id, user_id, revision) values (${open}, ${casey}, 1)`),
    ).rejects.toThrow();
    await db.execute(sql`insert into endorsements (proposal_id, user_id, revision) values (${open}, ${casey}, 3)`);
    // A decided proposal still cannot be changed (the rule was switched off only for the carry-over itself).
    await expect(db.execute(sql`update proposals set title = 'Rewritten' where id = ${solo}`)).rejects.toThrow();
    await expect(db.execute(sql`update proposals set decided_alone = false where id = ${solo}`)).rejects.toThrow();

    // A trap for a later database step. Since step 0009 every proposal that
    // a step touches leaves a check waiting for the end of the transaction,
    // and the database refuses to alter the table while checks are waiting.
    // A deploy runs all its steps in one transaction, so a step that fills in
    // old proposals the way 0008 did (guard off, update, guard on) would stop
    // the deploy. It only shows on a database that already holds proposals,
    // like this one: on an empty database every such step passes. (Both the
    // embedded database and a real Postgres server refuse it here.)
    const fillIn = (settle: boolean) => [
      `ALTER TABLE "proposals" ADD COLUMN "made_up_note" text;`,
      `ALTER TABLE "proposals" DISABLE TRIGGER proposals_guard;`,
      `UPDATE "proposals" SET "made_up_note" = 'filled in';`,
      ...(settle ? [`SET CONSTRAINTS ALL IMMEDIATE;`] : []),
      `ALTER TABLE "proposals" ENABLE TRIGGER proposals_guard;`,
      `ALTER TABLE "proposals" ALTER COLUMN "made_up_note" SET NOT NULL;`,
    ];
    // Written the old way, the step is refused and nothing of it stays.
    const oldWay = await handle.migrate(await folderWithLaterStep(fillIn(false))).then(
      () => "It was accepted.",
      (error: unknown) => sqlErrorText(error),
    );
    expect(oldWay).toMatch(/cannot ALTER TABLE "proposals" because it has pending trigger events/);
    const columns = rowsOf<{ name: string }>(
      await db.execute(sql`select column_name as name from information_schema.columns where table_name = 'proposals'`),
    ).map((c) => c.name);
    expect(columns).not.toContain("made_up_note");
    // Written as CLAUDE.md says (run the waiting checks before altering the table again), it goes through.
    await handle.migrate(await folderWithLaterStep(fillIn(true)));
    const filled = rowsOf<{ note: string }>(await db.execute(sql`select made_up_note as note from proposals`));
    expect(filled.map((r) => r.note)).toEqual(["filled in", "filled in", "filled in", "filled in"]);
    // The guard is back on afterwards.
    await expect(db.execute(sql`update proposals set title = 'Rewritten' where id = ${solo}`)).rejects.toThrow();
  });
});

describe("a hardened database that gets the steps from the second review", () => {
  it("keeps its people and its proposals in every state, cleans up names that only look different, and carries on working", async () => {
    const handle = await emptyDatabase();
    cleanups.push(handle.close);
    const { db } = handle;
    await handle.migrate(await oldStepsFolder(LAST_HARDENING_STEP));

    const one = async <T>(query: ReturnType<typeof sql>) => rowsOf<T>(await db.execute(query))[0];
    // (Characters that draw nothing are made from their numbers, never typed.)
    const ZERO_WIDTH_SPACE = String.fromCodePoint(0x200b);
    const SOFT_HYPHEN = String.fromCodePoint(0x00ad);
    const person = async (name: string, email: string, role: string, was: { signedIn: boolean; removed?: boolean; minutesLater?: number }) =>
      (
        await one<{ id: string }>(sql`
          insert into users (name, email, role_key, last_active_at, removed_at, created_at)
          values (${name}, ${email}, ${role},
                  ${was.signedIn ? sql`now()` : sql`null`},
                  ${was.removed ? sql`now()` : sql`null`},
                  now() + ${was.minutesLater ?? 0} * interval '1 minute')
          returning id`)
      ).id;
    const kale = await person("Kale", "kale@example.com", "owner", { signedIn: true });
    const casey = await person("Casey", "casey@example.com", "owner", { signedIn: true });
    const karen = await person("Karen", "karen@example.com", "advisor", { signedIn: true });
    // A second "Casey" that only looked the same (the name ends in a
    // character that draws nothing). It signed in, proposed something, and was removed.
    const twin = await person(`Casey${ZERO_WIDTH_SPACE}`, "kale.second@example.com", "owner", { signedIn: true, removed: true, minutesLater: 1 });
    // Two entries made with a mistyped address and removed again; nobody ever signed in with them.
    const ghost = await person(`Ka${SOFT_HYPHEN}ren`, "kraen@example.com", "advisor", { signedIn: false, removed: true, minutesLater: 2 });
    const pat = await person("Pat", "pta@example.com", "advisor", { signedIn: false, removed: true, minutesLater: 3 });
    // The real Pat, added afterwards (the name was pasted, with a character that draws nothing), not signed in yet.
    const WORD_JOINER = String.fromCodePoint(0x2060);
    const patNow = await person(`Pat${WORD_JOINER}`, "pat@example.com", "advisor", { signedIn: false, minutesLater: 4 });
    const lee = await person("Lee", "ele@example.com", "advisor", { signedIn: false, removed: true, minutesLater: 5 });
    // A name with a tab in it; a name that is nothing but a character that
    // draws nothing; and one where even the email address gives no name.
    const sam = await person(`Sam${String.fromCodePoint(0x0009)}B`, "sam@example.com", "advisor", { signedIn: true, minutesLater: 6 });
    const dee = await person(ZERO_WIDTH_SPACE, "dee@example.com", "advisor", { signedIn: false, minutesLater: 7 });
    const nobody = await person(SOFT_HYPHEN, `${ZERO_WIDTH_SPACE}@example.com`, "advisor", { signedIn: false, removed: true, minutesLater: 8 });

    const sectionRow = async (title: string, position: number, parent: string | null, archived = false) =>
      (
        await one<{ id: string }>(sql`
          insert into sections (title, position, parent_id, created_by, updated_by, archived_at, archived_by)
          values (${title}, ${position}, ${parent}, ${kale}, ${kale}, ${archived ? sql`now()` : sql`null`}, ${archived ? kale : null})
          returning id`)
      ).id;
    const people = await sectionRow("People", 1, null);
    const wages = await sectionRow("Wages", 1, people);
    const benefits = await sectionRow("Benefits", 2, people);
    const hiring = await sectionRow("Hiring", 3, people);
    const oldPlans = await sectionRow("Old plans", 2, null, true);

    /** An approved text proposal with its approvals and its version, as the hardened app stored them. */
    const approvedText = (o: { title: string; text: string; by: string[]; daysAgo: number; alone: boolean; direct?: boolean; base: string | null }) =>
      db.transaction(async (tx) => {
        const at = sql`now() - ${o.daysAgo} * interval '1 day'`;
        const [{ id }] = rowsOf<{ id: string }>(
          await tx.execute(sql`
            insert into proposals (type, title, section_id, proposed_official, proposed_official_text, proposed_by, status,
                                   decided_at, decided_by, decided_alone, direct, base_version_id, created_at)
            values ('decision', ${o.title}, ${wages}, ${doc(o.text)}::jsonb, ${o.text}, ${o.by[0]}, 'approved',
                    ${at}, ${o.by.at(-1)!}, ${o.alone}, ${o.direct ?? false}, ${o.base}, ${at})
            returning id`),
        );
        // One minute apart, in the order given.
        for (const [index, who] of o.by.entries()) {
          await tx.execute(sql`
            insert into approvals (proposal_id, user_id, revision, created_at)
            values (${id}, ${who}, 1, ${at} + ${index} * interval '1 minute')`);
        }
        const [{ versionId }] = rowsOf<{ versionId: string }>(
          await tx.execute(sql`
            insert into official_versions (section_id, version, content, content_text, created_by, created_at, proposal_id)
            values (${wages}, 1, ${doc(o.text)}::jsonb, ${o.text}, ${o.by.at(-1)!}, ${at}, ${id})
            returning id as "versionId"`),
        );
        return { id, versionId };
      });
    const both = await approvedText({ title: "Start at $14", text: "$14.00/hr", by: [kale, casey], daysAgo: 20, alone: false, base: null });
    const solo = await approvedText({ title: "Edited directly", text: "$15.00/hr", by: [kale], daysAgo: 3, alone: true, direct: true, base: both.versionId });
    const withTwin = await approvedText({ title: "Owner draw", text: "$15.00/hr. Kale may draw $5,000.", by: [twin, kale], daysAgo: 2, alone: false, base: solo.versionId });

    /** A proposal that is not approved, with its proposer's approval. */
    const other = async (o: {
      title: string;
      section: string;
      by: string;
      text?: string;
      change?: object;
      revision?: number;
      base?: string | null;
      status?: "open" | "declined" | "withdrawn" | "approved";
      decidedBy?: string;
      reason?: string;
    }) => {
      const status = o.status ?? "open";
      const { id } = await one<{ id: string }>(sql`
        insert into proposals (type, title, section_id, proposed_official, proposed_official_text, structure_change, proposed_by,
                               revision, base_version_id, status, decided_at, decided_by, decline_reason)
        values (${o.change ? "structure" : "decision"}::proposal_type, ${o.title}, ${o.section},
                ${o.text ? doc(o.text) : null}::jsonb, ${o.text ?? null}, ${o.change ? JSON.stringify(o.change) : null}::jsonb, ${o.by},
                ${o.revision ?? 1}, ${o.base ?? null}, ${status}::proposal_status,
                ${status === "open" ? sql`null` : sql`now() - interval '1 day'`}, ${o.decidedBy ?? null}, ${o.reason ?? null})
        returning id`);
      await db.execute(sql`insert into approvals (proposal_id, user_id, revision) values (${id}, ${o.by}, ${o.revision ?? 1})`);
      return id;
    };
    // Open, written against the current text, changed once by its proposer, endorsed by Karen.
    const upToDate = await other({ title: "Raise to $16", section: wages, by: casey, text: "$16.00/hr. Kale may draw $5,000.", revision: 2, base: withTwin.versionId });
    await db.execute(sql`insert into endorsements (proposal_id, user_id, revision) values (${upToDate}, ${karen}, 2)`);
    // Open, written long ago against the very first text.
    const stale = await other({ title: "Start at $13", section: wages, by: kale, text: "$13.00/hr", base: both.versionId });
    const rename = await other({ title: 'Rename 1.2 Benefits to "Perks"', section: benefits, by: kale, change: { action: "rename", title: "Perks", fromTitle: "Benefits" } });
    const oldStructure = await other({ title: "Archive 2 Old plans", section: oldPlans, by: kale, change: { action: "archive" }, status: "approved", decidedBy: casey });
    await db.execute(sql`insert into approvals (proposal_id, user_id, revision) values (${oldStructure}, ${casey}, 1)`);
    const declined = await other({ title: "Start at $11", section: wages, by: kale, text: "$11.00/hr", status: "declined", decidedBy: casey, reason: "Too low." });
    const withdrawn = await other({ title: "Hire in June", section: hiring, by: casey, text: "We hire in June.", status: "withdrawn", decidedBy: casey });
    /** Every proposal exactly as stored, leaving out the one field the new steps add. */
    const stored = async () =>
      rowsOf<{ row: Record<string, unknown> }>(
        await db.execute(sql`select to_jsonb(p) - 'decided_title' as row from proposals p order by p.id`),
      ).map((r) => r.row);
    const before = await stored();
    expect(before).toHaveLength(9);

    // Now the steps from the second review.
    await handle.migrate(REAL_FOLDER);

    // People. The look-alike is cleaned and then told apart; each change is
    // in the activity log. Entries that never signed in keep a clean name
    // and no longer hold it.
    const names = new Map((await db.select().from(schema.users)).map((u) => [u.id, u.name]));
    expect([kale, casey, karen, twin, ghost, pat, patNow, lee, sam, dee, nobody].map((id) => names.get(id))).toEqual([
      "Kale",
      "Casey",
      "Karen",
      "Casey (2)",
      "Karen",
      "Pat",
      // The real Pat keeps the name: the earlier entry never signed in, so it does not count.
      "Pat",
      "Lee",
      "Sam B",
      // With nothing left of the name, the first part of the email address; failing that, "Person".
      "dee",
      "Person",
    ]);
    const renames = (await db.select().from(schema.activityLog).orderBy(schema.activityLog.id)).filter((e) => e.action === "user.renamed");
    expect(renames.map((e) => [e.entityId, e.summary, e.userId])).toEqual([
      [twin, "Took characters that cannot be seen out of the name Casey", null],
      [ghost, "Took characters that cannot be seen out of the name Karen", null],
      [patNow, "Took characters that cannot be seen out of the name Pat", null],
      [sam, "Took characters that cannot be seen out of the name Sam B", null],
      [dee, "Took characters that cannot be seen out of the name dee", null],
      [nobody, "Took characters that cannot be seen out of the name Person", null],
      [twin, "Renamed Casey to Casey (2), because two people had the same name", null],
    ]);
    expect(renames.at(-1)?.data).toEqual({ from: "Casey", to: "Casey (2)" });
    expect(renames[0].data).toEqual({ from: `Casey${ZERO_WIDTH_SPACE}`, to: "Casey" });

    // Proposals: every one is still there, as it was.
    expect(await stored()).toEqual(before);
    expect((await db.select().from(schema.proposals)).map((p) => p.decidedTitle)).toEqual(Array(9).fill(null));
    expect((await db.select().from(schema.approvals)).length).toBe(12);

    // The app reads them, with the new answers filled in.
    const view = async (id: string) => (await loadProposal(db, id)) as ProposalView;
    const tree = await loadTree(db);
    expect((await listOpenProposals(db)).map((p) => p.id).sort()).toEqual([upToDate, stale, rename].sort());
    expect(await view(upToDate)).toMatchObject({ status: "open", revision: 2, outOfDate: false, proposerCanChange: false });
    expect(await view(stale)).toMatchObject({ status: "open", outOfDate: true, proposerCanChange: true });
    expect(waitingText(await view(stale), await activeApprovers(db), casey)).toBe("Waiting for Kale to check it against the new official text");
    expect(waitingText(await view(upToDate), await activeApprovers(db), kale)).toBe("Waiting for you");
    expect(await view(declined)).toMatchObject({ status: "declined", declineReason: "Too low.", outOfDate: false });
    expect(await view(withdrawn)).toMatchObject({ status: "withdrawn", decidedByName: "Casey" });
    // The decision the look-alike took part in now shows which Casey that was.
    expect(approvalLine((await view(withTwin.id)).approvals)).toMatch(/^Approved by Casey \(2\) and Kale, /);
    expect(await view(solo.id)).toMatchObject({ decidedAlone: true, soloOpen: true, superseded: true, direct: true });
    expect((await listOneOwnerDecisions(db)).map((p) => p.id)).toEqual([solo.id]);
    expect((await listDecisions(db, tree, {}, 50)).map((p) => p.id)).toEqual([oldStructure, withTwin.id, solo.id, both.id]);
    // A section change approved before its sentence was recorded shows the title it was stored with.
    expect(displayTitle(await view(oldStructure), tree)).toBe("Archive 2 Old plans");
    expect((await listVersions(db, wages)).map((v) => [v.version, docToText(v.content)])).toEqual([
      [3, "$15.00/hr. Kale may draw $5,000."],
      [2, "$15.00/hr"],
      [1, "$14.00/hr"],
    ]);

    // And people carry on using the app on these records.
    useAsTheAppDatabase(handle);
    const actor = async (email: string): Promise<Actor> => {
      const [row] = await db
        .select({
          id: schema.users.id,
          name: schema.users.name,
          email: schema.users.email,
          roleKey: schema.users.roleKey,
          roleName: schema.roles.name,
          permissions: schema.roles.permissions,
        })
        .from(schema.users)
        .innerJoin(schema.roles, eq(schema.roles.key, schema.users.roleKey))
        .where(eq(schema.users.email, email));
      return row;
    };
    const [kaleNow, caseyNow, karenNow] = [await actor("kale@example.com"), await actor("casey@example.com"), await actor("karen@example.com")];
    const page = async (id: string) => {
      const p = await view(id);
      const change = await loadTextChange(db, p);
      return { revision: p.revision, currentVersionId: change?.currentVersionId };
    };
    const official = async () => docToText((await loadOfficial(db, wages))!.content);

    // The proposal that is up to date: the other Owner approves, two people decided.
    expect(await approveProposal(kaleNow, upToDate, await page(upToDate))).toEqual({ approved: true, waitingFor: [] });
    expect(await view(upToDate)).toMatchObject({ status: "approved", decidedAlone: false });
    expect(await official()).toBe("$16.00/hr. Kale may draw $5,000.");
    // The old one is out of date: refused until Kale has checked it against the text as it is now.
    await expect(approveProposal(caseyNow, stale, await page(stale))).rejects.toThrow(
      "The official text of this section has changed since Kale proposed this.",
    );
    await editProposal(
      kaleNow,
      stale,
      { kind: "decision", sectionId: wages, title: "Start at $13", proposedOfficial: JSON.parse(doc("$13.00/hr")) },
      { currentVersionId: (await page(stale)).currentVersionId },
    );
    expect(await approveProposal(caseyNow, stale, await page(stale))).toEqual({ approved: true, waitingFor: [] });
    expect(await official()).toBe("$13.00/hr");
    // The section change: approved, and recorded under the sentence that was approved.
    expect(await approveProposal(caseyNow, rename, { revision: 1 })).toEqual({ approved: true, waitingFor: [] });
    expect(await view(rename)).toMatchObject({ status: "approved", decidedTitle: 'Rename 1.2 Benefits to "Perks"' });
    expect((await loadTree(db))[0].children.map((n) => n.title)).toEqual(["Wages", "Perks", "Hiring"]);
    // A direct edit, and an endorsement of something long declined.
    expect(await saveOfficial(kaleNow, hiring, JSON.parse(doc("We hire in March.")))).toEqual({ changed: true, version: 1 });
    await expect(endorseProposal(karenNow, declined, { revision: 1 })).rejects.toThrow("declined or withdrawn");

    // People: the mistyped Lee no longer holds that name; the removed
    // look-alike comes back only under the name it now has; names in use are taken.
    const mail = { baseUrl: "https://manual.example.com", send: async () => {} };
    const newLee = await addUser(kaleNow, { name: "Lee", email: "lee@example.com", roleKey: "advisor" }, mail);
    expect(newLee.userId).not.toBe(lee);
    await expect(addUser(kaleNow, { name: "casey", email: "another@example.com", roleKey: "advisor" }, mail)).rejects.toThrow("already called Casey");
    await expect(addUser(kaleNow, { name: "PAT", email: "another@example.com", roleKey: "advisor" }, mail)).rejects.toThrow("already called Pat");
    expect(await addUser(kaleNow, { name: "Kale Two", email: "kale.second@example.com", roleKey: "advisor" }, mail)).toMatchObject({
      userId: twin,
      keptName: "Casey (2)",
    });
    await removeUser(kaleNow, twin);
    const [removed] = await db.select().from(schema.users).where(eq(schema.users.id, twin));
    expect(removed).toMatchObject({ name: "Casey (2)", removedBy: kale, updatedBy: kale });

    // What was decided before still cannot be changed.
    await expect(db.execute(sql`update proposals set title = 'Rewritten' where id = ${solo.id}`)).rejects.toThrow();
    await expect(db.execute(sql`update proposals set decided_title = 'Rewritten' where id = ${oldStructure}`)).rejects.toThrow();
  });
});
