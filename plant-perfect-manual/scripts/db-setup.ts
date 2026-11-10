/**
 * Bring a real Postgres database up to date: apply any new migrations, then
 * add first-time data (starting sections; owners from SEED_OWNERS).
 * Safe to run on every deploy. Needs DATABASE_URL.
 */
import { closeDb, getDb, migrateServerDatabase } from "../src/db/client";
import { seed } from "../src/db/seed";

async function main() {
  await migrateServerDatabase();
  await seed(await getDb());
  await closeDb();
  console.log("Database is up to date.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
