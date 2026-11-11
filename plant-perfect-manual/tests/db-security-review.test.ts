import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { type Tx, asSystem, asUser } from "@/db/client";
import { approvals, endorsements, officialVersions, proposals, sections } from "@/db/schema";
import type { Actor } from "@/lib/permissions";
import { createProposal, declineProposal, withdrawProposal } from "@/lib/proposals";
import type { RichDoc } from "@/lib/richtext";
import { BROKE_A_RULE, actorFor, insertUser, refusal, withTestDatabase } from "./helpers/db";

withTestDatabase();

/**
 * Database rules from the second review of Phase 3, tested straight at the
 * database as the app's limited role: nothing is added to a proposal that
 * has been declined or withdrawn, and the sentence an approved section
 * change is recorded under is written only in the step that approves it.
 * (The rule about out-of-date proposals is in tests/out-of-date.test.ts,
 * names in tests/names.test.ts, who and when in
 * tests/db-security-who-when.test.ts.)
 */

const doc = (text: string): RichDoc => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

async function section(title: string): Promise<string> {
  const [row] = await asSystem((db) => db.select().from(sections).where(eq(sections.title, title)));
  if (!row) throw new Error(`No section called ${title}`);
  return row.id;
}
const row = async (id: string) => (await asSystem((db) => db.select().from(proposals).where(eq(proposals.id, id))))[0];

let kale: Actor;
let casey: Actor;
let karen: Actor;

beforeAll(async () => {
  kale = await actorFor("kale@example.com");
  casey = await actorFor("casey@example.com");
  karen = await insertUser("Karen", "karen@example.com", "advisor");
});

describe("database rules: nothing is added to a proposal that was declined or withdrawn", () => {
  /** The database's own code and words for this, so the app can say it plainly. */
  const CLOSED = /^PPF04: [\s\S]*declined or withdrawn/;
  const endorse = (who: Actor, id: string) =>
    asUser(who.id, (tx) => tx.insert(endorsements).values({ proposalId: id, userId: who.id, revision: 1 }).returning());
  const approve = (who: Actor, id: string) =>
    asUser(who.id, (tx) => tx.insert(approvals).values({ proposalId: id, userId: who.id, revision: 1 }).returning());

  it("refuses an endorsement or an approval of either, and says why", async () => {
    const wages = await section("Wages");
    const make = (title: string) => createProposal(kale, { kind: "decision", sectionId: wages, title, proposedOfficial: doc(`${title}.`) });
    const declined = await make("Declined one");
    await declineProposal(casey, declined, "");
    const withdrawn = await make("Withdrawn one");
    await withdrawProposal(kale, withdrawn);
    for (const id of [declined, withdrawn]) {
      expect(await refusal(endorse(karen, id))).toMatch(CLOSED);
      expect(await refusal(approve(casey, id))).toMatch(CLOSED);
    }
    expect(await asSystem((db) => db.select().from(endorsements))).toEqual([]);

    // On one that is open, or approved, both are taken.
    const open = await make("Open one");
    expect(await endorse(karen, open)).toHaveLength(1);
    await asUser(kale.id, async (tx) => {
      await tx.update(proposals).set({ status: "approved", decidedBy: kale.id }).where(eq(proposals.id, open));
      await tx.insert(officialVersions).values({ sectionId: wages, version: 1, content: doc("Open one."), contentText: "Open one.", createdBy: kale.id, proposalId: open });
    });
    expect(await approve(casey, open)).toHaveLength(1);
  });
});

describe("database rules: the sentence a section change was approved under", () => {
  const ONLY_WHEN_APPROVED = /The sentence a section change was approved under is recorded only when that change is approved/;
  const structure = (by: Actor, sectionId: string) => createProposal(by, { kind: "structure", change: { action: "archive", sectionId } });
  const update = (by: Actor, id: string, values: Partial<typeof proposals.$inferInsert>, before?: (tx: Tx) => Promise<unknown>) =>
    asUser(by.id, async (tx) => {
      await before?.(tx);
      return tx.update(proposals).set(values).where(eq(proposals.id, id)).returning();
    });

  it("cannot arrive with a new proposal", async () => {
    const hiring = await section("Hiring");
    const insert = (decidedTitle: string | null) =>
      asUser(kale.id, (tx) =>
        tx
          .insert(proposals)
          .values({ type: "structure", title: "Archive 2.3 Hiring", sectionId: hiring, structureChange: { action: "archive" }, proposedBy: kale.id, decidedTitle })
          .returning(),
      );
    expect(await refusal(insert("Archive 2.3 Hiring"))).toMatch(BROKE_A_RULE);
    expect(await insert(null)).toHaveLength(1);
  });

  it("is written only in the step that approves a section change, by the person approving", async () => {
    const training = await section("Training");
    const id = await structure(kale, training);
    // Not by its proposer while it is open, alone or together with another change.
    expect(await refusal(update(kale, id, { decidedTitle: "Archive 2.4 Something else" }))).toMatch(ONLY_WHEN_APPROVED);
    expect(await refusal(update(kale, id, { title: "Archive it", decidedTitle: "Archive 2.4 Something else" }))).toMatch(ONLY_WHEN_APPROVED);
    // Not by the other Owner while it is open.
    expect(await refusal(update(casey, id, { decidedTitle: "Archive 2.4 Something else" }))).toMatch(ONLY_WHEN_APPROVED);
    // Not when it is declined or withdrawn.
    expect(await refusal(update(casey, id, { status: "declined", decidedBy: casey.id, decidedTitle: "Archive 2.4 Training" }))).toMatch(ONLY_WHEN_APPROVED);
    expect(await refusal(update(kale, id, { status: "withdrawn", decidedBy: kale.id, decidedTitle: "Archive 2.4 Training" }))).toMatch(ONLY_WHEN_APPROVED);
    expect(await row(id)).toMatchObject({ status: "open", decidedTitle: null, revision: 1 });

    // In the approving step it is taken.
    const [approved] = await update(casey, id, { status: "approved", decidedBy: casey.id, decidedTitle: "Archive 2.4 Training" }, (tx) =>
      tx.insert(approvals).values({ proposalId: id, userId: casey.id, revision: 1 }),
    );
    expect(approved).toMatchObject({ status: "approved", decidedTitle: "Archive 2.4 Training", decidedBy: casey.id });
    // And never again afterwards.
    expect(await refusal(update(casey, id, { decidedTitle: "Archive 2.4 Something else" }))).toMatch(/A proposal that has been decided cannot be changed/);
    expect(await refusal(update(kale, id, { decidedTitle: null }))).toMatch(/A proposal that has been decided cannot be changed/);
  });

  it("is not for a text proposal, even in the step that approves it", async () => {
    const benefits = await section("Benefits");
    const id = await createProposal(kale, { kind: "decision", sectionId: benefits, title: "Staff discount", proposedOfficial: doc("Staff discount: 20%.") });
    const approveWith = (decidedTitle: string | null) =>
      asUser(kale.id, async (tx) => {
        await tx.update(proposals).set({ status: "approved", decidedBy: kale.id, decidedTitle }).where(eq(proposals.id, id));
        return tx
          .insert(officialVersions)
          .values({ sectionId: benefits, version: 1, content: doc("Staff discount: 20%."), contentText: "Staff discount: 20%.", createdBy: kale.id, proposalId: id })
          .returning();
      });
    expect(await refusal(approveWith("Something else entirely"))).toMatch(ONLY_WHEN_APPROVED);
    expect(await row(id)).toMatchObject({ status: "open", decidedTitle: null });
    expect(await approveWith(null)).toHaveLength(1);
  });
});
