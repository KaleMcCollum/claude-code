import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import * as schema from "@/db/schema";
import { approvalLine, listVersions, loadOfficial } from "@/lib/official";
import { listDecisions, listOneOwnerDecisions, loadProposal } from "@/lib/proposals";
import { loadTree } from "@/lib/sections";

/**
 * Official text saved before proposals existed (Phases 1 and 2) must come
 * through the Phase 3 database change with nothing lost: same words, same
 * approvals, same dates. The first test builds the database the old way,
 * saves text the way Phase 1 did, then applies the newer steps on top.
 *
 * The second test does the same for a database that already had proposals
 * (Phase 3 as first built) and then gets the hardening steps.
 *
 * Both write their starting data with full database access, which the rule
 * against back-dating does not bind, so they need no `allow_set_time` switch.
 */

const REAL_FOLDER = path.join(process.cwd(), "drizzle");
/** The last database step of Phase 2. */
const LAST_OLD_STEP = "0004_capture_hardening";
/** The last database step of Phase 3 as it was first built. */
const LAST_PHASE_3_STEP = "0007_decisions_security";

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
    // Two people who were given the same name (one of them removed since).
    const otherCasey = (await one<{ id: string }>(
      sql`insert into users (name, email, role_key, removed_at, created_at)
          values ('casey', 'kale.other@example.com', 'owner', now(), now() + interval '1 second') returning id`,
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
    expect(names.find((u) => u.id === otherCasey)?.name).toBe("casey (2)");
    const renames = await db.select().from(schema.activityLog);
    expect(renames.map((e) => [e.action, e.entityId, e.summary])).toEqual([
      ["user.renamed", otherCasey, "Renamed casey to casey (2), because two people had the same name"],
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
  });
});
