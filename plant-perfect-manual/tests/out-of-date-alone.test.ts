import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { asSystem } from "@/db/client";
import { activityLog, sections } from "@/db/schema";
import { loadOfficial } from "@/lib/official";
import type { Actor } from "@/lib/permissions";
import {
  type ProposalView,
  activeApprovers,
  addApproval,
  approveAlone,
  approveChoices,
  approveProposal,
  canApproveToo,
  createProposal,
  declineProposal,
  listOneOwnerDecisions,
  loadProposal,
  loadTextChange,
  statusLine,
  waitingOn,
  withdrawProposal,
} from "@/lib/proposals";
import { type RichDoc, docToText } from "@/lib/richtext";
import { loadToday } from "@/lib/today";
import { addUser, changeUserRole, removeUser } from "@/lib/users";
import { actorFor, fakeMailer, insertUser, withTestDatabase } from "./helpers/db";

withTestDatabase();

/**
 * An out-of-date proposal can be approved alone only while nobody else's
 * approval is on it, whoever they are and whatever their role is now. The
 * proposer's own approval is always on a proposal, so in practice only its
 * proposer can approve it alone.
 *
 * Before this rule, the other Owner could approve it alone while its
 * proposer was not an Owner (made an Advisor, or removed). Once the proposer
 * was an Owner again, their approval from before the official text changed
 * read as the second one: "Approved by Casey and Kale", nothing flagged, on
 * text Casey had never seen replaced. Each story below ends refused.
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
const officialText = async (sectionId: string) => docToText((await asSystem((db) => loadOfficial(db, sectionId)))!.content);
/** What a freshly loaded proposal page would send back with a button press. */
async function seen(id: string) {
  const p = await view(id);
  const change = (await asSystem((db) => loadTextChange(db, p)))!;
  return { revision: p.revision, currentVersionId: change.currentVersionId };
}
const logged = async (id: string) =>
  (await asSystem((db) => db.select().from(activityLog).where(eq(activityLog.entityId, id)).orderBy(activityLog.id))).map((e) => e.action);
const flaggedIds = async () => (await asSystem((db) => listOneOwnerDecisions(db))).map((d) => d.id);
const flaggedFor = async (who: Actor) => (await loadToday(who)).decidedAlone.map((p) => p.id);

const sinceProposed = (name: string) =>
  `The official text of this section has changed since ${name} proposed this. ${name} needs to check the proposal against the new text and save it again before it can be approved. You can comment on it or decline it.`;
const CANNOT_BE_CHECKED =
  "The official text of this section has changed since this was proposed, and the person who proposed it can no longer change it. Decline it and make a new proposal.";

const OLD = "Staff discount: 10%.";
const AGREED = "Staff discount: 25%. Paid sick days: 5 a year.";

let kale: Actor;
let casey: Actor;

beforeAll(async () => {
  kale = await actorFor("kale@example.com");
  casey = await actorFor("casey@example.com");
});

/**
 * Casey proposes; nobody acts on it. Later Kale proposes something fuller
 * for the same section and `second` approves it, so that is the official
 * text, approved by two people. Casey's old proposal is now out of date.
 */
async function oldProposalAfterNewerText(sectionTitle: string, second: Actor = casey): Promise<{ sectionId: string; old: string }> {
  const sectionId = await section(sectionTitle);
  const old = await createProposal(casey, { kind: "decision", sectionId, title: "Staff discount 10%", proposedOfficial: doc(OLD) });
  const agreed = await createProposal(kale, { kind: "decision", sectionId, title: "Benefits package", proposedOfficial: doc(AGREED) });
  expect(await approveProposal(second, agreed, { revision: 1, currentVersionId: null })).toEqual({ approved: true, waitingFor: [] });
  expect(await view(old)).toMatchObject({ status: "open", outOfDate: true });
  return { sectionId, old };
}

/** Nothing came of the presses: the agreed text is official, the old proposal is open with only Casey's approval, nothing is flagged. */
async function expectNothingHappened(sectionId: string, old: string): Promise<void> {
  expect(await officialText(sectionId)).toBe(AGREED);
  const now = await view(old);
  expect(now.status).toBe("open");
  expect(now.approvals.map((a) => a.name)).toEqual(["Casey"]);
  expect(await logged(old)).toEqual(["proposal.created"]);
  expect(await flaggedIds()).not.toContain(old);
}

/** Neither button is offered to `who`, and neither press goes through. */
async function expectRefused(who: Actor, old: string, words: string): Promise<void> {
  expect(approveChoices(await view(old), who, await owners())).toEqual({ approve: false, alone: false });
  await expect(approveAlone(who, old, await seen(old))).rejects.toThrow(words);
  await expect(approveProposal(who, old, await seen(old))).rejects.toThrow(words);
}

describe("the other Owner cannot approve an out-of-date proposal alone", () => {
  it("while its proposer is an Advisor for a while: refused, and the way out is flagged for the proposer", async () => {
    const { sectionId, old } = await oldProposalAfterNewerText("Opening Procedures");
    // While Casey is an Owner, Kale is refused (this was already so).
    await expectRefused(kale, old, sinceProposed("Casey"));

    // Settings: Kale changes Casey's role to Advisor. Casey's approval, given
    // before the text changed, is still on the proposal.
    await changeUserRole(kale, casey.id, "advisor");
    expect((await owners()).map((owner) => owner.name)).toEqual(["Kale"]);
    expect(await view(old)).toMatchObject({ outOfDate: true, proposerCanChange: false });
    expect(waitingOn(await view(old), await owners())?.step).toBe("stuck");
    await expectRefused(kale, old, CANNOT_BE_CHECKED);
    await expectNothingHappened(sectionId, old);

    // The way out is the one the message names: decline it, and propose the
    // same words in his own name. That he can approve on his own.
    await declineProposal(kale, old, "The text has moved on.");
    const again = await createProposal(kale, { kind: "decision", sectionId, title: "Staff discount 10%", proposedOfficial: doc(OLD) });
    expect(approveChoices(await view(again), kale, await owners())).toEqual({ approve: false, alone: true });
    await approveAlone(kale, again, await seen(again));
    expect(await officialText(sectionId)).toBe(OLD);

    // Casey is an Owner again. Nothing reads as approved by two people: the
    // change is Kale's alone, it is flagged for Casey, and Casey is offered
    // "I approve too".
    await changeUserRole(kale, casey.id, "owner");
    const done = await view(again);
    expect(done).toMatchObject({ status: "approved", decidedAlone: true, soloOpen: true });
    expect(statusLine(done)).toMatch(/^Approved by Kale, /);
    expect(await flaggedFor(casey)).toContain(again);
    expect(canApproveToo(done, casey)).toBe(true);
    expect(statusLine(await view(old))).toMatch(/^Declined by Kale, /);
    // And Casey can add her approval, which is then really given on this text.
    await addApproval(casey, again);
    expect(statusLine(await view(again))).toMatch(/^Approved by Kale and Casey, /);
    expect(await flaggedFor(casey)).not.toContain(again);
  });

  it("while its proposer is removed, and added back later", async () => {
    const { sectionId, old } = await oldProposalAfterNewerText("Closing Procedures");
    await removeUser(kale, casey.id);
    expect((await owners()).map((owner) => owner.name)).toEqual(["Kale"]);
    await expectRefused(kale, old, CANNOT_BE_CHECKED);
    await expectNothingHappened(sectionId, old);

    // Settings: Add a person, with the same email address. It is the same person again.
    const added = await addUser(kale, { name: "Casey", email: "casey@example.com", roleKey: "owner" }, { baseUrl: "https://manual.example.com", send: fakeMailer().send });
    expect(added.userId).toBe(casey.id);
    expect((await owners()).map((owner) => owner.name).sort()).toEqual(["Casey", "Kale"]);
    // Still refused, and still nothing to show for it. It waits for Casey's check again.
    await expectRefused(kale, old, sinceProposed("Casey"));
    await expectNothingHappened(sectionId, old);
    expect(waitingOn(await view(old), await owners())).toMatchObject({ step: "check", ids: [casey.id] });
    expect(await flaggedFor(casey)).not.toContain(old);
    await withdrawProposal(casey, old);
  });

  it("with three Owners: neither of the other two can, so nothing is flagged that could later unflag itself", async () => {
    const dana = await insertUser("Dana", "dana@example.com", "owner");
    // Kale and Dana agreed on the newer text; Casey never saw it replaced.
    const { sectionId, old } = await oldProposalAfterNewerText("Ownership and Roles", dana);
    await changeUserRole(kale, casey.id, "advisor");
    expect((await owners()).map((owner) => owner.name)).toEqual(["Kale", "Dana"]);
    for (const who of [kale, dana]) await expectRefused(who, old, CANNOT_BE_CHECKED);
    await expectNothingHappened(sectionId, old);
    expect(await flaggedFor(dana)).not.toContain(old);

    await changeUserRole(kale, casey.id, "owner");
    for (const who of [kale, dana]) await expectRefused(who, old, sinceProposed("Casey"));
    await expectNothingHappened(sectionId, old);
    expect(await flaggedFor(dana)).not.toContain(old);
    expect(await flaggedFor(casey)).not.toContain(old);
    await declineProposal(dana, old, "");
    await removeUser(kale, dana.id);
  });
});

describe("what stays as it was", () => {
  it("its own proposer can approve it alone while nobody else's approval is on it, and that is flagged", async () => {
    const { sectionId, old } = await oldProposalAfterNewerText("Legal Entities");
    expect(approveChoices(await view(old), casey, await owners())).toEqual({ approve: false, alone: true });
    await approveAlone(casey, old, await seen(old));
    const done = await view(old);
    expect(done).toMatchObject({ status: "approved", decidedAlone: true, soloOpen: true });
    expect(statusLine(done)).toMatch(/^Approved by Casey, /);
    expect(await officialText(sectionId)).toBe(OLD);
    expect(await flaggedFor(kale)).toContain(old);
    expect(canApproveToo(done, kale)).toBe(true);
  });

  it("a proposal that is not out of date can be approved alone by the other Owner while its proposer is an Advisor", async () => {
    // Both saw the same official text here, so two names on it is fair.
    const sectionId = await section("Policies and Expectations");
    const id = await createProposal(casey, { kind: "decision", sectionId, title: "Name tags", proposedOfficial: doc("Everyone wears a name tag.") });
    await changeUserRole(kale, casey.id, "advisor");
    expect(await view(id)).toMatchObject({ outOfDate: false });
    expect(approveChoices(await view(id), kale, await owners())).toEqual({ approve: false, alone: true });
    await approveAlone(kale, id, await seen(id));
    await changeUserRole(kale, casey.id, "owner");
    expect(statusLine(await view(id))).toMatch(/^Approved by Casey and Kale, /);
    expect(await officialText(sectionId)).toBe("Everyone wears a name tag.");
  });
});
