/**
 * Test-only starting data for e2e/phase3.cjs. scripts/run-e2e.sh runs this
 * on the brand-new test database before the app starts.
 *
 * The app has no way to save official text in the past, and must not get
 * one. The browser test still needs official text that was saved weeks ago
 * (to propose a change to, and to look back at in version history), so it
 * is put in here through the same rule the app uses for "Edit official"
 * (saveOfficial), with a `now` in the past:
 *
 *  - 2.1 Wages: one version, saved by Kale 25 days ago.
 *  - 3.1 Store Hours: version 1 saved by Kale 60 days ago, version 2 saved
 *    by Casey 20 days ago (a one-person decision that is too old to be
 *    flagged on Today).
 */
import { eq } from "drizzle-orm";
import { asSystem, closeDb } from "../src/db/client";
import { roles, users } from "../src/db/schema";
import { saveOfficial } from "../src/lib/official";
import type { Actor } from "../src/lib/permissions";
import type { RichDoc } from "../src/lib/richtext";
import { flattenTree, loadTree } from "../src/lib/sections";

const DAY_MS = 24 * 60 * 60 * 1000;

const doc = (...paragraphs: string[]): RichDoc => ({
  type: "doc",
  content: paragraphs.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })),
});

async function actorFor(email: string): Promise<Actor> {
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
  if (!row) throw new Error(`The test database has no user ${email} (check SEED_OWNERS).`);
  return row;
}

async function main() {
  // Opening the database creates it, with the starting sections and owners.
  const kale = await actorFor("kale@example.com");
  const casey = await actorFor("casey@example.com");
  const sections = flattenTree(await asSystem((db) => loadTree(db)));
  const idOf = (title: string) => {
    const node = sections.find((section) => section.title === title);
    if (!node) throw new Error(`The test database has no section "${title}".`);
    return node.id;
  };
  const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS);

  await saveOfficial(
    kale,
    idOf("Wages"),
    doc("Starting wage, Coffee Shop: $13.00/hr.", "Starting wage, Garden Center Registers: $15.00/hr."),
    { now: daysAgo(25) },
  );
  await saveOfficial(
    kale,
    idOf("Store Hours"),
    doc("Open 9 AM to 6 PM, Monday to Saturday.", "Closed Sunday."),
    { now: daysAgo(60) },
  );
  await saveOfficial(
    casey,
    idOf("Store Hours"),
    doc("Open 9 AM to 7 PM, Monday to Saturday.", "Open 11 AM to 4 PM Sunday."),
    { now: daysAgo(20) },
  );
  await closeDb();
  console.log("Saved official text for Wages (25 days ago) and Store Hours (60 and 20 days ago).");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
