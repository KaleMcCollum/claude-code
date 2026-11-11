import { eq } from "drizzle-orm";
import { afterAll, beforeAll } from "vitest";
import { asSystem, closeDb, getDb, migrateServerDatabase, sqlErrorText, sqlState } from "@/db/client";
import { roles, systemFlags, users } from "@/db/schema";
import { seed } from "@/db/seed";
import type { Email } from "@/lib/mailer";
import type { Actor } from "@/lib/permissions";

/**
 * Gives a test file its own empty database with the starting sections and
 * two Owners (Kale, Casey).
 *
 * By default this is the embedded database, in memory. Set TEST_DATABASE_URL
 * (an address on a real Postgres server, for a user allowed to create
 * databases) to run the same tests against real Postgres instead.
 */
export function withTestDatabase(): void {
  let dropName: string | null = null;

  beforeAll(async () => {
    process.env.SEED_OWNERS = "Kale <kale@example.com>, Casey <casey@example.com>";
    const serverUrl = process.env.TEST_DATABASE_URL;
    if (serverUrl) {
      const { default: postgres } = await import("postgres");
      dropName = `ppf_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const admin = postgres(serverUrl, { max: 1, onnotice: () => {} });
      await admin.unsafe(`create database ${dropName}`);
      await admin.end();
      const url = new URL(serverUrl);
      url.pathname = `/${dropName}`;
      process.env.DATABASE_URL = url.toString();
      await migrateServerDatabase();
      await seed(await getDb());
    } else {
      delete process.env.DATABASE_URL;
      process.env.PGLITE_DIR = "memory";
      await getDb();
    }
    await allowSetTime(true);
  });

  afterAll(async () => {
    await closeDb();
    const serverUrl = process.env.TEST_DATABASE_URL;
    if (serverUrl && dropName) {
      const { default: postgres } = await import("postgres");
      const admin = postgres(serverUrl, { max: 1, onnotice: () => {} });
      await admin.unsafe(`drop database if exists ${dropName}`);
      await admin.end();
    }
  });
}

/**
 * The database refuses records dated in the past or the future when they
 * come through the app's limited role. Many tests need exactly that (a note
 * "three days ago", a decision "in June") and get it through the rules'
 * own `now` options, so every test database starts with the switch that
 * allows it (`allow_set_time`). Only code with full database access can set
 * the switch; nothing in the app does. Tests of the time rule itself turn
 * it off for their duration: `await allowSetTime(false)` ... `finally
 * allowSetTime(true)`.
 */
export async function allowSetTime(allowed: boolean): Promise<void> {
  await asSystem(async (db) => {
    if (allowed) {
      await db.insert(systemFlags).values({ key: "allow_set_time", value: true }).onConflictDoNothing();
    } else {
      await db.delete(systemFlags).where(eq(systemFlags.key, "allow_set_time"));
    }
  });
}

/** Run `work` with the real-time rule switched on, as it is for the app, then allow set times again. */
export async function withRealTimeOnly<T>(work: () => Promise<T>): Promise<T> {
  await allowSetTime(false);
  try {
    return await work();
  } finally {
    await allowSetTime(true);
  }
}

/** The signed-in identity for a user, as the app would build it from a session. */
export async function actorFor(email: string): Promise<Actor> {
  const [row] = await asSystem((db) =>
    db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        roleKey: users.roleKey,
        roleName: roles.name,
        permissions: roles.permissions,
      })
      .from(users)
      .innerJoin(roles, eq(roles.key, users.roleKey))
      .where(eq(users.email, email)),
  );
  if (!row) throw new Error(`No test user with email ${email}`);
  return row;
}

/** Add a user straight into the database (skipping the invitation email). */
export async function insertUser(name: string, email: string, roleKey: string): Promise<Actor> {
  await asSystem((db) => db.insert(users).values({ name, email, roleKey }));
  return actorFor(email);
}

/** A stand-in mailer that keeps what it was asked to send. */
export function fakeMailer() {
  const sent: Email[] = [];
  return {
    sent,
    send: async (email: Email) => {
      sent.push(email);
    },
  };
}

export function tokenFrom(email: Email): string {
  const match = email.text.match(/\/auth\/confirm\?token=([\w-]+)/);
  if (!match) throw new Error("No sign-in link found in the email");
  return match[1];
}

/**
 * For tests of what the database refuses: runs `work`, which must fail, and
 * hands back why (the database's error code and its own words). A test can
 * then check it was refused for the reason it is about, not for another.
 */
export async function refusal(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    return `${sqlState(error) ?? "no code"}: ${sqlErrorText(error)}`;
  }
  throw new Error("Expected the database to refuse this, but it was accepted.");
}

/** The database's words when a row breaks a row level security rule. */
export const BROKE_A_RULE = /row-level security policy/;
/** The database's words when the app's role may not touch a table or column at all. */
export const NOT_ALLOWED = /permission denied/;
