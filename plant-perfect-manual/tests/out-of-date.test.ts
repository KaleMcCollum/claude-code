import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { asSystem, asUser } from "@/db/client";
import { activityLog, approvals, officialVersions, proposals, sections } from "@/db/schema";
import { listVersions, loadOfficial, restoreVersion, saveOfficial } from "@/lib/official";
import { type Actor, AppError } from "@/lib/permissions";
import {
  type ProposalView,
  activeApprovers,
  approveAlone,
  approveChoices,
  approveProposal,
  canApproveToo,
  canEditProposal,
  canEndorse,
  countAwaiting,
  createProposal,
  declineProposal,
  editProposal,
  endorseProposal,
  listOneOwnerDecisions,
  listOpenProposalsForSection,
  loadProposal,
  loadTextChange,
  statusLine,
  waitingOn,
  waitingText,
  withdrawProposal,
} from "@/lib/proposals";
import { type RichDoc, docToText } from "@/lib/richtext";
import { loadToday } from "@/lib/today";
import { changeUserRole, removeUser } from "@/lib/users";
import { actorFor, insertUser, refusal, withTestDatabase } from "./helpers/db";

withTestDatabase();

/**
 * A waiting text proposal goes out of date when the official text of its
 * section changes: its proposer's approval was given on top of the older
 * text. Nobody can approve it then, together or alone, its proposer
 * included, until the proposer has checked it against the new text and
 * saved it again. After that it can be approved as usual, alone too. (The
 * stories behind that rule: tests/out-of-date-alone.test.ts.)
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
    // Her edit page was opened when the section had no official text. The
    // page draws itself again in place, with her words still there and the
    // new official text shown: the message says so, and asks for no reload.
    const STALE_EDIT_PAGE =
      "The official text of this section changed while you had this page open. Nothing you typed is lost. The new official text is now shown above the proposed text: read it, then save again.";
    await expect(editProposal(casey, old, input, { currentVersionId: null })).rejects.toThrow(STALE_EDIT_PAGE);
    // Something that is not a version of this section at all.
    await expect(editProposal(casey, old, input, { currentVersionId: "00000000-0000-4000-8000-000000000000" })).rejects.toThrow(STALE_EDIT_PAGE);
    expect(await view(old)).toMatchObject({ revision: 2, outOfDate: true });
    // The other buttons, where nothing was typed, still ask for the page to be loaded again.
    await expect(approveAlone(casey, old, { revision: 2, currentVersionId: null })).rejects.toThrow(
      "The official text of this section changed after you opened this page. Reload the page and read it again, then approve.",
    );
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
      "The official text of this section changed while you were writing. Nothing you typed is lost. The new official text is now shown above what you typed: choose there whether to start over from it or keep what you typed, then propose again.";
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
  it("is not possible for its proposer either, until they have checked it; then it is, and it is flagged for the other Owner", async () => {
    const wages = await section("Wages");
    await saveOfficial(kale, wages, doc("Garden staff start at $15/hr."));
    const input = { kind: "decision" as const, sectionId: wages, title: "Coffee wages", proposedOfficial: doc("Garden staff start at $15/hr.", "Coffee staff start at $13/hr.") };
    const id = await createProposal(kale, input);
    // Casey gives the garden staff a raise, directly.
    await saveOfficial(casey, wages, doc("Garden staff start at $16/hr."), { baseVersionId: await currentId(wages) });

    const kalesPage = await page(id);
    expect(kalesPage.view.outOfDate).toBe(true);
    expect(approveChoices(kalesPage.view, kale, await owners())).toEqual({ approve: false, alone: false });
    // Plain Approve is refused for him, and so is "Approve on my own": his
    // older words would take Casey's raise out again. Nothing is recorded.
    await expect(approveProposal(kale, id, kalesPage.seen)).rejects.toThrow(sinceProposed("Kale"));
    await expect(approveAlone(kale, id, kalesPage.seen)).rejects.toThrow(
      "The official text of this section has changed since you proposed this. Check your proposal against the new text and save it again. Then it can be approved.",
    );
    expect(await officialText(wages)).toBe("Garden staff start at $16/hr.");
    expect(await view(id)).toMatchObject({ status: "open", outOfDate: true });
    expect((await view(id)).approvals.map((a) => a.name)).toEqual(["Kale"]);
    expect(await logged(id)).toEqual(["proposal.created: Proposed: Coffee wages"]);
    expect(await flaggedIds()).not.toContain(id);

    // He checks it against her text, keeps her raise, and saves it again. Now he can.
    await editProposal(
      kale,
      id,
      { ...input, proposedOfficial: doc("Garden staff start at $16/hr.", "Coffee staff start at $13/hr.") },
      { currentVersionId: await currentId(wages) },
    );
    const checked = await page(id);
    expect(approveChoices(checked.view, kale, await owners())).toEqual({ approve: false, alone: true });
    await approveAlone(kale, id, checked.seen);

    const done = await view(id);
    expect(done).toMatchObject({ status: "approved", decidedAlone: true, soloOpen: true, outOfDate: false });
    expect(statusLine(done)).toMatch(/^Approved by Kale, /);
    expect(await officialText(wages)).toBe("Garden staff start at $16/hr.\nCoffee staff start at $13/hr.");
    expect(await flaggedIds()).toContain(id);
    expect(canApproveToo(done, casey)).toBe(true);
    expect((await loadToday(casey)).decidedAlone.map((p) => p.id)).toContain(id);
  });

  it("is not possible for anyone else, also when its proposer can no longer change it", async () => {
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
    // Sam's approval is on it, and Sam never saw the newer text: nobody is
    // offered either button, and neither press goes through.
    for (const who of [casey, kale]) {
      expect(approveChoices(p, who, await owners())).toEqual({ approve: false, alone: false });
      await expect(approveProposal(who, fromSam, (await page(fromSam)).seen)).rejects.toThrow(CANNOT_BE_CHECKED);
      await expect(approveAlone(who, fromSam, (await page(fromSam)).seen)).rejects.toThrow(CANNOT_BE_CHECKED);
    }
    p = await view(fromSam);
    expect(p.status).toBe("open");
    expect(p.approvals.map((a) => a.name)).toEqual(["Sam"]);
    expect(await officialText(perennials)).toBe("Perennials: to be decided.");
    expect(await flaggedIds()).not.toContain(fromSam);
    // The way forward is the one the message names.
    await declineProposal(casey, fromSam, "The text has moved on.");

    // Karen endorsed Kale's proposal, so he can no longer change it either.
    // "It can no longer be approved" is true for everyone, Kale included.
    p = await view(endorsed);
    expect(p).toMatchObject({ outOfDate: true, proposerCanChange: false });
    expect(waitingOn(p, await owners())?.step).toBe("stuck");
    for (const who of [casey, kale]) expect(approveChoices(p, who, await owners())).toEqual({ approve: false, alone: false });
    await expect(approveProposal(casey, endorsed, (await page(endorsed)).seen)).rejects.toThrow(CANNOT_BE_CHECKED);
    await expect(approveAlone(casey, endorsed, (await page(endorsed)).seen)).rejects.toThrow(CANNOT_BE_CHECKED);
    await expect(approveAlone(kale, endorsed, (await page(endorsed)).seen)).rejects.toThrow(
      "The official text of this section has changed since you proposed this, and you can no longer change it. Withdraw it and make a new proposal.",
    );
    expect(await officialText(annuals)).toBe("Annuals: to be decided.");
    await expect(
      editProposal(kale, endorsed, { kind: "decision", sectionId: annuals, title: "Annuals arrive in May", proposedOfficial: doc("Annuals arrive in May.") }, { currentVersionId: await currentId(annuals) }),
    ).rejects.toThrow("can no longer be changed");
    expect((await view(endorsed)).approvals.map((a) => a.name)).toEqual(["Kale"]);
    await withdrawProposal(kale, endorsed);
  });

  it("a proposer who has been made an Advisor can no longer check it either", async () => {
    const houseplants = await section("Houseplants");
    const robin = await insertUser("Robin", "robin@example.com", "owner");
    const id = await createProposal(robin, { kind: "decision", sectionId: houseplants, title: "Water on Mondays", proposedOfficial: doc("Houseplants are watered on Mondays.") });
    await saveOfficial(kale, houseplants, doc("Houseplants: to be decided."));
    // While Robin is an Owner, the proposal waits for Robin to check it.
    expect(await view(id)).toMatchObject({ outOfDate: true, proposerCanChange: true });
    expect(waitingOn(await view(id), await owners())).toMatchObject({ step: "check", ids: [robin.id] });
    await expect(approveProposal(casey, id, (await page(id)).seen)).rejects.toThrow(sinceProposed("Robin"));

    await changeUserRole(kale, robin.id, "advisor");
    expect(await view(id)).toMatchObject({ outOfDate: true, proposerCanChange: false });
    expect(waitingOn(await view(id), await owners())).toMatchObject({ step: "stuck", ids: [casey.id, kale.id] });
    await expect(approveProposal(casey, id, (await page(id)).seen)).rejects.toThrow(CANNOT_BE_CHECKED);
    expect((await view(id)).approvals.map((a) => a.name)).toEqual(["Robin"]);
    await declineProposal(casey, id, "The text has moved on.");
  });

  it("once another Owner has approved it, its proposer cannot check it any more: it is stuck for everyone", async () => {
    const hardGoods = await section("Hard Goods");
    const jo = await insertUser("Jo", "jo@example.com", "owner");
    const id = await createProposal(kale, { kind: "decision", sectionId: hardGoods, title: "Carry hose reels", proposedOfficial: doc("Hard goods include hose reels.") });
    // Casey approves while Kale is not an Owner, so it stays open; then Kale is an Owner again.
    await changeUserRole(casey, kale.id, "advisor");
    expect(await approveProposal(casey, id, (await page(id)).seen)).toEqual({ approved: false, waitingFor: ["Jo"] });
    await changeUserRole(casey, kale.id, "owner");
    expect(approveChoices(await view(id), kale, await owners())).toEqual({ approve: true, alone: false });
    // Before anyone presses Approve again, Jo changes the official text.
    await saveOfficial(jo, hardGoods, doc("Hard goods: to be decided."));

    const p = await view(id);
    expect(p).toMatchObject({ outOfDate: true, proposerCanChange: false });
    expect(p.approvals.map((a) => a.name)).toEqual(["Kale", "Casey"]);
    expect(waitingOn(p, await owners())).toMatchObject({ step: "stuck", names: ["Casey", "Kale", "Jo"] });
    // Two Owners' names are on it already, so nobody can approve it, alone or not.
    for (const who of [kale, casey, jo]) {
      expect(approveChoices(p, who, await owners())).toEqual({ approve: false, alone: false });
      await expect(approveProposal(who, id, (await page(id)).seen)).rejects.toThrow(CANNOT_BE_CHECKED);
      // "Approve on my own" tells its proposer what he himself can do: withdraw it.
      await expect(approveAlone(who, id, (await page(id)).seen)).rejects.toThrow(
        who === kale
          ? "The official text of this section has changed since you proposed this, and you can no longer change it. Withdraw it and make a new proposal."
          : CANNOT_BE_CHECKED,
      );
    }
    await expect(
      editProposal(kale, id, { kind: "decision", sectionId: hardGoods, title: "Carry hose reels", proposedOfficial: doc("Hard goods include hose reels.") }, { currentVersionId: await currentId(hardGoods) }),
    ).rejects.toThrow("can no longer be changed");
    expect(await officialText(hardGoods)).toBe("Hard goods: to be decided.");
    await withdrawProposal(kale, id);
    await removeUser(kale, jo.id);
  });
});

describe("endorsing a proposal that is out of date", () => {
  const ONCE_CHECKED = (name: string) =>
    `The official text of this section has changed since this was proposed. It can be endorsed once ${name} has checked it against the new text.`;
  const NEVER =
    "The official text of this section has changed since this was proposed, and it can no longer be approved. It cannot be endorsed.";

  it("is refused while it waits for its proposer's check, so that the check stays possible", async () => {
    const closing = await section("Closing Procedures");
    const input = { kind: "decision" as const, sectionId: closing, title: "Lock the gate", proposedOfficial: doc("The gate is locked at closing.") };
    const id = await createProposal(casey, input);
    // Karen's and Kale's pages, opened now, show Endorse.
    const before = await view(id);
    expect([canEndorse(before, karen), canEndorse(before, kale)]).toEqual([true, true]);
    await saveOfficial(kale, closing, doc("Closing: to be decided."));
    const p = await view(id);
    expect(p).toMatchObject({ outOfDate: true, proposerCanChange: true });
    expect([canEndorse(p, karen), canEndorse(p, kale)]).toEqual([false, false]);
    // A press from the page opened earlier, by an Advisor or an Owner.
    await expect(endorseProposal(karen, id, { revision: 1 })).rejects.toThrow(ONCE_CHECKED("Casey"));
    await expect(endorseProposal(kale, id, { revision: 1 })).rejects.toThrow(ONCE_CHECKED("Casey"));
    // The checks that were there before still come first.
    await expect(endorseProposal(casey, id, { revision: 1 })).rejects.toThrow("You have already approved this, which says more than an endorsement.");
    await expect(endorseProposal(karen, id, { revision: 7 })).rejects.toThrow("Casey changed this proposal after you opened it.");
    expect((await view(id)).endorsements).toEqual([]);
    expect(await logged(id)).toEqual(["proposal.created: Proposed: Lock the gate"]);

    // Nothing stands in the way of Casey's check. Once it is up to date it can be endorsed.
    expect((await view(id)).proposerCanChange).toBe(true);
    await editProposal(casey, id, { ...input, proposedOfficial: doc("Closing: to be decided.", "The gate is locked at closing.") }, { currentVersionId: await currentId(closing) });
    expect(await view(id)).toMatchObject({ outOfDate: false, revision: 2 });
    expect(canEndorse(await view(id), karen)).toBe(true);
    await endorseProposal(karen, id, { revision: 2 });
    expect((await view(id)).endorsements.map((e) => e.name)).toEqual(["Karen"]);
    await withdrawProposal(casey, id);
  });

  it("is refused in other words when nobody can bring the proposal up to date any more", async () => {
    // Its proposer has been made an Advisor.
    const opening = await section("Opening Procedures");
    const lee = await insertUser("Lee", "lee@example.com", "owner");
    const fromLee = await createProposal(lee, { kind: "decision", sectionId: opening, title: "Lights on at 7", proposedOfficial: doc("Lights go on at 7.") });
    await saveOfficial(kale, opening, doc("Opening: to be decided."));
    await changeUserRole(kale, lee.id, "advisor");
    expect(waitingOn(await view(fromLee), await owners())?.step).toBe("stuck");
    expect([canEndorse(await view(fromLee), karen), canEndorse(await view(fromLee), casey)]).toEqual([false, false]);
    await expect(endorseProposal(karen, fromLee, { revision: 1 })).rejects.toThrow(NEVER);
    await expect(endorseProposal(casey, fromLee, { revision: 1 })).rejects.toThrow(NEVER);
    expect((await view(fromLee)).endorsements).toEqual([]);
    await declineProposal(casey, fromLee, "The text has moved on.");
    await removeUser(kale, lee.id);

    // Someone endorsed it before the official text changed: that stays as
    // decided (its proposer can no longer change it), and nobody else can
    // add their name afterwards.
    const policies = await section("Policies and Expectations");
    const endorsed = await createProposal(casey, { kind: "decision", sectionId: policies, title: "Name tags", proposedOfficial: doc("Staff wear name tags.") });
    await endorseProposal(karen, endorsed, { revision: 1 });
    await saveOfficial(kale, policies, doc("Policies: to be decided."));
    expect(await view(endorsed)).toMatchObject({ outOfDate: true, proposerCanChange: false, proposerCanWithdraw: true });
    await expect(endorseProposal(kale, endorsed, { revision: 1 })).rejects.toThrow(NEVER);
    // Karen pressing Endorse a second time is still quietly not needed.
    await expect(endorseProposal(karen, endorsed, { revision: 1 })).resolves.toBeUndefined();
    expect((await view(endorsed)).endorsements.map((e) => e.name)).toEqual(["Karen"]);
    expect((await logged(endorsed)).filter((line) => line.startsWith("proposal.endorsed"))).toHaveLength(1);
    // What each of them reads, and that it can be followed.
    const p = await view(endorsed);
    expect([casey, kale, karen].map((who) => waitingText(p, [casey, kale], who.id))).toEqual([
      "The official text changed and you can no longer change this proposal. Withdraw it and make a new one.",
      "The official text changed and it can no longer be approved. Decline it.",
      "The official text changed and it can no longer be approved.",
    ]);
    await withdrawProposal(casey, endorsed);
  });

  it("an approved proposal can still be endorsed, also after the official text has moved on", async () => {
    const legal = await section("Legal Entities");
    const id = await createProposal(kale, { kind: "decision", sectionId: legal, title: "One company", proposedOfficial: doc("One company owns both businesses.") });
    await approveAlone(kale, id, (await page(id)).seen);
    // While its words are the official text (which is what approving it made
    // them): "the official text already says this" is no reason to refuse here.
    expect(await view(id)).toMatchObject({ status: "approved", superseded: false, sameAsOfficial: false });
    await endorseProposal(casey, id, { revision: 1 });
    await saveOfficial(casey, legal, doc("Two companies, one owner."));
    const approved = await view(id);
    expect(approved).toMatchObject({ status: "approved", superseded: true, outOfDate: false });
    expect([canEndorse(approved, karen), canEndorse(approved, casey)]).toEqual([true, false]);
    await endorseProposal(karen, id, { revision: 1 });
    expect((await view(id)).endorsements.map((e) => e.name)).toEqual(["Casey", "Karen"]);
  });
});

describe("a waiting proposal whose text the official text already says", () => {
  const ALREADY = "The official text already says this.";
  const NOTHING_TO_APPROVE = "The official text of this section already says what this proposes, so there is nothing to approve.";
  const versionsOf = async (sectionId: string) => (await asSystem((db) => listVersions(db, sectionId))).length;
  const awaiting = (who: Actor) => asSystem((db) => countAwaiting(db, who));

  it("Kale saves word for word what Casey proposed: nothing is left to approve, and no second copy can be made", async () => {
    const pos = await section("Point of Sale");
    await saveOfficial(kale, pos, doc("Registers: two."));
    const input = { kind: "official_text" as const, sectionId: pos, title: "A third register", proposedOfficial: doc("Registers: three.") };
    const id = await createProposal(casey, input);
    expect(await view(id)).toMatchObject({ sameAsOfficial: false, outOfDate: false });
    const before = [await awaiting(casey), await awaiting(kale)];
    // Kale makes the same change directly instead of approving it.
    await saveOfficial(kale, pos, doc("Registers: three."), { baseVersionId: await currentId(pos) });
    const everyone = await owners();
    const p = await view(id);
    expect(p).toMatchObject({ sameAsOfficial: true, outOfDate: true, proposerCanChange: true, proposerCanWithdraw: true });
    expect(waitingOn(p, everyone)).toEqual({ step: "same", ids: [casey.id, kale.id], names: ["Casey", "Kale"], needed: 0 });
    expect([casey, kale, karen].map((who) => waitingText(p, everyone, who.id))).toEqual([
      `${ALREADY} Withdraw it.`,
      `${ALREADY} Casey can withdraw it, or you can decline it.`,
      ALREADY,
    ]);
    // It was waiting for Kale; now it is on both Owners' lists, because either can clear it away.
    expect([await awaiting(casey), await awaiting(kale)]).toEqual([before[0] + 1, before[1]]);

    // No approve button for anyone, and no Endorse; its proposer may still change it.
    for (const who of [casey, kale, karen]) expect(approveChoices(p, who, everyone)).toEqual({ approve: false, alone: false });
    expect([canEndorse(p, karen), canEndorse(p, kale)]).toEqual([false, false]);
    expect([canEditProposal(p, casey), canEditProposal(p, kale)]).toEqual([true, false]);

    // Presses that arrive anyway (a page opened earlier would be refused for
    // being old; these send what a fresh page would, or nothing at all).
    const seen = (await page(id)).seen;
    const versions = await versionsOf(pos);
    for (const sent of [seen, { revision: 1 }]) {
      await expect(approveAlone(casey, id, sent)).rejects.toThrow(`${NOTHING_TO_APPROVE} Withdraw it.`);
      await expect(approveProposal(casey, id, sent)).rejects.toThrow(`${NOTHING_TO_APPROVE} Withdraw it.`);
      await expect(approveAlone(kale, id, sent)).rejects.toThrow(`${NOTHING_TO_APPROVE} Decline it.`);
      await expect(approveProposal(kale, id, sent)).rejects.toThrow(`${NOTHING_TO_APPROVE} Decline it.`);
    }
    // Endorse from a page opened before Kale's save: there is nothing left to
    // support, and "once Casey has checked it" would not be true (her check
    // is refused, a few lines down). The same for an Advisor and an Owner.
    const NOTHING_TO_ENDORSE = "The official text of this section already says what this proposes, so there is nothing to endorse.";
    for (const who of [karen, kale]) {
      const told = await endorseProposal(who, id, { revision: 1 }).then(() => "(it went through)", (error: Error) => error.message);
      expect(told).toBe(NOTHING_TO_ENDORSE);
    }
    expect(await versionsOf(pos)).toBe(versions);
    expect(await view(id)).toMatchObject({ status: "open", endorsements: [] });
    expect((await view(id)).approvals.map((a) => a.name)).toEqual(["Casey"]);
    expect(await logged(id)).toEqual(["proposal.created: Proposed: A third register"]);
    expect(await flaggedIds()).not.toContain(id);
    // "Check and save again" could only have ended in this refusal.
    await expect(editProposal(casey, id, input, { currentVersionId: await currentId(pos) })).rejects.toThrow(
      "The proposed official text is the same as the current one.",
    );

    // Its proposer may still change it to say something else: then it is an ordinary proposal again.
    await editProposal(casey, id, { ...input, proposedOfficial: doc("Registers: four.") }, { currentVersionId: await currentId(pos) });
    expect(await view(id)).toMatchObject({ sameAsOfficial: false, outOfDate: false, revision: 2 });
    expect(approveChoices(await view(id), kale, everyone)).toEqual({ approve: true, alone: false });
    expect(waitingText(await view(id), everyone, kale.id)).toBe("Waiting for you");
    // The same words in two paragraphs are not "exactly the official text" (as on the proposing form).
    await saveOfficial(kale, pos, doc("Registers:", "four."), { baseVersionId: await currentId(pos) });
    expect(await view(id)).toMatchObject({ sameAsOfficial: false, outOfDate: true });
    expect(waitingOn(await view(id), everyone)?.step).toBe("check");
    // Out of date only: Endorse is refused in the words for that, which are true here.
    await expect(endorseProposal(karen, id, { revision: 2 })).rejects.toThrow(
      "The official text of this section has changed since this was proposed. It can be endorsed once Casey has checked it against the new text.",
    );
    // Kale saves exactly her words again, and this time she withdraws it. A decided proposal is never "the same".
    await saveOfficial(kale, pos, doc("Registers: four."), { baseVersionId: await currentId(pos) });
    expect((await view(id)).sameAsOfficial).toBe(true);
    await withdrawProposal(casey, id);
    expect(await view(id)).toMatchObject({ status: "withdrawn", sameAsOfficial: false });
  });

  it("the same after a restore, and in a section that had no official text", async () => {
    const coffee = await section("Coffee Equipment");
    await saveOfficial(kale, coffee, doc("One grinder."));
    await saveOfficial(kale, coffee, doc("Two grinders."), { baseVersionId: await currentId(coffee) });
    const back = await createProposal(casey, { kind: "official_text", sectionId: coffee, title: "One grinder is enough", proposedOfficial: doc("One grinder.") });
    // Kale restores the first version: the same words Casey proposed.
    const versions = await asSystem((db) => listVersions(db, coffee));
    await restoreVersion(kale, coffee, versions.at(-1)!.id, { currentVersionId: versions[0].id });
    expect(await officialText(coffee)).toBe("One grinder.");
    expect(await view(back)).toMatchObject({ sameAsOfficial: true, outOfDate: true });
    await expect(approveAlone(casey, back, (await page(back)).seen)).rejects.toThrow(`${NOTHING_TO_APPROVE} Withdraw it.`);
    // The other way out: Kale declines it.
    await declineProposal(kale, back, "Done already.");
    expect(await view(back)).toMatchObject({ status: "declined", sameAsOfficial: false });

    const contacts = await section("Vendor Contacts");
    expect(await currentId(contacts)).toBeNull();
    const first = await createProposal(casey, { kind: "decision", sectionId: contacts, title: "Soil vendor", proposedOfficial: doc("Soil: Green Valley.") });
    expect(await view(first)).toMatchObject({ baseVersionId: null, sameAsOfficial: false });
    await saveOfficial(kale, contacts, doc("Soil: Green Valley."));
    expect(await view(first)).toMatchObject({ sameAsOfficial: true, outOfDate: true });
    await expect(approveAlone(casey, first, (await page(first)).seen)).rejects.toThrow(`${NOTHING_TO_APPROVE} Withdraw it.`);
    expect(await versionsOf(contacts)).toBe(1);
    await withdrawProposal(casey, first);
  });

  it("is only ever said of a proposal that is open: a direct edit that emptied a section is not one", async () => {
    const payments = await section("Payments Log");
    await saveOfficial(kale, payments, doc("Paid: the deposit."));
    await saveOfficial(kale, payments, { type: "doc", content: [{ type: "paragraph" }] }, { baseVersionId: await currentId(payments) });
    expect(await officialText(payments)).toBe("");
    const behind = await asSystem((db) => db.select().from(proposals).where(eq(proposals.sectionId, payments)));
    expect(behind).toHaveLength(2);
    for (const row of behind) {
      expect(await view(row.id)).toMatchObject({ status: "approved", sameAsOfficial: false, outOfDate: false, sectionGone: false });
    }
  });

  it("when its proposer can no longer withdraw it, the other Owner is simply told to decline it", async () => {
    const deadlines = await section("Order Deadlines");
    const max = await insertUser("Max", "max@example.com", "owner");
    const id = await createProposal(max, { kind: "decision", sectionId: deadlines, title: "Order by Tuesday", proposedOfficial: doc("Orders go in by Tuesday.") });
    await saveOfficial(kale, deadlines, doc("Orders go in by Tuesday."));
    expect(waitingText(await view(id), await owners(), kale.id)).toBe(`${ALREADY} Max can withdraw it, or you can decline it.`);
    await changeUserRole(kale, max.id, "advisor");
    const p = await view(id);
    expect(p).toMatchObject({ sameAsOfficial: true, proposerCanWithdraw: false });
    expect([kale, casey, max, karen].map((who) => waitingText(p, [casey, kale], who.id))).toEqual([
      `${ALREADY} Decline it.`,
      `${ALREADY} Decline it.`,
      ALREADY,
      ALREADY,
    ]);
    await expect(approveAlone(kale, id, (await page(id)).seen)).rejects.toThrow(`${NOTHING_TO_APPROVE} Decline it.`);
    await declineProposal(kale, id, "");
    await removeUser(kale, max.id);
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

  it("counts a proposal written when there was no official text as out of date once there is some", async () => {
    const mission = await section("Mission and Culture");
    const id = await createProposal(kale, { kind: "decision", sectionId: mission, title: "Mission", proposedOfficial: doc("We grow good plants.") });
    expect((await view(id)).baseVersionId).toBeNull();
    await saveOfficial(casey, mission, doc("We sell good plants."));
    expect(await refusal(approveAt(casey, id, mission, "We grow good plants.", true))).toMatch(OUT_OF_DATE);
    expect(await view(id)).toMatchObject({ status: "open", outOfDate: true });
    await withdrawProposal(kale, id);
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
    // A section change is never "out of date": it is not written against any text.
    const construction = await section("Construction");
    const rename = await createProposal(kale, { kind: "structure", change: { action: "rename", sectionId: construction, title: "Building work" } });
    expect(await currentId(construction)).not.toBeNull();
    expect(await view(rename)).toMatchObject({ outOfDate: false, baseVersionId: null });
    // Also when it is listed next to a text proposal about the same section.
    const text = await createProposal(kale, { kind: "decision", sectionId: construction, title: "Pave in summer", proposedOfficial: doc("Paving: summer.") });
    const listed = await asSystem((db) => listOpenProposalsForSection(db, construction));
    expect(listed.map((p) => [p.id, p.outOfDate])).toEqual([
      [rename, false],
      [text, false],
    ]);
    await withdrawProposal(kale, text);
    expect(approveChoices(await view(rename), casey, await owners())).toEqual({ approve: true, alone: false });
    expect(waitingText(await view(rename), await owners(), casey.id)).toBe("Waiting for you");
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
