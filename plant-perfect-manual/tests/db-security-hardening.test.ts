import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { type Tx, asSystem, asUser } from "@/db/client";
import {
  approvals,
  endorsements,
  officialVersions,
  proposalNotes,
  proposals,
  roles,
  sections,
  systemFlags,
  users,
} from "@/db/schema";
import { addNote } from "@/lib/notes";
import { listVersions, saveOfficial } from "@/lib/official";
import type { Actor } from "@/lib/permissions";
import { createProposal, editProposal, endorseProposal } from "@/lib/proposals";
import type { RichDoc } from "@/lib/richtext";
import { createSection } from "@/lib/sections";
import { changeUserRole, removeUser } from "@/lib/users";
import { BROKE_A_RULE, NOT_ALLOWED, actorFor, insertUser, refusal, withTestDatabase } from "./helpers/db";

withTestDatabase();

/**
 * More tests that skip the app's own checks and talk to the database
 * directly as each kind of user. They cover the rules added after the
 * independent review of Phase 3, and the earlier rules that review found no
 * test for. Wherever it can be arranged, exactly one thing is wrong in each
 * attempt, and the test checks WHY it was refused, so that a rule cannot be
 * taken away unnoticed behind another rule that refuses the same attempt.
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

let kale: Actor;
let casey: Actor;
let karen: Actor;

beforeAll(async () => {
  kale = await actorFor("kale@example.com");
  casey = await actorFor("casey@example.com");
  karen = await insertUser("Karen", "karen@example.com", "advisor");
});

const row = async (id: string) => (await asSystem((db) => db.select().from(proposals).where(eq(proposals.id, id))))[0];

/** An open text proposal, made through the app. */
async function propose(by: Actor, sectionTitle: string, text: string, title = text): Promise<string> {
  return createProposal(by, { kind: "decision", sectionId: await section(sectionTitle), title, proposedOfficial: doc(text) });
}

/** Mark a proposal approved, straight at the database, inside an open transaction. */
const approveAt = (tx: Tx, id: string, by: Actor) =>
  tx.update(proposals).set({ status: "approved", decidedBy: by.id }).where(eq(proposals.id, id));

/** A new role with exactly these permissions, and one person who has it. */
async function personWithRole(name: string, key: string, permissions: string[]): Promise<Actor> {
  await asSystem((db) => db.insert(roles).values({ key, name: key, permissions }));
  return insertUser(name, `${name.toLowerCase()}@example.com`, key);
}

type VersionValues = typeof officialVersions.$inferInsert;

describe("database rules: an official version is saved only with its approval, word for word", () => {
  it("refuses each single thing wrong, then accepts the right one and numbers it itself", async () => {
    const perennials = await section("Perennials");
    const annuals = await section("Annuals");
    const id = await propose(kale, "Perennials", "Perennials text.");
    const right: VersionValues = {
      sectionId: perennials,
      version: 1,
      content: doc("Perennials text."),
      contentText: "Perennials text.",
      createdBy: kale.id,
      proposalId: id,
    };
    /** Kale approves the proposal and saves its version in one transaction, with `wrong` changed. */
    const approveAndSave = (wrong: Partial<VersionValues>, between?: (tx: Tx) => Promise<unknown>) =>
      asUser(kale.id, async (tx) => {
        await approveAt(tx, id, kale);
        await between?.(tx);
        return tx.insert(officialVersions).values({ ...right, ...wrong }).returning();
      });

    // The proposal is still open.
    expect(await refusal(asUser(kale.id, (tx) => tx.insert(officialVersions).values(right)))).toMatch(BROKE_A_RULE);
    // Other words than the approved ones.
    expect(await refusal(approveAndSave({ content: doc("Other words."), contentText: "Other words." }))).toMatch(BROKE_A_RULE);
    // Another section.
    expect(await refusal(approveAndSave({ sectionId: annuals }))).toMatch(BROKE_A_RULE);
    // Saved in someone else's name.
    expect(await refusal(approveAndSave({ createdBy: casey.id }))).toMatch(BROKE_A_RULE);
    // Saved by an Owner who did not decide it: after Kale's approval the
    // transaction is handed to Casey (only raw database commands can do this).
    expect(
      await refusal(
        approveAndSave({ createdBy: casey.id }, (tx) => tx.execute(sql`select set_config('app.user_id', ${casey.id}, true)`)),
      ),
    ).toMatch(BROKE_A_RULE);
    // Decided, but not approved: Casey declines it and tries to save its text anyway.
    expect(
      await refusal(
        asUser(casey.id, async (tx) => {
          await tx.update(proposals).set({ status: "declined", decidedBy: casey.id }).where(eq(proposals.id, id));
          await tx.insert(officialVersions).values({ ...right, createdBy: casey.id });
        }),
      ),
    ).toMatch(BROKE_A_RULE);
    // A structure proposal has no text to make official.
    const trees = await section("Trees and Shrubs");
    const structure = await createProposal(kale, { kind: "structure", change: { action: "archive", sectionId: trees } });
    expect(
      await refusal(
        asUser(kale.id, async (tx) => {
          await approveAt(tx, structure, kale);
          await tx.insert(officialVersions).values({ ...right, sectionId: trees, content: doc("x"), contentText: "x", proposalId: structure });
        }),
      ),
    ).toMatch(BROKE_A_RULE);
    // Every refusal undid the approval that came with it.
    expect((await row(id)).status).toBe("open");
    expect((await row(structure)).status).toBe("open");
    expect(await asSystem((db) => listVersions(db, perennials))).toEqual([]);

    // The right one. The version number and the search copy that were sent are ignored.
    const [saved] = await approveAndSave({ version: 2147483647, contentText: "Search text that is not the words." });
    expect(saved).toMatchObject({ version: 1, contentText: "Perennials text.", createdBy: kale.id, restoredFromVersionId: null });
    const decided = await row(id);
    expect(decided).toMatchObject({ status: "approved", decidedBy: kale.id });
    expect(decided.decidedTxid).toEqual(expect.any(Number));
    // Never a second version for the same proposal.
    expect(await refusal(asUser(kale.id, (tx) => tx.insert(officialVersions).values(right)))).toMatch(BROKE_A_RULE);

    // The next change to the section gets the next number, also when another is sent.
    const next = await propose(casey, "Perennials", "Perennials text, second.");
    const [second] = await asUser(casey.id, async (tx) => {
      await approveAt(tx, next, casey);
      return tx
        .insert(officialVersions)
        .values({ ...right, version: -5, content: doc("Perennials text, second."), createdBy: casey.id, proposalId: next })
        .returning();
    });
    expect(second).toMatchObject({ version: 2, contentText: "Perennials text, second." });
    // A section that can still be changed afterwards (a huge number used to freeze it).
    expect(await saveOfficial(kale, perennials, doc("Perennials text, third."))).toEqual({ changed: true, version: 3 });
  });

  it("cannot be added in a later transaction than the approval", async () => {
    const houseplants = await section("Houseplants");
    const id = await propose(kale, "Houseplants", "Houseplants text.");
    // The rule "approved means its text is saved in the same step" would stop
    // the starting point of this test from existing at all. With full
    // database access it is switched off just long enough to make one:
    // approved, with no version.
    await asSystem((db) => db.execute(sql`alter table proposals disable trigger proposals_applied_at_commit`));
    try {
      await asUser(kale.id, (tx) => approveAt(tx, id, kale));
    } finally {
      await asSystem((db) => db.execute(sql`alter table proposals enable trigger proposals_applied_at_commit`));
    }
    expect((await row(id)).status).toBe("approved");
    // Everything about this version is right, except that the approval was not in this transaction.
    expect(
      await refusal(
        asUser(kale.id, (tx) =>
          tx.insert(officialVersions).values({
            sectionId: houseplants,
            version: 1,
            content: doc("Houseplants text."),
            contentText: "Houseplants text.",
            createdBy: kale.id,
            proposalId: id,
          }),
        ),
      ),
    ).toMatch(BROKE_A_RULE);
    expect(await asSystem((db) => listVersions(db, houseplants))).toEqual([]);
  });

  it("a version that says it brings back an earlier one must carry that version's exact words, from the same section", async () => {
    const hardGoods = await section("Hard Goods");
    const coffeeShop = await section("Coffee Shop");
    await saveOfficial(kale, hardGoods, doc("First words."));
    await saveOfficial(kale, hardGoods, doc("Second words."));
    // Another section that happens to say the same as Hard Goods said at first.
    await saveOfficial(kale, coffeeShop, doc("First words."));
    const [second, first] = await asSystem((db) => listVersions(db, hardGoods));
    const [elsewhere] = await asSystem((db) => listVersions(db, coffeeShop));

    const id = await propose(kale, "Hard Goods", "First words.", "Back to the first words");
    const save = (restoredFromVersionId: string) =>
      asUser(kale.id, async (tx) => {
        await approveAt(tx, id, kale);
        return tx
          .insert(officialVersions)
          .values({
            sectionId: hardGoods,
            version: 3,
            content: doc("First words."),
            contentText: "First words.",
            createdBy: kale.id,
            proposalId: id,
            restoredFromVersionId,
          })
          .returning();
      });
    const NOT_A_RESTORE = /exact words of an earlier version of the same section/;
    // The same words, but a version of another section.
    expect(await refusal(save(elsewhere.id))).toMatch(NOT_A_RESTORE);
    // The same section, but other words.
    expect(await refusal(save(second.id))).toMatch(NOT_A_RESTORE);
    const [ok] = await save(first.id);
    expect(ok).toMatchObject({ version: 3, restoredFromVersionId: first.id });
  });

  it("never has a version number below 1, even if the numbering rule were switched off", async () => {
    const [existing] = await asSystem((db) => db.select().from(officialVersions).limit(1));
    // Inside one transaction that is undone at the end, whatever happens.
    const reason = await refusal(
      asSystem((db) =>
        db.transaction(async (tx) => {
          await tx.execute(sql`alter table official_versions disable trigger official_versions_prepare`);
          await tx.insert(officialVersions).values({
            sectionId: existing.sectionId,
            version: 0,
            content: doc("x"),
            contentText: "x",
            createdBy: kale.id,
            proposalId: existing.proposalId,
          });
        }),
      ),
    );
    expect(reason).toMatch(/official_versions_version_from_one/);
  });
});

describe("database rules: approved means applied, in the same step", () => {
  it("refuses, when the transaction ends, a text proposal approved without its official text", async () => {
    const id = await propose(kale, "Coffee Equipment", "Coffee equipment text.");
    expect(await refusal(asUser(kale.id, (tx) => approveAt(tx, id, kale)))).toMatch(
      /An approved proposal must have its official text saved in the same step/,
    );
    expect((await row(id)).status).toBe("open");
    expect(await asSystem(async (db) => listVersions(db, await section("Coffee Equipment")))).toEqual([]);
  });

  it("refuses a direct edit that is left open", async () => {
    const wages = await section("Wages");
    const direct = {
      type: "official_text" as const,
      title: "Edited directly",
      sectionId: wages,
      proposedOfficial: doc("Forged."),
      proposedOfficialText: "Forged.",
      proposedBy: kale.id,
    };
    expect(await refusal(asUser(kale.id, (tx) => tx.insert(proposals).values({ ...direct, direct: true })))).toMatch(
      /A direct edit is approved in the same step it is made/,
    );
    // The same proposal without the mark is an ordinary open proposal.
    expect(await asUser(kale.id, (tx) => tx.insert(proposals).values(direct).returning())).toHaveLength(1);
  });

  it("takes no forged side fields on a new proposal", async () => {
    const wages = await section("Wages");
    const benefits = await section("Benefits");
    await saveOfficial(casey, wages, doc("Wages v1."));
    await saveOfficial(casey, benefits, doc("Benefits v1."));
    const [wagesVersion] = await asSystem((db) => listVersions(db, wages));
    const [benefitsVersion] = await asSystem((db) => listVersions(db, benefits));
    const base = {
      type: "decision" as const,
      title: "Side fields",
      sectionId: wages,
      proposedOfficial: doc("Wages v2."),
      proposedOfficialText: "Wages v2.",
      proposedBy: kale.id,
    };
    const insert = (extra: Partial<typeof proposals.$inferInsert>) =>
      asUser(kale.id, (tx) => tx.insert(proposals).values({ ...base, ...extra }).returning());

    // "Last changed by" someone else.
    expect(await refusal(insert({ updatedBy: casey.id }))).toMatch(BROKE_A_RULE);
    // Written against a version of another section.
    expect(await refusal(insert({ baseVersionId: benefitsVersion.id }))).toMatch(BROKE_A_RULE);
    // Already tied to a deciding transaction, decided by someone, or with a created section.
    expect(await refusal(insert({ decidedTxid: 7 }))).toMatch(BROKE_A_RULE);
    expect(await refusal(insert({ decidedBy: kale.id }))).toMatch(BROKE_A_RULE);
    expect(await refusal(insert({ createdSectionId: benefits }))).toMatch(BROKE_A_RULE);
    // Marked "decided by one person" before it is decided at all.
    expect(await refusal(insert({ decidedAlone: true }))).toMatch(/proposals_alone_only_when_approved/);

    const [ok] = await insert({ updatedBy: kale.id, baseVersionId: wagesVersion.id });
    expect(ok).toMatchObject({ status: "open", updatedBy: kale.id, baseVersionId: wagesVersion.id, decidedAlone: false, decidedTxid: null });
    expect(await insert({})).toHaveLength(1);
  });

  it("records a created section only when it is the one the proposal asked for, added by the approver", async () => {
    const people = await section("People");
    const wages = await section("Wages");
    const id = await createProposal(kale, { kind: "structure", change: { action: "add", parentId: null, title: "Brand New Section" } });
    const approveNaming = (createdSectionId: string, proposalId = id) =>
      asUser(kale.id, (tx) =>
        tx.update(proposals).set({ status: "approved", decidedBy: kale.id, createdSectionId }).where(eq(proposals.id, proposalId)).returning(),
      );
    const WRONG_SECTION = /must be the one it asked for, added by the person approving it/;

    // Any section that happens to exist.
    expect(await refusal(approveNaming(wages))).toMatch(WRONG_SECTION);
    // The right name in the right place, but added by someone else.
    const byCasey = await createSection(casey, { parentId: null, title: "Brand New Section" });
    expect(await refusal(approveNaming(byCasey))).toMatch(WRONG_SECTION);
    // Added by Kale with the right name, but somewhere else.
    const elsewhere = await createSection(kale, { parentId: people, title: "Brand New Section" });
    expect(await refusal(approveNaming(elsewhere))).toMatch(WRONG_SECTION);
    // Added by Kale in the right place, under another name.
    const otherName = await createSection(kale, { parentId: null, title: "Brand Old Section" });
    expect(await refusal(approveNaming(otherName))).toMatch(WRONG_SECTION);

    // A proposal that adds nothing cannot record a created section: here a
    // rename, pointed at a section that would otherwise fit.
    const rename = await createProposal(kale, { kind: "structure", change: { action: "rename", sectionId: people, title: "Brand New Section" } });
    expect(await refusal(approveNaming(elsewhere, rename))).toMatch(WRONG_SECTION);

    const right = await createSection(kale, { parentId: null, title: "Brand New Section" });
    // Only together with the approval: not on an open proposal, not when withdrawing.
    const ONLY_ON_APPROVAL = /A new section is recorded only when its proposal is approved/;
    expect(
      await refusal(asUser(kale.id, (tx) => tx.update(proposals).set({ createdSectionId: right }).where(eq(proposals.id, id)))),
    ).toMatch(ONLY_ON_APPROVAL);
    expect(
      await refusal(
        asUser(kale.id, (tx) =>
          tx.update(proposals).set({ status: "withdrawn", decidedBy: kale.id, createdSectionId: right }).where(eq(proposals.id, id)),
        ),
      ),
    ).toMatch(ONLY_ON_APPROVAL);

    const [done] = await approveNaming(right);
    expect(done).toMatchObject({ status: "approved", createdSectionId: right });
  });
});

describe("database rules: whether one person decided is worked out by the database", () => {
  /** Kale adds his approval if he has none, approves, and saves the version, all at the database. */
  const decideAsKale = async (id: string) => {
    const p = await row(id);
    await asUser(kale.id, async (tx) => {
      if (p.proposedBy !== kale.id) await tx.insert(approvals).values({ proposalId: id, userId: kale.id, revision: p.revision });
      await approveAt(tx, id, kale);
      await tx.insert(officialVersions).values({
        sectionId: p.sectionId!,
        version: 1,
        content: p.proposedOfficial,
        contentText: p.proposedOfficialText!,
        createdBy: kale.id,
        proposalId: id,
      });
    });
    return row(id);
  };

  it("from the people who can approve at that moment, and the app cannot set it", async () => {
    // Kale alone.
    const alone = await propose(kale, "Opening Procedures", "Opening text.");
    expect(await refusal(asUser(kale.id, (tx) => tx.update(proposals).set({ decidedAlone: true }).where(eq(proposals.id, alone))))).toMatch(NOT_ALLOWED);
    expect(await refusal(asUser(kale.id, (tx) => tx.update(proposals).set({ decidedTxid: 1 }).where(eq(proposals.id, alone))))).toMatch(NOT_ALLOWED);
    expect((await decideAsKale(alone)).decidedAlone).toBe(true);

    // With Casey's approval on it as well: two people.
    const both = await propose(kale, "Closing Procedures", "Closing text.");
    await asUser(casey.id, (tx) => tx.insert(approvals).values({ proposalId: both, userId: casey.id, revision: 1 }));
    expect((await decideAsKale(both)).decidedAlone).toBe(false);

    // Proposed (and so approved) by someone who is no longer an Owner: their approval does not count.
    const sam = await insertUser("Sam", "sam@example.com", "owner");
    const exOwner = await propose(sam, "Registers and Customer Service", "Registers text.");
    await changeUserRole(kale, sam.id, "advisor");
    expect((await decideAsKale(exOwner)).decidedAlone).toBe(true);

    // Proposed by someone who has since been removed: the same.
    const rita = await insertUser("Rita", "rita@example.com", "owner");
    const removed = await propose(rita, "Payments Log", "Payments text.");
    await removeUser(kale, rita.id);
    expect((await decideAsKale(removed)).decidedAlone).toBe(true);
  });

  it("which transaction decided a proposal is recorded by the database alone, even for code with full access", async () => {
    const id = await propose(kale, "Mission and Culture", "Mission text.");
    // Code with full database access, acting in Kale's name, sends its own values with an edit ...
    await asSystem((db) =>
      db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.user_id', ${kale.id}, true)`);
        await tx.update(proposals).set({ title: "Mission", decidedTxid: 7 }).where(eq(proposals.id, id));
      }),
    );
    expect(await row(id)).toMatchObject({ title: "Mission", status: "open", decidedTxid: null, decidedAlone: false });
    // ... and with the decision itself: what is stored is the real transaction, and the real count.
    await asSystem((db) =>
      db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.user_id', ${kale.id}, true)`);
        await tx.update(proposals).set({ status: "withdrawn", decidedBy: kale.id, decidedTxid: 7 }).where(eq(proposals.id, id));
      }),
    );
    const after = await row(id);
    expect(after).toMatchObject({ status: "withdrawn", decidedAlone: false });
    expect(after.decidedTxid).not.toBe(7);
    expect(after.decidedTxid).toEqual(expect.any(Number));
  });
});

describe("database rules: an approval or endorsement is tied to the wording it was given on", () => {
  it("refuses one given on another revision than the proposal's current one", async () => {
    const pointOfSale = await section("Point of Sale");
    const id = await propose(kale, "Point of Sale", "Registers: Square.");
    const endorse = (revision: number) =>
      asUser(karen.id, (tx) => tx.insert(endorsements).values({ proposalId: id, userId: karen.id, revision }).returning());
    const approve = (revision: number) =>
      asUser(casey.id, (tx) => tx.insert(approvals).values({ proposalId: id, userId: casey.id, revision }).returning());
    const STALE = /^PPF01: [\s\S]*This proposal was changed after it was read/;

    // A revision that does not exist yet.
    expect(await refusal(endorse(2))).toMatch(STALE);
    expect(await refusal(approve(2))).toMatch(STALE);

    await editProposal(kale, id, { kind: "decision", sectionId: pointOfSale, title: "Registers", proposedOfficial: doc("Registers: Clover.") });
    expect((await row(id)).revision).toBe(2);
    // The wording they had in front of them is no longer the proposal's wording.
    expect(await refusal(endorse(1))).toMatch(STALE);
    expect(await refusal(approve(1))).toMatch(STALE);
    // The app's own check says the same in plain words.
    await expect(endorseProposal(karen, id, { revision: 1 })).rejects.toThrow("Kale changed this proposal after you opened it");

    expect(await endorse(2)).toMatchObject([{ revision: 2 }]);
    expect(await approve(2)).toMatchObject([{ revision: 2 }]);
    // The proposer's own approval keeps the revision it was given on (they wrote the newer words).
    const mine = await asSystem((db) => db.select().from(approvals).where(eq(approvals.proposalId, id)));
    expect(mine.find((a) => a.userId === kale.id)?.revision).toBe(1);
  });
});

describe("database rules: changing an open proposal (the rest)", () => {
  it("is blocked by another Owner's approval, not only by an endorsement", async () => {
    const id = await propose(kale, "Scheduling", "Scheduling text.");
    await asUser(casey.id, (tx) => tx.insert(approvals).values({ proposalId: id, userId: casey.id, revision: 1 }));
    expect(
      await refusal(asUser(kale.id, (tx) => tx.update(proposals).set({ title: "After Casey approved" }).where(eq(proposals.id, id)))),
    ).toMatch(/someone else has approved or endorsed/);
    expect((await row(id)).title).toBe("Scheduling text.");
  });

  it("is for its proposer only, also when nobody has approved it at all", async () => {
    // Through the app a proposal always carries its proposer's approval, and
    // "someone else has approved" would stop Casey's change as well. Put in
    // straight at the database it has no approval, so only this rule is left.
    const annuals = await section("Annuals");
    const [bare] = await asUser(kale.id, (tx) =>
      tx
        .insert(proposals)
        .values({ type: "decision", title: "Bare", sectionId: annuals, proposedOfficial: doc("Annuals text."), proposedOfficialText: "Annuals text.", proposedBy: kale.id })
        .returning(),
    );
    expect(
      await refusal(asUser(casey.id, (tx) => tx.update(proposals).set({ title: "Casey's title" }).where(eq(proposals.id, bare.id)))),
    ).toMatch(/Only the person who made a proposal can change it/);
    expect((await row(bare.id)).title).toBe("Bare");
  });

  it("when, by whom and why cannot be set without deciding", async () => {
    const id = await propose(kale, "Budget", "Budget text.");
    const set = (values: Partial<typeof proposals.$inferInsert>) =>
      asUser(kale.id, (tx) => tx.update(proposals).set(values).where(eq(proposals.id, id)));
    const ONLY_WHEN_DECIDED = /set only when a proposal is decided/;
    expect(await refusal(set({ decidedBy: kale.id }))).toMatch(ONLY_WHEN_DECIDED);
    expect(await refusal(set({ declineReason: "No." }))).toMatch(ONLY_WHEN_DECIDED);
    expect(await refusal(set({ decidedAt: new Date() }))).toMatch(/set only when a proposal is decided|proposals_decided_has_when/);
    expect(await row(id)).toMatchObject({ status: "open", decidedBy: null, declineReason: null, decidedAt: null });
  });

  it("needs a signed-in person, even for code with full database access", async () => {
    const id = await propose(kale, "Quotes", "Quotes text.");
    expect(await refusal(asSystem((db) => db.update(proposals).set({ title: "By a script" }).where(eq(proposals.id, id))))).toMatch(
      /can only be changed by a signed-in person/,
    );
  });

  it("stamps who changed it last and when, whatever is sent, and never changes when it was made", async () => {
    const id = await propose(kale, "Construction", "Construction text.");
    await asUser(kale.id, (tx) =>
      tx.update(proposals).set({ title: "Edited", updatedBy: casey.id, updatedAt: new Date("2020-01-01T00:00:00Z") }).where(eq(proposals.id, id)),
    );
    const after = await row(id);
    expect(after).toMatchObject({ title: "Edited", revision: 2, updatedBy: kale.id });
    expect(Math.abs(after.updatedAt.getTime() - Date.now())).toBeLessThan(60 * 60 * 1000);
    expect(
      await refusal(asUser(kale.id, (tx) => tx.update(proposals).set({ createdAt: new Date("2020-01-01T00:00:00Z") }).where(eq(proposals.id, id)))),
    ).toMatch(NOT_ALLOWED);
  });

  it("cannot be pointed at another section's version", async () => {
    const signage = await section("Signage");
    const offices = await section("Offices and Finishing");
    await saveOfficial(casey, signage, doc("Signage v1."));
    await saveOfficial(casey, offices, doc("Offices v1."));
    const [own] = await asSystem((db) => listVersions(db, signage));
    const [other] = await asSystem((db) => listVersions(db, offices));
    const id = await propose(kale, "Signage", "Signage v2.");
    const point = (baseVersionId: string | null) =>
      asUser(kale.id, (tx) => tx.update(proposals).set({ baseVersionId }).where(eq(proposals.id, id)).returning());
    expect(await refusal(point(other.id))).toMatch(/written against a version of its own section/);
    expect(await point(null)).toMatchObject([{ baseVersionId: null, revision: 2 }]);
    expect(await point(own.id)).toMatchObject([{ baseVersionId: own.id, revision: 3 }]);
  });
});

describe("database rules: what a proposal may hold (the rest)", () => {
  it("a description must be a document, and each kind carries only its own content", async () => {
    const wages = await section("Wages");
    const text = { type: "decision" as const, title: "Checks", sectionId: wages, proposedOfficial: doc("x"), proposedOfficialText: "x", proposedBy: kale.id };
    const insert = (values: typeof proposals.$inferInsert) => asUser(kale.id, (tx) => tx.insert(proposals).values(values));
    expect(await refusal(insert({ ...text, description: "<p>html</p>" }))).toMatch(/proposals_description_is_document/);
    // A text proposal with a structure change tucked in.
    expect(await refusal(insert({ ...text, structureChange: { action: "archive" } }))).toMatch(/proposals_kind_matches_content/);
    // A structure proposal with official text tucked in.
    expect(
      await refusal(
        insert({ type: "structure", title: "Archive it", sectionId: wages, structureChange: { action: "archive" }, proposedOfficial: doc("x"), proposedBy: kale.id }),
      ),
    ).toMatch(/proposals_kind_matches_content/);
  });

  it("a decided proposal always has its time, an open one never (also for code with full database access)", async () => {
    const wages = await section("Wages");
    const text = { type: "decision" as const, title: "When", sectionId: wages, proposedOfficial: doc("x"), proposedOfficialText: "x", proposedBy: kale.id };
    expect(await refusal(asSystem((db) => db.insert(proposals).values({ ...text, status: "withdrawn", decidedBy: kale.id })))).toMatch(
      /proposals_decided_has_when/,
    );
    expect(await refusal(asSystem((db) => db.insert(proposals).values({ ...text, decidedAt: new Date() })))).toMatch(
      /proposals_decided_has_when/,
    );
  });

  it("a structure change is one of the four the app can carry out, with what each needs", async () => {
    const hiring = await section("Hiring");
    const insert = (structureChange: unknown) =>
      asUser(kale.id, (tx) =>
        tx.insert(proposals).values({ type: "structure", title: "A structure change", sectionId: hiring, structureChange, proposedBy: kale.id }).returning(),
      );
    const UNKNOWN = /proposals_structure_is_known/;
    for (const change of [
      { action: "tidy" },
      {},
      { action: 5 },
      { action: "add" },
      { action: "add", title: "" },
      { action: "add", title: "   " },
      { action: "rename", title: 5 },
      { action: "rename" },
      { action: "move" },
      { action: "move", parentId: 5 },
      { action: "Archive" },
      "archive",
      ["archive"],
    ]) {
      expect(await refusal(insert(change)), JSON.stringify(change)).toMatch(UNKNOWN);
    }
    for (const change of [
      { action: "add", title: "New" },
      { action: "rename", title: "New", fromTitle: "Hiring" },
      { action: "move", parentId: null },
      { action: "move", parentId: await section("Finance") },
      { action: "archive" },
    ]) {
      expect(await insert(change), JSON.stringify(change)).toHaveLength(1);
    }
  });
});

describe("database rules: each permission is looked at on its own", () => {
  // The app has two roles today, and each has every permission the other
  // rules need together. Roles are rows, so a third can be added later:
  // these tests add roles that have one permission without another.

  it("endorsing needs the endorse permission", async () => {
    const reader = await personWithRole("Rae", "reader", ["read", "comment"]);
    const id = await propose(kale, "Vendor Contacts", "Vendors text.");
    const endorse = (who: Actor) =>
      asUser(who.id, (tx) => tx.insert(endorsements).values({ proposalId: id, userId: who.id, revision: 1 }).returning());
    expect(await refusal(endorse(reader))).toMatch(BROKE_A_RULE);
    // Someone who has been removed can do nothing at all.
    const gone = await insertUser("Gus", "gus@example.com", "advisor");
    await removeUser(kale, gone.id);
    expect(await refusal(endorse(gone))).toMatch(BROKE_A_RULE);
    expect(await endorse(karen)).toHaveLength(1);
  });

  it("approving and declining need the approve permission, even for someone who may propose", async () => {
    const drafter = await personWithRole("Drew", "drafter", ["read", "comment", "propose"]);
    const hiring = await section("Hiring");
    // Drew's own proposal, with an approval in his name put there by code with full access.
    const [own] = await asUser(drafter.id, (tx) =>
      tx.insert(proposals).values({ type: "structure", title: "Archive Hiring", sectionId: hiring, structureChange: { action: "archive" }, proposedBy: drafter.id }).returning(),
    );
    expect(await refusal(asUser(drafter.id, (tx) => tx.insert(approvals).values({ proposalId: own.id, userId: drafter.id, revision: 1 })))).toMatch(
      BROKE_A_RULE,
    );
    await asSystem((db) => db.insert(approvals).values({ proposalId: own.id, userId: drafter.id, revision: 1 }));
    expect(await refusal(asUser(drafter.id, (tx) => approveAt(tx, own.id, drafter)))).toMatch(/Only an Owner can approve/);

    const kales = await propose(kale, "Order Deadlines", "Deadlines text.");
    expect(
      await refusal(
        asUser(drafter.id, (tx) => tx.update(proposals).set({ status: "declined", decidedBy: drafter.id }).where(eq(proposals.id, kales))),
      ),
    ).toMatch(/Only an Owner can decline/);
    expect((await row(own.id)).status).toBe("open");
    expect((await row(kales)).status).toBe("open");
  });

  it("saving official text needs edit_official, even for someone who may approve", async () => {
    const approver = await personWithRole("Ava", "approver", ["read", "comment", "propose", "approve"]);
    const training = await section("Training");
    const reason = await refusal(
      asUser(approver.id, async (tx) => {
        const [p] = await tx
          .insert(proposals)
          .values({ type: "decision", title: "Training", sectionId: training, proposedOfficial: doc("Training text."), proposedOfficialText: "Training text.", proposedBy: approver.id })
          .returning();
        await tx.insert(approvals).values({ proposalId: p.id, userId: approver.id, revision: 1 });
        await approveAt(tx, p.id, approver);
        await tx.insert(officialVersions).values({
          sectionId: training,
          version: 1,
          content: doc("Training text."),
          contentText: "Training text.",
          createdBy: approver.id,
          proposalId: p.id,
        });
      }),
    );
    expect(reason).toMatch(/row-level security policy for table "official_versions"/);
  });

  it("a source note is linked in your own name only", async () => {
    const id = await propose(kale, "Legal Entities", "Legal text.");
    const note = await addNote(kale, { body: doc("source note") });
    expect(
      await refusal(asUser(kale.id, (tx) => tx.insert(proposalNotes).values({ proposalId: id, noteId: note.id, createdBy: casey.id }))),
    ).toMatch(BROKE_A_RULE);
    expect(
      await asUser(kale.id, (tx) => tx.insert(proposalNotes).values({ proposalId: id, noteId: note.id, createdBy: kale.id }).returning()),
    ).toHaveLength(1);
  });
});

describe("database rules: people", () => {
  it("no two people have the same name, capitals and spaces aside, removed people who ever signed in included", async () => {
    const add = (name: string, email: string) => asSystem((db) => db.insert(users).values({ name, email, roleKey: "advisor" }).returning());
    const SAME_NAME = /users_name_unique/;
    expect(await refusal(add("Casey", "casey.two@example.com"))).toMatch(SAME_NAME);
    expect(await refusal(add("  cAsEy ", "casey.two@example.com"))).toMatch(SAME_NAME);
    await add("Mary Ann", "mary.ann@example.com");
    expect(await refusal(add("mary   ann", "mary.ann.two@example.com"))).toMatch(SAME_NAME);
    expect(await refusal(add(" Mary Ann", "mary.ann.two@example.com"))).toMatch(SAME_NAME);
    // Gus was removed in an earlier test. He never signed in, so nothing was
    // ever done under that entry and his name is free again.
    const [gus] = await asSystem((db) => db.select().from(users).where(eq(users.email, "gus@example.com")));
    expect(gus).toMatchObject({ lastActiveAt: null });
    expect(gus.removedAt).not.toBeNull();
    const [secondGus] = await add("Gus", "gus.two@example.com");
    // The second Gus signs in and is removed: his name stays on what he did, so nobody else gets it.
    await asSystem((db) => db.update(users).set({ lastActiveAt: new Date(), removedAt: new Date() }).where(eq(users.id, secondGus.id)));
    expect(await refusal(add("gus", "gus.three@example.com"))).toMatch(SAME_NAME);
    // The first Gus cannot be brought back under that name either.
    expect(await refusal(asSystem((db) => db.update(users).set({ removedAt: null }).where(eq(users.id, gus.id))))).toMatch(SAME_NAME);
    // Someone who has not signed in yet, but has not been removed, holds their name like anyone else.
    expect((await actorFor("karen@example.com")).name).toBe("Karen");
    expect(await refusal(add("KAREN", "karen.two@example.com"))).toMatch(SAME_NAME);
    // And nobody can be renamed to a name that is taken.
    expect(await refusal(asUser(kale.id, (tx) => tx.update(users).set({ name: "casey" }).where(eq(users.id, karen.id))))).toMatch(SAME_NAME);
    expect(await add("Maryann", "maryann@example.com")).toHaveLength(1);
  });

  it("the app's role can change a person's name, role and removal, and nothing else about them", async () => {
    const change = (values: Partial<typeof users.$inferInsert>) =>
      asUser(kale.id, (tx) => tx.update(users).set(values).where(eq(users.id, karen.id)).returning({ id: users.id }));
    // The address a sign-in link goes to.
    expect(await refusal(change({ email: "kale.second@example.com" }))).toMatch(NOT_ALLOWED);
    expect(await refusal(change({ id: "00000000-0000-4000-8000-000000000000" }))).toMatch(NOT_ALLOWED);
    expect(await refusal(change({ createdAt: new Date() }))).toMatch(NOT_ALLOWED);
    expect(await refusal(change({ createdBy: kale.id }))).toMatch(NOT_ALLOWED);
    expect(await refusal(change({ lastActiveAt: new Date() }))).toMatch(NOT_ALLOWED);
    expect((await actorFor("karen@example.com")).email).toBe("karen@example.com");
    // What the Settings page does change still works.
    expect(await change({ name: "Karen", roleKey: "advisor", updatedAt: new Date(), updatedBy: kale.id })).toHaveLength(1);
    expect(await change({ removedAt: null, removedBy: null })).toHaveLength(1);
    // An Advisor still changes nobody.
    expect(await asUser(karen.id, (tx) => tx.update(users).set({ name: "Boss" }).where(eq(users.id, karen.id)).returning())).toHaveLength(0);
  });

  it("the app's role cannot see or set the switches kept for people with full database access", async () => {
    expect(await refusal(asUser(kale.id, (tx) => tx.select().from(systemFlags)))).toMatch(NOT_ALLOWED);
    expect(await refusal(asUser(kale.id, (tx) => tx.insert(systemFlags).values({ key: "allow_set_time", value: true })))).toMatch(NOT_ALLOWED);
    expect(await refusal(asUser(kale.id, (tx) => tx.update(systemFlags).set({ value: false })))).toMatch(NOT_ALLOWED);
    expect(await refusal(asUser(kale.id, (tx) => tx.delete(systemFlags)))).toMatch(NOT_ALLOWED);
  });
});
