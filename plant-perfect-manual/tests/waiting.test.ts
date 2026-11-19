import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { asSystem } from "@/db/client";
import { activityLog, sections } from "@/db/schema";
import type { Actor } from "@/lib/permissions";
import {
  type ProposalView,
  activeApprovers,
  approveAlone,
  approveChoices,
  approveProposal,
  blockedNotice,
  canEditProposal,
  canEndorse,
  countAwaiting,
  createProposal,
  loadProposal,
  waitingFor,
  waitingOn,
  waitingText,
  withdrawProposal,
} from "@/lib/proposals";
import type { RichDoc } from "@/lib/richtext";
import { changeUserRole, removeUser } from "@/lib/users";
import { actorFor, insertUser, withTestDatabase } from "./helpers/db";

withTestDatabase();

/**
 * Which approve buttons a proposal shows each person, who it is waiting
 * for, and how that is worded. The first group asks the three helpers
 * directly about every situation (two Owners, three, one; a proposal that
 * is out of date); the second goes through the real records.
 */

const person = (name: string, permissions: string[]): Actor => ({
  id: `id-${name.toLowerCase()}`,
  name,
  email: `${name.toLowerCase()}@example.com`,
  roleKey: permissions.includes("approve") ? "owner" : "advisor",
  roleName: permissions.includes("approve") ? "Owner" : "Advisor",
  permissions,
});
const OWNER = ["read", "comment", "endorse", "propose", "approve"];
const KALE = person("Kale", OWNER);
const CASEY = person("Casey", OWNER);
const DANA = person("Dana", OWNER);
const EVE = person("Eve", OWNER);
/** Someone who used to be an Owner: their approval is on record but no longer counts. */
const SAM = person("Sam", ["read", "comment", "endorse"]);
const KAREN = person("Karen", ["read", "comment", "endorse"]);

/** An open text proposal by `proposer`, approved by `approvedBy`. */
function open(proposer: Actor, approvedBy: Actor[], more: Partial<ProposalView> = {}): ProposalView {
  return {
    id: "proposal",
    type: "decision",
    title: "Coffee wages",
    description: null,
    sectionId: "section",
    sectionTitle: "Wages",
    destinationTitle: null,
    businessTag: null,
    proposedOfficial: null,
    baseVersionId: null,
    structureChange: null,
    createdSectionId: null,
    decidedTitle: null,
    direct: false,
    proposedById: proposer.id,
    proposedByName: proposer.name,
    revision: 1,
    status: "open",
    createdAt: new Date("2026-11-10T18:00:00Z"),
    decidedAt: null,
    decidedById: null,
    decidedByName: null,
    declineReason: null,
    approvals: approvedBy.map((who) => ({ userId: who.id, name: who.name, at: new Date("2026-11-10T18:00:00Z") })),
    endorsements: [],
    resultVersion: null,
    decidedAlone: false,
    soloOpen: false,
    superseded: false,
    outOfDate: false,
    sameAsOfficial: false,
    sectionGone: false,
    proposerCanChange: true,
    // (Sam, who is no longer an Owner, could not withdraw a proposal of his.)
    proposerCanWithdraw: proposer.permissions.includes("propose"),
    ...more,
  };
}
const ids = (...people: Actor[]) => people.map((p) => p.id);
const names = (...people: Actor[]) => people.map((p) => p.name);
/** What each of these people reads. */
const reads = (view: ProposalView, approvers: Actor[], ...viewers: Actor[]) =>
  viewers.map((viewer) => waitingText(view, approvers, viewer.id));
/** The notice each of these people reads on the proposal's own page. */
const notices = (view: ProposalView, approvers: Actor[], ...viewers: Actor[]) =>
  viewers.map((viewer) => blockedNotice(view, approvers, viewer.id));
const buttons = (view: ProposalView, approvers: Actor[], ...people: Actor[]) =>
  people.map((who) => {
    const { approve, alone } = approveChoices(view, who, approvers);
    return `${who.name}: ${approve ? "Approve" : "-"} / ${alone ? "on my own" : "-"}`;
  });

describe("who a proposal is waiting for, and which buttons it shows", () => {
  describe("with two Owners", () => {
    const owners = [KALE, CASEY];

    it("one Owner proposed: it waits for the other", () => {
      const view = open(KALE, [KALE]);
      expect(waitingOn(view, owners)).toEqual({ step: "approve", ids: ids(CASEY), names: names(CASEY), needed: 1 });
      expect(reads(view, owners, CASEY, KALE, KAREN)).toEqual(["Waiting for you", "Waiting for Casey", "Waiting for Casey"]);
      expect(waitingFor(view, owners)).toEqual(["Casey"]);
      expect(buttons(view, owners, KALE, CASEY, KAREN)).toEqual([
        "Kale: - / on my own",
        "Casey: Approve / -",
        "Karen: - / -",
      ]);
    });

    it("the proposer is no longer an Owner: it waits for two Owners, then for the second", () => {
      let view = open(SAM, [SAM]);
      expect(waitingOn(view, owners)).toEqual({ step: "approve", ids: ids(KALE, CASEY), names: names(KALE, CASEY), needed: 2 });
      expect(reads(view, owners, KALE, CASEY, SAM)).toEqual(["Waiting for two Owners", "Waiting for two Owners", "Waiting for two Owners"]);
      expect(buttons(view, owners, KALE, CASEY, SAM)).toEqual([
        "Kale: Approve / on my own",
        "Casey: Approve / on my own",
        "Sam: - / -",
      ]);
      // Casey approves and waits.
      view = open(SAM, [SAM, CASEY]);
      expect(waitingOn(view, owners)).toEqual({ step: "approve", ids: ids(KALE), names: names(KALE), needed: 1 });
      expect(reads(view, owners, KALE, CASEY)).toEqual(["Waiting for you", "Waiting for Kale"]);
      expect(buttons(view, owners, KALE, CASEY)).toEqual(["Kale: Approve / -", "Casey: - / on my own"]);
    });

    it("both have approved and it is still open: either can press Approve to complete it", () => {
      const view = open(KALE, [KALE, CASEY]);
      expect(waitingOn(view, owners)).toEqual({ step: "approve", ids: ids(KALE, CASEY), names: names(KALE, CASEY), needed: 0 });
      expect(reads(view, owners, KALE, CASEY, KAREN)).toEqual([
        "Waiting for you or Casey",
        "Waiting for you or Kale",
        "Waiting for Kale or Casey",
      ]);
      expect(buttons(view, owners, KALE, CASEY)).toEqual(["Kale: Approve / -", "Casey: Approve / -"]);
    });
  });

  describe("with three Owners (or more)", () => {
    const owners = [KALE, CASEY, DANA];

    it("one more approval is needed, and either of the others can give it", () => {
      const view = open(KALE, [KALE]);
      expect(waitingOn(view, owners)).toEqual({ step: "approve", ids: ids(CASEY, DANA), names: names(CASEY, DANA), needed: 1 });
      expect(reads(view, owners, KALE, CASEY, DANA, KAREN)).toEqual([
        "Waiting for Casey or Dana",
        "Waiting for you or Dana",
        "Waiting for you or Casey",
        "Waiting for Casey or Dana",
      ]);
      expect(waitingFor(view, owners)).toEqual(["Casey", "Dana"]);
      expect(buttons(view, owners, KALE, CASEY, DANA)).toEqual([
        "Kale: - / on my own",
        "Casey: Approve / -",
        "Dana: Approve / -",
      ]);
    });

    it("nobody who can approve has approved yet: two are needed", () => {
      const view = open(SAM, [SAM]);
      expect(waitingOn(view, owners)).toEqual({ step: "approve", ids: ids(KALE, CASEY, DANA), names: names(KALE, CASEY, DANA), needed: 2 });
      expect(reads(view, owners, KALE, DANA)).toEqual(["Waiting for two Owners", "Waiting for two Owners"]);
    });

    it("two have approved and it is still open: the third can complete it too", () => {
      const view = open(KALE, [KALE, CASEY]);
      expect(waitingOn(view, owners)).toEqual({ step: "approve", ids: ids(KALE, CASEY, DANA), names: names(KALE, CASEY, DANA), needed: 0 });
      expect(reads(view, owners, DANA)).toEqual(["Waiting for you, Kale or Casey"]);
      expect(buttons(view, owners, KALE, CASEY, DANA)).toEqual(["Kale: Approve / -", "Casey: Approve / -", "Dana: Approve / -"]);
    });

    it("names three people with commas and one 'or'", () => {
      const four = [KALE, CASEY, DANA, EVE];
      const view = open(KALE, [KALE]);
      expect(reads(view, four, KALE, DANA)).toEqual(["Waiting for Casey, Dana or Eve", "Waiting for you, Casey or Eve"]);
    });
  });

  describe("with a single Owner", () => {
    it("who proposed it: there is nobody to wait for, and only Approve on my own", () => {
      const view = open(KALE, [KALE]);
      expect(waitingOn(view, [KALE])).toEqual({ step: "approve", ids: [], names: [], needed: 0 });
      expect(reads(view, [KALE], KALE, KAREN)).toEqual(["No other Owner to wait for", "No other Owner to wait for"]);
      expect(waitingFor(view, [KALE])).toEqual([]);
      expect(buttons(view, [KALE], KALE)).toEqual(["Kale: - / on my own"]);
    });

    it("who did not propose it: it waits for them, and only Approve on my own", () => {
      // Kale proposed it and has since been made an Advisor.
      const view = open(SAM, [SAM]);
      expect(waitingOn(view, [CASEY])).toEqual({ step: "approve", ids: ids(CASEY), names: names(CASEY), needed: 1 });
      expect(reads(view, [CASEY], CASEY, SAM)).toEqual(["Waiting for you", "Waiting for Casey"]);
      expect(buttons(view, [CASEY], CASEY)).toEqual(["Casey: - / on my own"]);
    });
  });

  describe("when the official text has changed since it was proposed", () => {
    const owners = [KALE, CASEY];

    it("it waits for its proposer to check it; nobody is offered Approve", () => {
      const view = open(KALE, [KALE], { outOfDate: true, proposerCanChange: true });
      expect(waitingOn(view, owners)).toEqual({ step: "check", ids: ids(KALE), names: names(KALE), needed: 0 });
      expect(reads(view, owners, KALE, CASEY, KAREN)).toEqual([
        "Waiting for you to check it against the new official text",
        "Waiting for Kale to check it against the new official text",
        "Waiting for Kale to check it against the new official text",
      ]);
      expect(waitingFor(view, owners)).toEqual(["Kale"]);
      // The proposer can still go ahead alone (flagged). The other Owner's
      // approval would make it two people's decision, so they get neither.
      expect(buttons(view, owners, KALE, CASEY)).toEqual(["Kale: - / on my own", "Casey: - / -"]);
    });

    it("and its proposer can no longer change it: it is stuck, for every Owner to see", () => {
      const view = open(SAM, [SAM], { outOfDate: true, proposerCanChange: false });
      expect(waitingOn(view, owners)).toEqual({ step: "stuck", ids: ids(KALE, CASEY), names: names(KALE, CASEY), needed: 0 });
      const STUCK = "The official text changed and it can no longer be approved.";
      // The Owners can decline it. Karen, an Advisor, and Sam, who proposed
      // it and is an Advisor now, have no button: they are not told to press one.
      expect(reads(view, owners, KALE, CASEY, KAREN, SAM)).toEqual([`${STUCK} Decline it.`, `${STUCK} Decline it.`, STUCK, STUCK]);
      // Sam's approval is on it, given before the official text changed. Sam
      // cannot approve right now, but may be an Owner again tomorrow: nobody
      // else may make it official alone, or it would read "approved by two".
      expect(buttons(view, owners, KALE, CASEY, SAM)).toEqual(["Kale: - / -", "Casey: - / -", "Sam: - / -"]);
      const oneApproved = open(SAM, [SAM, CASEY], { outOfDate: true, proposerCanChange: false });
      expect(buttons(oneApproved, owners, KALE, CASEY)).toEqual(["Kale: - / -", "Casey: - / -"]);
    });

    it("only its own proposer is offered Approve on my own, and only while nobody else's approval is on it", () => {
      // Kale proposed it and is still an Owner; Karen (an Advisor) endorsed it, so he can no longer change it.
      const endorsed = open(KALE, [KALE], {
        outOfDate: true,
        proposerCanChange: false,
        endorsements: [{ userId: KAREN.id, name: KAREN.name, at: new Date("2026-11-11T18:00:00Z") }],
      });
      expect(buttons(endorsed, owners, KALE, CASEY)).toEqual(["Kale: - / on my own", "Casey: - / -"]);
      // The same while it waits for his check.
      const waitingForCheck = open(KALE, [KALE], { outOfDate: true, proposerCanChange: true });
      expect(buttons(waitingForCheck, owners, KALE, CASEY)).toEqual(["Kale: - / on my own", "Casey: - / -"]);
      // Someone else's approval is on it, whoever they are: not for him either.
      for (const other of [CASEY, SAM]) {
        const twoNames = open(KALE, [KALE, other], { outOfDate: true, proposerCanChange: false });
        expect(buttons(twoNames, owners, KALE, CASEY)).toEqual(["Kale: - / -", "Casey: - / -"]);
      }
      // Not out of date: as before, only the people who can approve right now count.
      const upToDate = open(SAM, [SAM]);
      expect(buttons(upToDate, owners, KALE, CASEY)).toEqual(["Kale: Approve / on my own", "Casey: Approve / on my own"]);
    });
  });

  describe("a stuck proposal tells each reader what they themselves can do", () => {
    const owners = [KALE, CASEY];
    const karenEndorsed = [{ userId: KAREN.id, name: KAREN.name, at: new Date("2026-11-11T18:00:00Z") }];
    const SINCE = "The official text of this section has changed since";
    const NOT_BY_ITS_PROPOSER = `${SINCE} this was proposed, and the person who proposed it can no longer change it.`;

    it("its proposer withdraws it, another Owner declines it, an Advisor is told no more than what happened", () => {
      // Kale's proposal; Karen endorsed it, so he can no longer change it; then the official text changed.
      const view = open(KALE, [KALE], { outOfDate: true, proposerCanChange: false, endorsements: karenEndorsed });
      expect(waitingOn(view, owners)?.step).toBe("stuck");
      expect(reads(view, owners, KALE, CASEY, KAREN)).toEqual([
        "The official text changed and you can no longer change this proposal. Withdraw it and make a new one.",
        "The official text changed and it can no longer be approved. Decline it.",
        "The official text changed and it can no longer be approved.",
      ]);
      expect(notices(view, owners, KALE, CASEY, KAREN)).toEqual([
        `${SINCE} you proposed this, and you can no longer change it. Withdraw it and make a new proposal.`,
        `${NOT_BY_ITS_PROPOSER} Decline it and make a new proposal.`,
        `${NOT_BY_ITS_PROPOSER} It has to be proposed again.`,
      ]);
    });

    it("a proposer who can no longer withdraw it is not told to", () => {
      // Sam proposed it and has been made an Advisor since.
      const view = open(SAM, [SAM], { outOfDate: true, proposerCanChange: false });
      expect(notices(view, owners, SAM, KALE, KAREN)).toEqual([
        `${NOT_BY_ITS_PROPOSER} It has to be proposed again.`,
        `${NOT_BY_ITS_PROPOSER} Decline it and make a new proposal.`,
        `${NOT_BY_ITS_PROPOSER} It has to be proposed again.`,
      ]);
      // The same proposer while still able to withdraw (someone else's approval is on it).
      const stillHere = open(KALE, [KALE, SAM], { outOfDate: true, proposerCanChange: false });
      expect(reads(stillHere, owners, KALE)).toEqual([
        "The official text changed and you can no longer change this proposal. Withdraw it and make a new one.",
      ]);
      expect(reads({ ...stillHere, proposerCanWithdraw: false }, owners, KALE)).toEqual(["The official text changed and it can no longer be approved."]);
    });

    it("the notice is only for a stuck proposal", () => {
      // Waiting for approvals; waiting for its proposer's check (the page has its own notice, with a button); not open.
      expect(notices(open(KALE, [KALE]), owners, KALE, CASEY, KAREN)).toEqual([null, null, null]);
      expect(notices(open(KALE, [KALE], { outOfDate: true, proposerCanChange: true }), owners, KALE, CASEY, KAREN)).toEqual([null, null, null]);
      const decided = open(KALE, [KALE], { status: "declined", decidedAt: new Date(), decidedById: CASEY.id });
      expect(notices(decided, owners, KALE, CASEY)).toEqual([null, null]);
    });
  });

  describe("when the official text already says what it proposes", () => {
    const owners = [KALE, CASEY];
    const ALREADY = "The official text already says this.";
    /** Casey's proposal; the same words were saved directly in the meantime. */
    const same = (more: Partial<ProposalView> = {}) =>
      open(CASEY, [CASEY], { outOfDate: true, sameAsOfficial: true, proposerCanChange: true, ...more });

    it("there is nothing to approve: it waits for its proposer to withdraw it or another Owner to decline it", () => {
      const view = same();
      expect(waitingOn(view, owners)).toEqual({ step: "same", ids: ids(KALE, CASEY), names: names(KALE, CASEY), needed: 0 });
      expect(reads(view, owners, CASEY, KALE, KAREN)).toEqual([
        `${ALREADY} Withdraw it.`,
        `${ALREADY} Casey can withdraw it, or you can decline it.`,
        ALREADY,
      ]);
      // The page shows the same sentence in place of the out-of-date notice and its button.
      expect(notices(view, owners, CASEY, KALE, KAREN)).toEqual(reads(view, owners, CASEY, KALE, KAREN));
      // No approve button for anyone: not even "on my own" for its proposer.
      expect(buttons(view, owners, CASEY, KALE, KAREN)).toEqual(["Casey: - / -", "Kale: - / -", "Karen: - / -"]);
      expect(buttons({ ...view, sameAsOfficial: false }, owners, CASEY, KALE)).toEqual(["Casey: - / on my own", "Kale: - / -"]);
      // With three Owners it is every Owner's to deal with.
      expect(waitingOn(view, [KALE, CASEY, DANA])).toMatchObject({ step: "same", names: names(KALE, CASEY, DANA) });
      expect(reads(view, [KALE, CASEY, DANA], DANA)).toEqual([`${ALREADY} Casey can withdraw it, or you can decline it.`]);
    });

    it("is said before anything about checking it, or about being stuck", () => {
      // Its proposer could still check it: "check and save again" would only be refused.
      expect(waitingOn(same({ proposerCanChange: true }), owners)?.step).toBe("same");
      // Someone endorsed it, so its proposer can no longer change it.
      expect(waitingOn(same({ proposerCanChange: false }), owners)?.step).toBe("same");
      expect(waitingOn(same({ sameAsOfficial: false, proposerCanChange: true }), owners)?.step).toBe("check");
      expect(waitingOn(same({ sameAsOfficial: false, proposerCanChange: false }), owners)?.step).toBe("stuck");
    });

    it("nobody is pointed to a proposer who can no longer withdraw it", () => {
      // Sam proposed it and has been made an Advisor since.
      const view = open(SAM, [SAM], { outOfDate: true, sameAsOfficial: true, proposerCanChange: false });
      expect(view.proposerCanWithdraw).toBe(false);
      expect(reads(view, owners, KALE, CASEY, SAM, KAREN)).toEqual([`${ALREADY} Decline it.`, `${ALREADY} Decline it.`, ALREADY, ALREADY]);
    });
  });

  describe("when its section has been archived", () => {
    const owners = [KALE, CASEY];
    const ARCHIVED = "Its section has been archived.";

    it("it can only be withdrawn or declined: no approve button, and each reader is told what they can do", () => {
      const view = open(KALE, [KALE], { sectionGone: true });
      expect(waitingOn(view, owners)).toEqual({ step: "gone", ids: ids(KALE, CASEY), names: names(KALE, CASEY), needed: 0 });
      expect(reads(view, owners, KALE, CASEY, KAREN)).toEqual([`${ARCHIVED} Withdraw it.`, `${ARCHIVED} Decline it.`, ARCHIVED]);
      expect(notices(view, owners, KALE, CASEY, KAREN)).toEqual(reads(view, owners, KALE, CASEY, KAREN));
      expect(buttons(view, owners, KALE, CASEY, KAREN)).toEqual(["Kale: - / -", "Casey: - / -", "Karen: - / -"]);
      expect(buttons({ ...view, sectionGone: false }, owners, KALE, CASEY)).toEqual(["Kale: - / on my own", "Casey: Approve / -"]);
      // A proposer who has been made an Advisor since cannot withdraw it, and is not told to.
      const fromSam = open(SAM, [SAM], { sectionGone: true });
      expect(reads(fromSam, owners, SAM, KALE)).toEqual([ARCHIVED, `${ARCHIVED} Decline it.`]);
    });

    it("that is said first of all, whatever else is true of it", () => {
      const also: Partial<ProposalView>[] = [
        { outOfDate: true, proposerCanChange: true },
        { outOfDate: true, proposerCanChange: false },
        { outOfDate: true, sameAsOfficial: true },
      ];
      for (const more of also) {
        const view = open(KALE, [KALE], { sectionGone: true, ...more });
        expect(waitingOn(view, owners)?.step).toBe("gone");
        expect(reads(view, owners, CASEY)).toEqual([`${ARCHIVED} Decline it.`]);
        expect(waitingOn({ ...view, sectionGone: false }, owners)?.step).not.toBe("gone");
      }
    });

    it("it can be neither endorsed nor changed while it is open", () => {
      const view = open(KALE, [KALE], { sectionGone: true });
      expect([canEndorse(view, KAREN), canEndorse(view, CASEY)]).toEqual([false, false]);
      expect(canEditProposal(view, KALE)).toBe(false);
      const there = { ...view, sectionGone: false };
      expect([canEndorse(there, KAREN), canEndorse(there, CASEY), canEditProposal(there, KALE)]).toEqual([true, true, true]);
    });
  });

  describe("endorsing", () => {
    const at = new Date("2026-11-11T18:00:00Z");

    it("is not offered while an open proposal is out of date, to an Advisor or to an Owner", () => {
      const upToDate = open(KALE, [KALE]);
      expect([KAREN, CASEY, KALE].map((who) => canEndorse(upToDate, who))).toEqual([true, true, false]);
      // Waiting for its proposer's check: an endorsement now would stop that check.
      const waitingForCheck = open(KALE, [KALE], { outOfDate: true, proposerCanChange: true });
      expect([KAREN, CASEY].map((who) => canEndorse(waitingForCheck, who))).toEqual([false, false]);
      // Stuck: there is nothing left to support.
      const stuck = open(SAM, [SAM], { outOfDate: true, proposerCanChange: false });
      expect([KAREN, CASEY].map((who) => canEndorse(stuck, who))).toEqual([false, false]);
    });

    it("is still offered on an approved proposal, and never twice or after approving", () => {
      const approved = open(KALE, [KALE], { status: "approved", decidedAt: at, decidedById: KALE.id, decidedAlone: true, soloOpen: true });
      expect([KAREN, CASEY, KALE].map((who) => canEndorse(approved, who))).toEqual([true, true, false]);
      const endorsed = open(KALE, [KALE], { endorsements: [{ userId: KAREN.id, name: KAREN.name, at }] });
      expect([KAREN, CASEY].map((who) => canEndorse(endorsed, who))).toEqual([false, true]);
      for (const status of ["declined", "withdrawn"] as const) {
        expect(canEndorse(open(KALE, [KALE], { status, decidedAt: at, decidedById: KALE.id }), KAREN)).toBe(false);
      }
    });
  });

  it("has nothing to say about a proposal that is not open", () => {
    for (const status of ["approved", "declined", "withdrawn"] as const) {
      const view = open(KALE, [KALE], { status, decidedAt: new Date(), decidedById: KALE.id });
      expect(waitingOn(view, [KALE, CASEY])).toBeNull();
      expect(waitingText(view, [KALE, CASEY], CASEY.id)).toBeNull();
      expect(blockedNotice(view, [KALE, CASEY], CASEY.id)).toBeNull();
      expect(waitingFor(view, [KALE, CASEY])).toEqual([]);
      expect(buttons(view, [KALE, CASEY], KALE, CASEY)).toEqual(["Kale: - / -", "Casey: - / -"]);
    }
  });
});

describe("through the real records", () => {
  const doc = (text: string): RichDoc => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
  async function section(title: string): Promise<string> {
    const [row] = await asSystem((db) => db.select().from(sections).where(eq(sections.title, title)));
    return row.id;
  }
  const view = async (id: string) => (await asSystem((db) => loadProposal(db, id))) as ProposalView;
  const owners = () => asSystem((db) => activeApprovers(db));
  const awaiting = (who: Actor) => asSystem((db) => countAwaiting(db, who));
  const logged = async (id: string) =>
    (await asSystem((db) => db.select().from(activityLog).where(eq(activityLog.entityId, id)).orderBy(activityLog.id))).map((e) => e.summary);

  it("three Owners: either of the other two completes it, and the count follows who it waits for", async () => {
    const kale = await actorFor("kale@example.com");
    const casey = await actorFor("casey@example.com");
    const dana = await insertUser("Dana", "dana@example.com", "owner");
    const karen = await insertUser("Karen", "karen@example.com", "advisor");
    const id = await createProposal(kale, { kind: "decision", sectionId: await section("Wages"), title: "Coffee wages", proposedOfficial: doc("$15.00/hr") });
    const p = await view(id);
    expect(waitingText(p, await owners(), kale.id)).toBe("Waiting for Casey or Dana");
    expect(waitingText(p, await owners(), dana.id)).toBe("Waiting for you or Casey");
    expect([await awaiting(kale), await awaiting(casey), await awaiting(dana)]).toEqual([0, 1, 1]);
    // An Advisor's number is how many proposals are open.
    expect(await awaiting(karen)).toBe(1);

    expect(await approveProposal(dana, id, { revision: 1, currentVersionId: null })).toEqual({ approved: true, waitingFor: [] });
    expect(await view(id)).toMatchObject({ status: "approved", decidedAlone: false });
    expect([await awaiting(kale), await awaiting(casey), await awaiting(dana), await awaiting(karen)]).toEqual([0, 0, 0, 0]);

    // A proposal whose proposer has left: the first approval waits for either of the other two.
    const sam = await insertUser("Sam", "sam@example.com", "owner");
    const fromSam = await createProposal(sam, { kind: "decision", sectionId: await section("Hiring"), title: "Hire at 16", proposedOfficial: doc("We hire from age 16.") });
    await removeUser(kale, sam.id);
    expect(waitingText(await view(fromSam), await owners(), casey.id)).toBe("Waiting for two Owners");
    expect([await awaiting(kale), await awaiting(casey), await awaiting(dana)]).toEqual([1, 1, 1]);
    expect(await approveProposal(casey, fromSam, { revision: 1, currentVersionId: null })).toEqual({ approved: false, waitingFor: ["Kale", "Dana"] });
    expect((await logged(fromSam)).at(-1)).toBe("Approved, waiting for Kale or Dana: Hire at 16");
    expect(waitingText(await view(fromSam), await owners(), casey.id)).toBe("Waiting for Kale or Dana");
    expect([await awaiting(kale), await awaiting(casey), await awaiting(dana)]).toEqual([1, 0, 1]);
    await removeUser(kale, dana.id);
    expect(await approveProposal(kale, fromSam, { revision: 1, currentVersionId: null })).toEqual({ approved: true, waitingFor: [] });
  });

  it("a single Owner: plain Approve is refused with nothing recorded, and Approve on my own is the way", async () => {
    const kale = await actorFor("kale@example.com");
    const casey = await actorFor("casey@example.com");
    const benefits = await section("Benefits");
    const id = await createProposal(kale, { kind: "decision", sectionId: benefits, title: "Staff discount", proposedOfficial: doc("Staff discount: 20%.") });
    // Kale is made an Advisor: Casey is the only Owner left.
    await changeUserRole(casey, kale.id, "advisor");
    const p = await view(id);
    expect(approveChoices(p, casey, await owners())).toEqual({ approve: false, alone: true });
    expect(waitingText(p, await owners(), casey.id)).toBe("Waiting for you");
    expect(await awaiting(casey)).toBe(1);

    await expect(approveProposal(casey, id, { revision: 1, currentVersionId: null })).rejects.toThrow(
      "There is no other Owner to wait for right now. Use Approve on my own.",
    );
    expect((await view(id)).approvals.map((a) => a.name)).toEqual(["Kale"]);
    expect(await logged(id)).toEqual(["Proposed: Staff discount"]);

    await approveAlone(casey, id, { revision: 1, currentVersionId: null });
    expect(await view(id)).toMatchObject({ status: "approved", decidedAlone: true });

    // The same for a single Owner's own proposal.
    const own = await createProposal(casey, { kind: "decision", sectionId: benefits, title: "Staff discount 25%", proposedOfficial: doc("Staff discount: 25%.") });
    expect(waitingText(await view(own), await owners(), casey.id)).toBe("No other Owner to wait for");
    expect(await awaiting(casey)).toBe(0);
    await expect(approveProposal(casey, own, { revision: 1, currentVersionId: (await view(id)).resultVersion!.id })).rejects.toThrow(
      "There is no other Owner to wait for right now. Use Approve on my own.",
    );
    await withdrawProposal(casey, own);
    await changeUserRole(casey, kale.id, "owner");
  });
});
