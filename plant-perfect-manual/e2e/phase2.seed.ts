/**
 * Test-only starting data for e2e/phase2.cjs. scripts/run-e2e.sh runs this
 * on the brand-new test database before the app starts.
 *
 * The app has no way to write a note on a past day, and must not get one.
 * The browser test still needs an "earlier day with notes", so one note by
 * Kale is put in here, dated three days ago, through the same rule the app
 * itself uses to save a note (addNote).
 */
import { eq } from "drizzle-orm";
import { asSystem, closeDb } from "../src/db/client";
import { roles, users } from "../src/db/schema";
import { addNote } from "../src/lib/notes";

const EARLIER_NOTE = "Walked the lot with the paving crew, they start after the frost";

async function main() {
  // Opening the database creates it, with the starting sections and owners.
  const [kale] = await asSystem((db) =>
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
      .where(eq(users.email, "kale@example.com")),
  );
  if (!kale) throw new Error("The test database has no user kale@example.com (check SEED_OWNERS).");

  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  const { logDate } = await addNote(kale, {
    body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: EARLIER_NOTE }] }] },
    now: threeDaysAgo,
  });
  await closeDb();
  console.log(`Added a note to the Daily Log for ${logDate}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
