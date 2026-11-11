import { asc, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { asSystem, asUser } from "@/db/client";
import { endorsements, officialVersions, proposals, sections, users } from "@/db/schema";
import { listVersions, loadOfficial, restoreVersion, saveOfficial } from "@/lib/official";
import { type Actor, AppError } from "@/lib/permissions";
import { approveAlone, approveProposal, createProposal, editProposal, endorseProposal } from "@/lib/proposals";
import type { RichDoc } from "@/lib/richtext";
import { addUser } from "@/lib/users";
import { actorFor, fakeMailer, insertUser, withTestDatabase } from "./helpers/db";

/**
 * What happens when two people press a button at the very same moment.
 *
 * These tests only run against a real Postgres server (TEST_DATABASE_URL):
 * the embedded database handles one request at a time, so there nothing can
 * ever happen "at the same moment". On a server the app holds several
 * connections, as it does in production.
 *
 * Each test repeats its race many times. Which of the two wins a round is
 * left to chance; what must hold in every single round is that they went
 * one after the other and the second was refused in plain words.
 */

const onServer = Boolean(process.env.TEST_DATABASE_URL);
if (onServer) withTestDatabase();

const doc = (text: string): RichDoc => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

async function section(title: string): Promise<string> {
  const [row] = await asSystem((db) => db.select().from(sections).where(eq(sections.title, title)));
  return row.id;
}

type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };
const settle = <T>(work: Promise<T>): Promise<Settled<T>> =>
  work.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** Start two things at the same moment, or the second a few thousandths of a second later. */
async function together<A, B>(first: () => Promise<A>, second: () => Promise<B>, staggerMs: number) {
  const a = settle(first());
  if (staggerMs > 0) await sleep(staggerMs);
  const b = settle(second());
  return Promise.all([a, b]);
}
/** The plain message a refused person was shown. Anything else than a plain message fails the test. */
function shown(result: Settled<unknown>): string {
  if (result.ok) throw new Error("Expected this one to be refused.");
  expect(result.error).toBeInstanceOf(AppError);
  return (result.error as AppError).message;
}

const versionsOf = (sectionId: string) =>
  asSystem((db) => db.select().from(officialVersions).where(eq(officialVersions.sectionId, sectionId)).orderBy(asc(officialVersions.version)));

describe.skipIf(!onServer)("at the same moment (real Postgres only)", () => {
  let kale: Actor;
  let casey: Actor;
  let karen: Actor;

  beforeAll(async () => {
    kale = await actorFor("kale@example.com");
    casey = await actorFor("casey@example.com");
    karen = await insertUser("Karen", "karen@example.com", "advisor");
  });

  it("an endorsement never ends up on wording the endorser did not see", async () => {
    const wages = await section("Wages");
    let endorsedFirst = 0;
    const rounds = 40;
    for (let i = 0; i < rounds; i += 1) {
      const id = await createProposal(kale, {
        kind: "decision",
        sectionId: wages,
        title: `Wage ${i}`,
        proposedOfficial: doc(`Coffee staff start at $15/hr. (${i})`),
      });
      // Karen has revision 1 on her screen and presses Endorse; at the same
      // moment Kale saves a change to the proposal.
      const endorse = () => endorseProposal(karen, id, { revision: 1 });
      const edit = () =>
        editProposal(kale, id, { kind: "decision", sectionId: wages, title: `Wage ${i}`, proposedOfficial: doc(`Coffee staff start at $9/hr. (${i})`) });
      const [endorsed, edited] =
        i % 2 === 0 ? await together(endorse, edit, i % 4) : (await together(edit, endorse, i % 4)).reverse() as [Settled<void>, Settled<void>];

      const [row] = await asSystem((db) => db.select().from(proposals).where(eq(proposals.id, id)));
      const stamps = await asSystem((db) => db.select().from(endorsements).where(eq(endorsements.proposalId, id)));
      // An endorsement is always on the revision it was given on, and that
      // is still the proposal's revision.
      for (const stamp of stamps) {
        expect(stamp.revision).toBe(1);
        expect(row.revision).toBe(1);
      }
      // Exactly one of the two went through; the other was told why.
      expect([endorsed.ok, edited.ok].filter(Boolean)).toHaveLength(1);
      if (endorsed.ok) {
        endorsedFirst += 1;
        expect(stamps).toHaveLength(1);
        expect(shown(edited)).toContain("can no longer be changed");
      } else {
        expect(stamps).toHaveLength(0);
        expect(row.revision).toBe(2);
        expect(shown(endorsed)).toBe("Kale changed this proposal after you opened it. Reload the page and read it again, then endorse.");
      }
    }
    console.log(`endorse against edit: the endorsement came first in ${endorsedFirst} of ${rounds} rounds`);
  });

  it("two direct saves started from the same version: exactly one is accepted, every time", async () => {
    const benefits = await section("Benefits");
    await saveOfficial(kale, benefits, doc("Agreed text 0."));
    const rounds = 30;
    for (let i = 1; i <= rounds; i += 1) {
      const start = (await asSystem((db) => loadOfficial(db, benefits)))!;
      const [a, b] = await together(
        () => saveOfficial(kale, benefits, doc(`Kale's edit ${i}, started from version ${start.version}.`), { baseVersionId: start.id }),
        () => saveOfficial(casey, benefits, doc(`Casey's edit ${i}, started from version ${start.version}.`), { baseVersionId: start.id }),
        i % 5,
      );
      expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
      expect(shown(a.ok ? b : a)).toContain("Someone else changed this official text after you opened it");
      const after = (await versionsOf(benefits)).filter((v) => v.version > start.version);
      expect(after.map((v) => v.version)).toEqual([start.version + 1]);
    }
  });

  it("Approve against a direct save of the same section: never both", async () => {
    const hiring = await section("Hiring");
    await saveOfficial(kale, hiring, doc("Original text 0."));
    const rounds = 40;
    let approvals = 0;
    for (let i = 1; i <= rounds; i += 1) {
      const start = (await asSystem((db) => loadOfficial(db, hiring)))!;
      const id = await createProposal(kale, { kind: "decision", sectionId: hiring, title: `Proposal ${i}`, proposedOfficial: doc(`Proposed text ${i}.`) });
      // Casey has the proposal page open (it compares with `start`) and
      // presses Approve; at the same moment Kale saves a direct edit he
      // started from the same version.
      // (Half the rounds with "Approve", half with "Approve on my own".)
      const seen = { revision: 1, currentVersionId: start.id };
      const approve = (): Promise<unknown> => (i % 4 < 2 ? approveProposal(casey, id, seen) : approveAlone(casey, id, seen));
      const save = () => saveOfficial(kale, hiring, doc(`Kale's direct edit ${i}.`), { baseVersionId: start.id });
      const [approved, saved] =
        i % 2 === 0 ? await together(approve, save, i % 3) : ((await together(save, approve, i % 3)).reverse() as [Settled<unknown>, Settled<unknown>]);

      expect([approved.ok, saved.ok].filter(Boolean)).toHaveLength(1);
      const after = (await versionsOf(hiring)).filter((v) => v.version > start.version);
      expect(after).toHaveLength(1);
      const [row] = await asSystem((db) => db.select().from(proposals).where(eq(proposals.id, id)));
      if (approved.ok) {
        approvals += 1;
        expect(after[0].contentText).toBe(`Proposed text ${i}.`);
        expect(shown(saved)).toContain("Someone else changed this official text after you opened it");
        expect(row.status).toBe("approved");
      } else {
        expect(after[0].contentText).toBe(`Kale's direct edit ${i}.`);
        expect(shown(approved)).toContain("The official text of this section changed after you opened this page");
        // Casey's approval was not recorded on a comparison she never saw.
        expect(row.status).toBe("open");
      }
    }
    console.log(`approve against direct save: the approval came first in ${approvals} of ${rounds} rounds`);
  });

  it("Restore against a direct save of the same section: never both", async () => {
    const quotes = await section("Quotes");
    await saveOfficial(kale, quotes, doc("The very first text."));
    const [first] = await asSystem((db) => listVersions(db, quotes));
    await saveOfficial(kale, quotes, doc("Text 0."));
    for (let i = 1; i <= 20; i += 1) {
      const start = (await asSystem((db) => loadOfficial(db, quotes)))!;
      // Casey restores the first version from the history page; at the same
      // moment Kale saves an edit. Both started from the same newest version.
      const restore = () => restoreVersion(casey, quotes, first.id, { currentVersionId: start.id });
      const save = () => saveOfficial(kale, quotes, doc(`Text ${i}.`), { baseVersionId: start.id });
      const [restored, saved] =
        i % 2 === 0 ? await together(restore, save, i % 3) : ((await together(save, restore, i % 3)).reverse() as [Settled<unknown>, Settled<unknown>]);
      expect([restored.ok, saved.ok].filter(Boolean)).toHaveLength(1);
      const after = (await versionsOf(quotes)).filter((v) => v.version > start.version);
      expect(after).toHaveLength(1);
      if (restored.ok) {
        expect(after[0]).toMatchObject({ contentText: "The very first text.", restoredFromVersionId: first.id });
        expect(shown(saved)).toContain("Someone else changed this official text after you opened it");
      } else {
        expect(after[0].contentText).toBe(`Text ${i}.`);
        expect(shown(restored)).toContain("The official text was changed after you opened this page");
      }
      // Put a different text back so the next round's restore changes something.
      if (restored.ok) await saveOfficial(kale, quotes, doc(`Text ${i}, again.`));
    }
  });

  it("the same name given to two new people at the same moment: one is refused in plain words", async () => {
    const mail = fakeMailer();
    const options = { baseUrl: "https://manual.example.com", send: mail.send };
    for (let i = 0; i < 12; i += 1) {
      const [a, b] = await together(
        () => addUser(kale, { name: `Twin ${i}`, email: `twin.a${i}@example.com`, roleKey: "advisor" }, options),
        () => addUser(casey, { name: `twin  ${i}`, email: `twin.b${i}@example.com`, roleKey: "advisor" }, options),
        0,
      );
      expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
      expect(shown(a.ok ? b : a)).toMatch(/^Someone here is already called twin {1,2}\d+\. Add a last initial/i);
      const twins = await asSystem((db) => db.select().from(users).where(eq(users.name, a.ok ? `Twin ${i}` : `twin ${i}`)));
      expect(twins).toHaveLength(1);
    }
    expect(mail.sent).toHaveLength(12);
  });

  it("three presses at once on one proposal make exactly one decision and one version", async () => {
    const training = await section("Training");
    for (let i = 0; i < 12; i += 1) {
      const id = await createProposal(kale, { kind: "decision", sectionId: training, title: `Three at once ${i}`, proposedOfficial: doc(`Training text ${i}.`) });
      const current = (await asSystem((db) => loadOfficial(db, training)))?.id ?? null;
      const seen = { revision: 1, currentVersionId: current };
      const results = await Promise.all([
        settle(approveProposal(casey, id, seen)),
        settle(approveProposal(casey, id, seen)),
        settle(approveAlone(kale, id, seen)),
        settle(endorseProposal(karen, id, { revision: 1 })),
      ]);
      const [row] = await asSystem((db) => db.select().from(proposals).where(eq(proposals.id, id)));
      const made = await asSystem((db) => db.select().from(officialVersions).where(eq(officialVersions.proposalId, id)));
      expect(row.status).toBe("approved");
      expect(made).toHaveLength(1);
      expect(results.slice(0, 3).filter((r) => r.ok)).toHaveLength(1);
      for (const result of results.slice(0, 3)) if (!result.ok) shown(result);
      // The endorsement is on the one wording there ever was.
      expect(results[3].ok).toBe(true);
    }
  });

  it("the database numbers two versions saved at the same moment one after the other", async () => {
    const scheduling = await section("Scheduling");
    /** Approve your own proposal and save its version, straight at the database, sending the same number as the other. */
    const save = (who: Actor, id: string, text: string) =>
      asUser(who.id, async (tx) => {
        await tx.update(proposals).set({ status: "approved", decidedBy: who.id }).where(eq(proposals.id, id));
        return tx
          .insert(officialVersions)
          .values({ sectionId: scheduling, version: 1, content: doc(text), contentText: text, createdBy: who.id, proposalId: id })
          .returning();
      });
    for (let i = 0; i < 25; i += 1) {
      const before = (await versionsOf(scheduling)).length;
      const a = await createProposal(kale, { kind: "decision", sectionId: scheduling, title: `A ${i}`, proposedOfficial: doc(`Kale's text ${i}.`) });
      const b = await createProposal(casey, { kind: "decision", sectionId: scheduling, title: `B ${i}`, proposedOfficial: doc(`Casey's text ${i}.`) });
      const [first, second] = await together(
        () => save(kale, a, `Kale's text ${i}.`),
        () => save(casey, b, `Casey's text ${i}.`),
        0,
      );
      // Neither is refused for "that number is taken": the database gave each its own.
      expect(first.ok && second.ok).toBe(true);
      const numbers = [first, second].map((r) => (r.ok ? r.value[0].version : 0)).sort((x, y) => x - y);
      expect(numbers).toEqual([before + 1, before + 2]);
    }
  });
});
