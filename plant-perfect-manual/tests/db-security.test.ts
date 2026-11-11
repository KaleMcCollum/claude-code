import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { asSystem, asUser } from "@/db/client";
import {
  activityLog,
  approvals,
  loginTokens,
  officialVersions,
  roles,
  sections,
  sessions,
  users,
} from "@/db/schema";
import { saveOfficial } from "@/lib/official";
import { actorFor, insertUser, withTestDatabase } from "./helpers/db";

withTestDatabase();

/**
 * These tests go around the app's own permission checks and talk to the
 * database directly as each kind of user, to prove the database itself
 * refuses what it should (row level security).
 */

function rowsOf<T>(result: unknown): T[] {
  return (Array.isArray(result) ? result : (result as { rows: T[] }).rows) as T[];
}

async function wagesId(): Promise<string> {
  const [row] = await asSystem((db) => db.select().from(sections).where(eq(sections.title, "Wages")));
  return row.id;
}

const DOC = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }] };

describe("database rules: every table is protected", () => {
  it("has row level security turned on for every table", async () => {
    const result = await asSystem((db) =>
      db.execute(sql`
        select c.relname as name, c.relrowsecurity as protected
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
      `),
    );
    const tables = rowsOf<{ name: string; protected: boolean }>(result);
    expect(tables.length).toBeGreaterThanOrEqual(8);
    expect(tables.filter((t) => !t.protected).map((t) => t.name)).toEqual([]);
  });

  it("never lets the app role delete from any table", async () => {
    const result = await asSystem((db) =>
      db.execute(sql`
        select c.relname as name
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
          and has_table_privilege('ppf_app', c.oid, 'DELETE')
      `),
    );
    expect(rowsOf<{ name: string }>(result).map((t) => t.name)).toEqual([]);
  });
});

describe("database rules: Owner", () => {
  it("can read and change sections", async () => {
    const kale = await actorFor("kale@example.com");
    const read = await asUser(kale.id, (tx) => tx.select().from(sections));
    expect(read.length).toBe(39);
    const changed = await asUser(kale.id, (tx) =>
      tx.update(sections).set({ position: 1 }).where(eq(sections.title, "Wages")).returning(),
    );
    expect(changed).toHaveLength(1);
  });

  it("cannot delete anything, even as an Owner", async () => {
    const kale = await actorFor("kale@example.com");
    await expect(asUser(kale.id, (tx) => tx.delete(sections))).rejects.toThrow();
    await expect(asUser(kale.id, (tx) => tx.delete(users))).rejects.toThrow();
    await expect(asUser(kale.id, (tx) => tx.delete(activityLog))).rejects.toThrow();
  });

  it("cannot reach sign-in links or sessions", async () => {
    const kale = await actorFor("kale@example.com");
    await expect(asUser(kale.id, (tx) => tx.select().from(loginTokens))).rejects.toThrow();
    await expect(asUser(kale.id, (tx) => tx.select().from(sessions))).rejects.toThrow();
  });

  it("cannot rewrite history: versions, approvals and the activity log are add-only", async () => {
    const kale = await actorFor("kale@example.com");
    await saveOfficial(kale, await wagesId(), DOC);
    await expect(
      asUser(kale.id, (tx) => tx.update(officialVersions).set({ contentText: "changed" })),
    ).rejects.toThrow();
    await expect(
      asUser(kale.id, (tx) => tx.update(approvals).set({ createdAt: new Date(0) })),
    ).rejects.toThrow();
    await expect(
      asUser(kale.id, (tx) => tx.update(activityLog).set({ summary: "changed" })),
    ).rejects.toThrow();
  });

  it("cannot approve or log in someone else's name", async () => {
    const kale = await actorFor("kale@example.com");
    const casey = await actorFor("casey@example.com");
    const [version] = await asSystem((db) => db.select().from(officialVersions).limit(1));
    await expect(
      asUser(kale.id, (tx) =>
        tx.insert(approvals).values({ proposalId: version.proposalId, userId: casey.id }),
      ),
    ).rejects.toThrow();
    await expect(
      asUser(kale.id, (tx) =>
        tx.insert(activityLog).values({
          userId: casey.id,
          action: "fake",
          entityType: "section",
          summary: "Not really Casey",
        }),
      ),
    ).rejects.toThrow();
  });

  it("cannot change the roles table", async () => {
    const kale = await actorFor("kale@example.com");
    await expect(
      asUser(kale.id, (tx) => tx.update(roles).set({ permissions: ["read"] })),
    ).rejects.toThrow();
  });

  it("loses all access the moment they are removed", async () => {
    const temp = await insertUser("Temp Owner", "temp-owner@example.com", "owner");
    expect((await asUser(temp.id, (tx) => tx.select().from(sections))).length).toBe(39);
    await asSystem((db) => db.update(users).set({ removedAt: new Date() }).where(eq(users.id, temp.id)));
    expect((await asUser(temp.id, (tx) => tx.select().from(sections))).length).toBe(0);
  });
});

describe("database rules: Advisor", () => {
  it("can read everything but change nothing", async () => {
    const karen = await insertUser("Karen", "karen@example.com", "advisor");
    const id = await wagesId();

    expect((await asUser(karen.id, (tx) => tx.select().from(sections))).length).toBe(39);
    expect((await asUser(karen.id, (tx) => tx.select().from(officialVersions))).length).toBeGreaterThan(0);

    const renamed = await asUser(karen.id, (tx) =>
      tx.update(sections).set({ title: "Hacked" }).where(eq(sections.id, id)).returning(),
    );
    expect(renamed).toHaveLength(0);
    await expect(
      asUser(karen.id, (tx) => tx.insert(sections).values({ title: "Sneaky", position: 99 })),
    ).rejects.toThrow();
    const [version] = await asSystem((db) => db.select().from(officialVersions).limit(1));
    await expect(
      asUser(karen.id, (tx) =>
        tx.insert(officialVersions).values({
          sectionId: id,
          version: 99,
          content: DOC,
          contentText: "x",
          createdBy: karen.id,
          proposalId: version.proposalId,
        }),
      ),
    ).rejects.toThrow();
    await expect(
      asUser(karen.id, (tx) =>
        tx.insert(approvals).values({ proposalId: version.proposalId, userId: karen.id }),
      ),
    ).rejects.toThrow();

    const [still] = await asSystem((db) => db.select().from(sections).where(eq(sections.id, id)));
    expect(still.title).toBe("Wages");
  });

  it("cannot add users or promote themselves", async () => {
    const karen = await actorFor("karen@example.com");
    await expect(
      asUser(karen.id, (tx) =>
        tx.insert(users).values({ name: "Friend", email: "friend@example.com", roleKey: "owner" }),
      ),
    ).rejects.toThrow();
    const promoted = await asUser(karen.id, (tx) =>
      tx.update(users).set({ roleKey: "owner" }).where(eq(users.id, karen.id)).returning(),
    );
    expect(promoted).toHaveLength(0);
    expect((await actorFor("karen@example.com")).roleKey).toBe("advisor");
  });
});

describe("database rules: nobody", () => {
  it("shows nothing to an id that is not a user", async () => {
    const nobody = "00000000-0000-4000-8000-000000000000";
    expect((await asUser(nobody, (tx) => tx.select().from(sections))).length).toBe(0);
    expect((await asUser(nobody, (tx) => tx.select().from(users))).length).toBe(0);
  });
});
