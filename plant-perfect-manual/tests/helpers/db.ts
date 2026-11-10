import { eq } from "drizzle-orm";
import { afterAll, beforeAll } from "vitest";
import { asSystem, closeDb, getDb, migrateServerDatabase } from "@/db/client";
import { roles, users } from "@/db/schema";
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
