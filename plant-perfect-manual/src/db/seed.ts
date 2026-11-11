import { count } from "drizzle-orm";
import { hasUnseenCharacter, personNameKey, tidyPersonName } from "@/lib/names";
import type { Db } from "./client";
import { sections, users } from "./schema";

/** Starting sections from the build spec. Owners can change them in the app. */
export const SEED_SECTIONS: { title: string; children: string[] }[] = [
  {
    title: "Company Overview",
    children: ["Ownership and Roles", "Mission and Culture", "Legal Entities"],
  },
  {
    title: "People",
    children: ["Wages", "Benefits", "Hiring", "Training", "Policies and Expectations"],
  },
  {
    title: "Hours and Daily Operations",
    children: ["Store Hours", "Opening Procedures", "Closing Procedures", "Scheduling"],
  },
  {
    title: "Departments",
    children: [
      "Registers and Customer Service",
      "Trees and Shrubs",
      "Perennials",
      "Annuals",
      "Houseplants",
      "Hard Goods",
      "Coffee Shop",
    ],
  },
  {
    title: "Facility and Buildout",
    children: ["Construction", "Signage", "Offices and Finishing"],
  },
  { title: "Equipment and Technology", children: ["Point of Sale", "Coffee Equipment"] },
  { title: "Vendors and Purchasing", children: ["Vendor Contacts", "Order Deadlines"] },
  { title: "Finance", children: ["Budget", "Quotes", "Payments Log"] },
  { title: "Marketing and Events", children: [] },
  { title: "Opening Timeline", children: [] },
];

/**
 * Parse SEED_OWNERS, e.g. "Kale <kale@example.com>, Casey <casey@example.com>".
 * A bare address ("kale@example.com") uses the part before @ as the name.
 *
 * No two starting Owners may have the same name or the same email address
 * (the database refuses that; this says so in plain words first). Names are
 * compared the way the app compares them everywhere: capitals, extra spaces
 * and characters that cannot be seen do not count.
 */
export function parseSeedOwners(value: string | undefined): { name: string; email: string }[] {
  if (!value) return [];
  const owners: { name: string; email: string; entry: string }[] = [];
  for (const part of value.split(",")) {
    const entry = part.trim();
    if (!entry) continue;
    const match = entry.match(/^(.*)<([^<>]+)>$/);
    const email = (match ? match[2] : entry).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error(`SEED_OWNERS has an entry that is not an email address: "${entry}"`);
    }
    const name = tidyPersonName(match ? match[1] : "") || email.split("@")[0];
    if (hasUnseenCharacter(name)) {
      throw new Error(
        `SEED_OWNERS has a name with a character in it that cannot be seen: "${entry}". Type that name again by hand.`,
      );
    }
    const sameEmail = owners.find((other) => other.email === email);
    if (sameEmail) {
      throw new Error(
        `SEED_OWNERS has the same email address twice: "${sameEmail.entry}" and "${entry}". Each starting Owner needs their own email address.`,
      );
    }
    const sameName = owners.find((other) => personNameKey(other.name) === personNameKey(name));
    if (sameName) {
      throw new Error(
        `SEED_OWNERS has two starting Owners with the same name (${sameName.name}): "${sameName.entry}" and "${entry}". Give each a different name, like this: Kale <kale@example.com>, Casey <casey@example.com>`,
      );
    }
    owners.push({ name, email, entry });
  }
  return owners.map(({ name, email }) => ({ name, email }));
}

/**
 * First-time setup data. Safe to run on every start or deploy:
 *  - the starting sections are added only if there are no sections at all;
 *  - the owners in SEED_OWNERS are added only if there are no users at all.
 */
export async function seed(db: Db): Promise<void> {
  const [{ n: sectionCount }] = await db.select({ n: count() }).from(sections);
  if (sectionCount === 0) {
    for (const [i, top] of SEED_SECTIONS.entries()) {
      const [parent] = await db
        .insert(sections)
        .values({ title: top.title, position: i + 1 })
        .returning({ id: sections.id });
      if (top.children.length > 0) {
        await db.insert(sections).values(
          top.children.map((title, j) => ({ title, position: j + 1, parentId: parent.id })),
        );
      }
    }
  }

  const [{ n: userCount }] = await db.select({ n: count() }).from(users);
  if (userCount === 0) {
    const owners = parseSeedOwners(process.env.SEED_OWNERS);
    if (owners.length > 0) {
      await db.insert(users).values(owners.map((o) => ({ ...o, roleKey: "owner" })));
    }
  }
}
