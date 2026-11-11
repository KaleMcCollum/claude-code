import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { asSystem, asUser } from "@/db/client";
import { activityLog, approvals, officialVersions, proposals, sections } from "@/db/schema";
import { loadOfficial, saveOfficial } from "@/lib/official";
import { type Actor, AppError } from "@/lib/permissions";
import {
  type ProposalView,
  activeApprovers,
  approveAlone,
  approveChoices,
  approveProposal,
  canApproveToo,
  countAwaiting,
  createProposal,
  editProposal,
  endorseProposal,
  listOneOwnerDecisions,
  loadProposal,
  loadTextChange,
  statusLine,
  waitingOn,
  waitingText,
  withdrawProposal,
} from "@/lib/proposals";
import { type RichDoc, docToText } from "@/lib/richtext";
import { loadToday } from "@/lib/today";
import { removeUser } from "@/lib/users";
import { actorFor, insertUser, refusal, withTestDatabase } from "./helpers/db";

withTestDatabase();

/**
 * A waiting text proposal goes out of date when the official text of its
 * section changes: its proposer's approval was given on top of the older
 * text. Two people cannot approve it until the proposer has checked it
 * against the new text and saved it again. One person can still approve it
 * alone, which is flagged for the other Owner like any one-person decision.
 */

const doc = (...paragraphs: string[]): RichDoc => ({
  type: "doc",
  content: paragraphs.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })),
});

async function section(title: string): Promise<string> {
  const [row] = await asSystem((db) => db.select().from(sections).where(eq(sections.title, title)));
  if (!row) throw new Error(`No section called ${title}`);
  return row.id;
}
const view = async (id: string) => (await asSystem((db) => loadProposal(db, id))) as ProposalView;
const owners = () => asSystem((db) => activeApprovers(db));
const official = (sectionId: string) => asSystem((db) => loadOfficial(db, sectionId));
const officialText = async (sectionId: string) => docToText((await official(sectionId))!.content);
const currentId = async (sectionId: string) => (await official(sectionId))?.id ?? null;
/** What a freshly loaded proposal page would send back with a button press. */
async function page(id: string) {
  const p = await view(id);
  const change = (await asSystem((db) => loadTextChange(db, p)))!;
  return { view: p, change, seen: { revision: p.revision, currentVersionId: change.currentVersionId } };
}
const logged = async (id: string) =>
  (await asSystem((db) => db.select().from(activityLog).where(eq(activityLog.entityId, id)).orderBy(activityLog.id))).map(
    (e) => `${e.action}: ${e.summary}`,
  );
const flaggedIds = async () => (await asSystem((db) => listOneOwnerDecisions(db))).map((d) => d.id);

const sinceProposed = (name: string) =>
  `The official text of this section has changed since ${name} proposed this. ${name} needs to check the proposal against the new text and save it again before it can be approved. You can comment on it or decline it.`;
const CANNOT_BE_CHECKED =
  "The official text of this section has changed since this was proposed, and the person who proposed it can no longer change it. Decline it and make a new proposal.";

let kale: Actor;
let casey: Actor;
let karen: Actor;

beforeAll(async () => {
  kale = await actorFor("kale@example.com");
  casey = await actorFor("casey@example.com");
  karen = await insertUser("Karen", "karen@example.com", "advisor");
});

describe("an old proposal, after both Owners agreed on newer text", () => {
  let benefits: string;
  let old: string;

  it("cannot be approved by the other Owner: the agreed text stays, and nothing is recorded", async () => {
    benefits = await section("Benefits");
    // Casey proposes; Kale does not act on it.
    old = await createProposal(casey, {
      kind: "decision",
      sectionId: benefits,
      title: "Staff discount 10%",
      proposedOfficial: doc("Staff discount: 10%."),
    });
    // Later both agree on something fuller, through another proposal.
    const agreed = await createProposal(kale, {
      kind: "decision",
      sectionId: benefits,
      title: "Benefits package",
      proposedOfficial: doc("Staff discount: 25%. Paid sick days: 5 a year."),
    });
    expect(await approveProposal(casey, agreed, { revision: 1, currentVersionId: null })).toEqual({ approved: true, waitingFor: [] });
    expect(await officialText(benefits)).toBe("Staff discount: 25%. Paid sick days: 5 a year.");

    // Weeks later Kale opens Casey's old proposal. His page says the text
    // has changed since, and offers him no way to approve it.
    const kalesPage = await page(old);
    expect(kalesPage.view.outOfDate).toBe(true);
    expect(kalesPage.change.changedSince).toBe(true);
    expect(approveChoices(kalesPage.view, kale, await owners())).toEqual({ approve: false, alone: false });
    // If he presses Approve anyway (an old page, say), it is refused.
    await expect(approveProposal(kale, old, kalesPage.seen)).rejects.toThrow(sinceProposed("Casey"));
    await expect(approveAlone(kale, old, kalesPage.seen)).rejects.toThrow(sinceProposed("Casey"));
    await expect(approveProposal(kale, old, kalesPage.seen)).rejects.toThrow(AppError);

    expect(await officialText(benefits)).toBe("Staff discount: 25%. Paid sick days: 5 a year.");
    const after = await view(old);
    expect(after.status).toBe("open");
    expect(after.approvals.map((a) => a.name)).toEqual(["Casey"]);
    expect(await logged(old)).toEqual(["proposal.created: Proposed: Staff discount 10%"]);
    expect(await flaggedIds()).toEqual([]);

    // It is waiting for Casey, who proposed it, to look at it again.
    expect(waitingOn(after, await owners())).toEqual({ step: "check", ids: [casey.id], names: ["Casey"], needed: 0 });
    expect(waitingText(after, await owners(), casey.id)).toBe("Waiting for you to check it against the new official text");
    expect(waitingText(after, await owners(), kale.id)).toBe("Waiting for Casey to check it against the new official text");
    expect(await asSystem((db) => countAwaiting(db, casey))).toBe(1);
    expect(await asSystem((db) => countAwaiting(db, kale))).toBe(0);
    expect((await loadToday(casey)).awaiting.map((p) => p.id)).toEqual([old]);
  });

  it("a fixed typo in the title does not make it up to date", async () => {
    const input = { kind: "decision" as const, sectionId: benefits, title: "Staff discount: 10%", proposedOfficial: doc("Staff discount: 10%.") };
    const before = await view(old);
    await editProposal(casey, old, input);
    const after = await view(old);
    expect(after).toMatchObject({ title: "Staff discount: 10%", revision: 2, outOfDate: true, baseVersionId: before.baseVersionId });
    expect((await page(old)).change.changedSince).toBe(true);
    await expect(approveProposal(kale, old, (await page(old)).seen)).rejects.toThrow(sinceProposed("Casey"));
    expect((await logged(old)).at(-1)).toBe("proposal.edited: Changed their proposal: Staff discount: 10%");
  });

  it("is refused from an edit page that showed older official text", async () => {
    const input = { kind: "decision" as const, sectionId: benefits, title: "Staff discount: 10%", proposedOfficial: doc("Staff discount: 10%.") };
    // Her edit page was opened when the section had no official text.
    await expect(editProposal(casey, old, input, { currentVersionId: null })).rejects.toThrow(
      "The official text of this section changed after you opened this page. Reload the page and read it again, then save.",
    );
    // Something that is not a version of this section at all.
    await expect(editProposal(casey, old, input, { currentVersionId: "00000000-0000-4000-8000-000000000000" })).rejects.toThrow(
      "The official text of this section changed after you opened this page.",
    );
    expect(await view(old)).toMatchObject({ revision: 2, outOfDate: true });
  });

  it("once its proposer has checked it against the new text, the other Owner can approve, and two people decided", async () => {
    const input = { kind: "decision" as const, sectionId: benefits, title: "Staff discount: 10%", proposedOfficial: doc("Staff discount: 10%.") };
    // Casey's edit page shows the current official text next to her proposal. She changes nothing and saves.
    const shown = await currentId(benefits);
    await editProposal(casey, old, input, { currentVersionId: shown });
    const checked = await view(old);
    // Saving it again is a real change: a new revision, and the log says what she did.
    expect(checked).toMatchObject({ revision: 3, outOfDate: false, baseVersionId: shown, proposerCanChange: true });
    expect((await logged(old)).at(-1)).toBe("proposal.rechecked: Checked their proposal against the new official text: Staff discount: 10%");
    expect(waitingText(checked, await owners(), kale.id)).toBe("Waiting for you");
    expect(await asSystem((db) => countAwaiting(db, kale))).toBe(1);
    expect(approveChoices(checked, kale, await owners())).toEqual({ approve: true, alone: false });

    // Kale's old page (revision 2) is refused; a fresh one goes through.
    await expect(approveProposal(kale, old, { revision: 2, currentVersionId: shown })).rejects.toThrow("Casey changed this proposal after you opened it");
    expect(await approveProposal(kale, old, (await page(old)).seen)).toEqual({ approved: true, waitingFor: [] });
    const done = await view(old);
    expect(done).toMatchObject({ status: "approved", decidedAlone: false, soloOpen: false });
    expect(statusLine(done)).toMatch(/^Approved by Casey and Kale, /);
    expect(await officialText(benefits)).toBe("Staff discount: 10%.");
    expect(await flaggedIds()).not.toContain(old);
  });
});

describe("checking a proposal again", () => {
  it("saving it without any change writes nothing and logs nothing, for every kind of proposal", async () => {
    const hiring = await section("Hiring");
    const quotes = await section("Quotes");
    const budget = await section("Budget");
    const finance = await section("Finance");
    const marketing = await section("Marketing and Events");
    const text = { kind: "decision" as const, sectionId: hiring, title: "Hire in March", proposedOfficial: doc("We hire in March.") };
    const inputs = [
      text,
      { kind: "structure" as const, change: { action: "rename" as const, sectionId: quotes, title: "Quotes and Bids" } },
      { kind: "structure" as const, change: { action: "add" as const, parentId: null, title: "Safety" } },
      { kind: "structure" as const, change: { action: "add" as const, parentId: finance, title: "Taxes" } },
      { kind: "structure" as const, change: { action: "move" as const, sectionId: budget, parentId: marketing } },
      { kind: "structure" as const, change: { action: "move" as const, sectionId: quotes, parentId: null } },
      { kind: "structure" as const, change: { action: "archive" as const, sectionId: budget } },
    ];
    for (const input of inputs) {
      const id = await createProposal(kale, input);
      const [before] = await asSystem((db) => db.select().from(proposals).where(eq(proposals.id, id)));
      await editProposal(kale, id, input);
      // The same again, as an edit page for a text proposal would send it.
      await editProposal(kale, id, input, { currentVersionId: null });
      const [after] = await asSystem((db) => db.select().from(proposals).where(eq(proposals.id, id)));
      expect(after.revision).toBe(1);
      expect(after.updatedAt).toEqual(before.updatedAt);
      expect((await logged(id)).map((line) => line.split(":")[0])).toEqual(["proposal.created"]);
      await withdrawProposal(kale, id);
    }
  });

  it("a real change to a section proposal is still saved and logged", async () => {
    const quotes = await section("Quotes");
    const id = await createProposal(kale, { kind: "structure", change: { action: "rename", sectionId: quotes, title: "Quotes and Bids" } });
    await editProposal(kale, id, { kind: "structure", change: { action: "rename", sectionId: quotes, title: "Bids" } });
    expect(await view(id)).toMatchObject({ revision: 2, structureChange: { action: "rename", title: "Bids", fromTitle: "Quotes" } });
    expect(await logged(id)).toEqual([
      'proposal.created: Proposed: Rename 8.2 Quotes to "Quotes and Bids"',
      'proposal.edited: Changed their proposal: Rename 8.2 Quotes to "Bids"',
    ]);
    await withdrawProposal(kale, id);
  });

  it("a change made together with the check is logged as a change", async () => {
    const training = await section("Training");
    const id = await createProposal(kale, { kind: "decision", sectionId: training, title: "Shadow shifts", proposedOfficial: doc("New staff shadow for two shifts.") });
    await saveOfficial(casey, training, doc("New staff get a tour on day one."));
    const shown = await currentId(training);
    await editProposal(
      kale,
      id,
      { kind: "decision", sectionId: training, title: "Shadow shifts", proposedOfficial: doc("New staff get a tour on day one.", "They shadow for two shifts.") },
      { currentVersionId: shown },
    );
    expect(await view(id)).toMatchObject({ revision: 2, outOfDate: false, baseVersionId: shown });
    expect((await logged(id)).at(-1)).toBe("proposal.edited: Changed their proposal: Shadow shifts");
    expect(await approveProposal(casey, id, (await page(id)).seen)).toEqual({ approved: true, waitingFor: [] });
    expect(await officialText(training)).toBe("New staff get a tour on day one.\nThey shadow for two shifts.");
  });
});

describe("a new proposal made from a page that showed older official text", () => {
  it("is refused; one made from the current text, or with no page involved, is taken", async () => {
    const hours = await section("Store Hours");
    await saveOfficial(kale, hours, doc("Open 9 to 6."));
    const first = await currentId(hours);
    const make = (baseVersionId?: string | null) =>
      createProposal(casey, { kind: "official_text", sectionId: hours, title: "Sunday hours", proposedOfficial: doc("Open 9 to 6.", "Closed Sundays."), baseVersionId });

    // Casey's form started from the first text. Kale changes it before she presses Propose.
    await saveOfficial(kale, hours, doc("Open 8 to 6."));
    const STALE_FORM =
      "The official text of this section changed after you opened this page. Reload the page. What you typed is kept on this device.";
    await expect(make(first)).rejects.toThrow(STALE_FORM);
    // A form that started from "no official text yet", or from something that is not a version.
    await expect(make(null)).rejects.toThrow(STALE_FORM);
    await expect(make("not-a-version")).rejects.toThrow(STALE_FORM);
    expect((await asSystem((db) => db.select().from(proposals).where(eq(proposals.sectionId, hours)))).filter((p) => !p.direct)).toEqual([]);

    // From a form that started from the current text.
    const second = await currentId(hours);
    const fresh = await make(second);
    expect(await view(fresh)).toMatchObject({ baseVersionId: second, outOfDate: false });
    await withdrawProposal(casey, fresh);
    // With no page involved, the current version is used.
    const plain = await make();
    expect(await view(plain)).toMatchObject({ baseVersionId: second, outOfDate: false });
    await withdrawProposal(casey, plain);
    // In a section with no official text, a form that started from nothing is right.
    const scheduling = await section("Scheduling");
    const blank = await createProposal(casey, { kind: "decision", sectionId: scheduling, title: "Two-week schedules", proposedOfficial: doc("Schedules go up two weeks ahead."), baseVersionId: null });
    expect(await view(blank)).toMatchObject({ baseVersionId: null, outOfDate: false });
    await withdrawProposal(casey, blank);
  });
});

describe("approving an out-of-date proposal on your own", () => {
  it("is still possible for its proposer, and is flagged for the other Owner", async () => {
    const wages = await section("Wages");
    await saveOfficial(kale, wages, doc("Garden staff start at $15/hr."));
    const id = await createProposal(kale, { kind: "decision", sectionId: wages, title: "Coffee wages", proposedOfficial: doc("Garden staff start at $15/hr.", "Coffee staff start at $13/hr.") });
    await saveOfficial(casey, wages, doc("Garden staff start at $16/hr."), { baseVersionId: await currentId(wages) });

    const kalesPage = await page(id);
    expect(kalesPage.view.outOfDate).toBe(true);
    expect(approveChoices(kalesPage.view, kale, await owners())).toEqual({ approve: false, alone: true });
    // Plain Approve is refused for him too; "Approve on my own" goes through.
    await expect(approveProposal(kale, id, kalesPage.seen)).rejects.toThrow(sinceProposed("Kale"));
    await approveAlone(kale, id, kalesPage.seen);

    const done = await view(id);
    expect(done).toMatchObject({ status: "approved", decidedAlone: true, soloOpen: true, outOfDate: false });
    expect(statusLine(done)).toMatch(/^Approved by Kale, /);
    expect(await officialText(wages)).toBe("Garden staff start at $15/hr.\nCoffee staff start at $13/hr.");
    expect(await flaggedIds()).toContain(id);
    expect(canApproveToo(done, casey)).toBe(true);
    expect((await loadToday(casey)).decidedAlone.map((p) => p.id)).toContain(id);
  });

  it("is the only way left when its proposer can no longer change it", async () => {
    const perennials = await section("Perennials");
    const annuals = await section("Annuals");
    const sam = await insertUser("Sam", "sam@example.com", "owner");
    const fromSam = await createProposal(sam, { kind: "decision", sectionId: perennials, title: "Order perennials in January", proposedOfficial: doc("Perennials are ordered in January.") });
    const endorsed = await createProposal(kale, { kind: "decision", sectionId: annuals, title: "Annuals arrive in May", proposedOfficial: doc("Annuals arrive in May.") });
    await endorseProposal(karen, endorsed, { revision: 1 });
    await saveOfficial(kale, perennials, doc("Perennials: to be decided."));
    await saveOfficial(casey, annuals, doc("Annuals: to be decided."));
    await removeUser(kale, sam.id);

    // Sam has been removed: nobody can check his proposal against the new text.
    let p = await view(fromSam);
    expect(p).toMatchObject({ outOfDate: true, proposerCanChange: false });
    expect(waitingOn(p, await owners())).toEqual({ step: "stuck", ids: [casey.id, kale.id], names: ["Casey", "Kale"], needed: 0 });
    expect(waitingText(p, await owners(), casey.id)).toBe("The official text changed and it can no longer be approved. Decline it.");
    expect(approveChoices(p, casey, await owners())).toEqual({ approve: false, alone: true });
    await expect(approveProposal(casey, fromSam, (await page(fromSam)).seen)).rejects.toThrow(CANNOT_BE_CHECKED);
    // One person can still make it official, which is flagged for the other.
    await approveAlone(casey, fromSam, (await page(fromSam)).seen);
    p = await view(fromSam);
    expect(p).toMatchObject({ status: "approved", decidedAlone: true, soloOpen: true });
    expect(await flaggedIds()).toContain(fromSam);
    expect(canApproveToo(p, kale)).toBe(true);

    // Karen endorsed Kale's proposal, so he can no longer change it either.
    p = await view(endorsed);
    expect(p).toMatchObject({ outOfDate: true, proposerCanChange: false });
    expect(waitingOn(p, await owners())?.step).toBe("stuck");
    await expect(approveProposal(casey, endorsed, (await page(endorsed)).seen)).rejects.toThrow(CANNOT_BE_CHECKED);
    await expect(approveAlone(casey, endorsed, (await page(endorsed)).seen)).rejects.toThrow(CANNOT_BE_CHECKED);
    await expect(
      editProposal(kale, endorsed, { kind: "decision", sectionId: annuals, title: "Annuals arrive in May", proposedOfficial: doc("Annuals arrive in May.") }, { currentVersionId: await currentId(annuals) }),
    ).rejects.toThrow("can no longer be changed");
    expect((await view(endorsed)).approvals.map((a) => a.name)).toEqual(["Kale"]);
    await withdrawProposal(kale, endorsed);
  });
});

describe("database rules: two people's approval needs the proposal to be up to date", () => {
  const OUT_OF_DATE = /^PPF03: [\s\S]*official text of this section has changed/;
  /** Approve a proposal straight at the database, the way the app does it: approval, decision, version. */
  const approveAt = (by: Actor, id: string, sectionId: string, text: string, addApproval: boolean) =>
    asUser(by.id, async (tx) => {
      const [p] = await tx.select().from(proposals).where(eq(proposals.id, id));
      if (addApproval) await tx.insert(approvals).values({ proposalId: id, userId: by.id, revision: p.revision });
      await tx.update(proposals).set({ status: "approved", decidedBy: by.id }).where(eq(proposals.id, id));
      return tx
        .insert(officialVersions)
        .values({ sectionId, version: 1, content: doc(text), contentText: text, createdBy: by.id, proposalId: id })
        .returning();
    });

  it("refuses the second Owner's approval of an out-of-date proposal, and takes it once the proposal has been checked", async () => {
    const signage = await section("Signage");
    await saveOfficial(kale, signage, doc("Pylon sign: quote requested."));
    const id = await createProposal(kale, { kind: "decision", sectionId: signage, title: "Holly Lumber", proposedOfficial: doc("Pylon sign: Holly Lumber.") });
    await saveOfficial(casey, signage, doc("Pylon sign: two quotes requested."));

    expect(await refusal(approveAt(casey, id, signage, "Pylon sign: Holly Lumber.", true))).toMatch(OUT_OF_DATE);
    expect(await view(id)).toMatchObject({ status: "open", outOfDate: true });
    expect((await view(id)).approvals.map((a) => a.name)).toEqual(["Kale"]);

    // Kale points his proposal at the version that is current now (what checking it does).
    const current = await currentId(signage);
    await asUser(kale.id, (tx) => tx.update(proposals).set({ baseVersionId: current }).where(eq(proposals.id, id)));
    const [version] = await approveAt(casey, id, signage, "Pylon sign: Holly Lumber.", true);
    expect(version.version).toBe(3);
    expect(await view(id)).toMatchObject({ status: "approved", decidedAlone: false, revision: 2 });
  });

  it("allows one person to approve an out-of-date proposal, and records that one person decided", async () => {
    const construction = await section("Construction");
    await saveOfficial(kale, construction, doc("Paving: spring."));
    const id = await createProposal(kale, { kind: "decision", sectionId: construction, title: "Pave in fall", proposedOfficial: doc("Paving: fall.") });
    await saveOfficial(casey, construction, doc("Paving: after the frost."));
    expect((await view(id)).outOfDate).toBe(true);
    const [version] = await approveAt(kale, id, construction, "Paving: fall.", false);
    expect(version.version).toBe(3);
    expect(await view(id)).toMatchObject({ status: "approved", decidedAlone: true, soloOpen: true });
  });

  it("does not hold up a section change, or a text proposal for a section that never had official text", async () => {
    // A section with official text, renamed by a proposal that both approve.
    const construction = await section("Construction");
    const rename = await createProposal(kale, { kind: "structure", change: { action: "rename", sectionId: construction, title: "Building work" } });
    expect(await approveProposal(casey, rename, { revision: 1 })).toEqual({ approved: true, waitingFor: [] });
    expect(await view(rename)).toMatchObject({ status: "approved", decidedAlone: false });
    // No official text before or now: "written against nothing" is up to date.
    const offices = await section("Offices and Finishing");
    const first = await createProposal(kale, { kind: "decision", sectionId: offices, title: "Paint", proposedOfficial: doc("Offices are painted white.") });
    const [version] = await approveAt(casey, first, offices, "Offices are painted white.", true);
    expect(version.version).toBe(1);
    expect(await view(first)).toMatchObject({ status: "approved", decidedAlone: false });
  });
});
