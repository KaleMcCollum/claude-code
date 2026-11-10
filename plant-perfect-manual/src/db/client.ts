import { mkdir } from "node:fs/promises";
import path from "node:path";
import { sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

/**
 * One database handle type for both drivers:
 *  - a real Postgres server (production; DATABASE_URL is set), and
 *  - PGlite, a Postgres that runs inside the app process with no setup
 *    (local development and tests).
 */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** Anything a query can run on: the database itself or an open transaction. */
export type Queryable = Db | Tx;

const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");

type Handle = { db: Db; close: () => Promise<void> };

declare global {
  var __ppfDb: Promise<Handle> | undefined;
}

async function open(): Promise<Handle> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { default: postgres } = await import("postgres");
    const { drizzle } = await import("drizzle-orm/postgres-js");
    // prepare:false keeps this compatible with connection poolers.
    const client = postgres(url, { prepare: false, max: 5, onnotice: () => {} });
    return { db: drizzle(client, { schema }) as unknown as Db, close: () => client.end() };
  }

  const dir = process.env.PGLITE_DIR;
  if (process.env.NODE_ENV === "production" && !dir) {
    throw new Error(
      "DATABASE_URL is not set. The app needs a database address to run in production.",
    );
  }

  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  // (The comment inside the call tells the build not to bundle this folder.)
  const dataDir =
    dir === "memory" ? null : path.resolve(/*turbopackIgnore: true*/ dir ?? ".data/pglite");
  if (dataDir) await mkdir(path.dirname(dataDir), { recursive: true });
  const client = dataDir ? new PGlite(dataDir) : new PGlite();
  const db = drizzle(client, { schema });
  // The embedded database sets itself up on first use.
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  const handle: Handle = { db: db as unknown as Db, close: () => client.close() };
  const { seed } = await import("./seed");
  await seed(handle.db);
  return handle;
}

export async function getDb(): Promise<Db> {
  if (!globalThis.__ppfDb) {
    const opening = open();
    globalThis.__ppfDb = opening;
    // If the database could not be reached, try again on the next request
    // instead of staying broken until the app restarts.
    opening.catch(() => {
      if (globalThis.__ppfDb === opening) globalThis.__ppfDb = undefined;
    });
  }
  return (await globalThis.__ppfDb).db;
}

export async function closeDb(): Promise<void> {
  const pending = globalThis.__ppfDb;
  globalThis.__ppfDb = undefined;
  if (pending) await (await pending).close();
}

/** Apply pending migrations to a real Postgres server (used at deploy time). */
export async function migrateServerDatabase(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set.");
  const { migrate } = await import("drizzle-orm/postgres-js/migrator");
  const db = await getDb();
  await migrate(db as never, { migrationsFolder: MIGRATIONS_FOLDER });
}

/**
 * Run `fn` as a signed-in user. Inside, the connection is switched to the
 * limited ppf_app role and tagged with the user's id, so the database's own
 * row level security rules apply to everything `fn` does.
 */
export async function asUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    await tx.execute(sql`set local role ppf_app`);
    return fn(tx);
  });
}

/**
 * Run `fn` with full database rights and NO row level security.
 * Only for sign-in (before a user is known), setup scripts and tests.
 * Never use this to act for a signed-in user: use asUser.
 */
export async function asSystem<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  return fn(await getDb());
}
