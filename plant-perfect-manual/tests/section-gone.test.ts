import { asc, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { asSystem } from "@/db/client";
import { activityLog, sections } from "@/db/schema";
import type { Actor } from "@/lib/permissions";
import {
  type ProposalInput,
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
  declineProposal,
  editProposal,
  endorseProposal,
  listOpenProposals,
  loadProposal,
  waitingOn,
  waitingText,
  withdrawProposal,
} from "@/lib/proposals";
import type { RichDoc } from "@/lib/richtext";
import { archiveSection, restoreSection } from "@/lib/sections";
import { changeUserRole, removeUser } from "@/lib/users";
import { actorFor, insertUser, withTestDatabase } from "./helpers/db";

withTestDatabase();

/**
 * A waiting proposal whose section has been archived (or sits under a
 * section that has been) can only be withdrawn or declined. The lists, the
 * number next to Proposals and the buttons all say so, and every other
 * press is refused with nothing recorded.
 */

const doc = (text: string): RichDoc => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
async function sectionId(title: string): Promise<string> {
  const [row] = await asSystem((db) => db.select().from(sections).where(eq(sections.title, title)));
  if (!row) throw new Error(`No section called ${title}`);
  return row.id;
}
const view = async (id: string) => (await asSystem((db) => loadProposal(db, id))) as ProposalView;
const owners = () => asSystem((db) => activeApprovers(db));
const awaiting = (who: Actor) => asSystem((db) => countAwaiting(db, who));
const logged = async (id: string) =>
  (await asSystem((db) => db.select().from(activityLog).where(eq(activityLog.entityId, id)).orderBy(asc(activityLog.id)))).map((line) => line.action);

const ARCHIVED = "Its section has been archived.";
const SECTION_GONE = "The section this is about no longer exists (it may have been archived). Withdraw or decline this proposal.";
const NOT_ENDORSED = "The section this proposal is about has been archived, so it can no longer be endorsed.";

let kale: Actor;
let casey: Actor;
let karen: Actor;

beforeAll(async () => {
  kale = await actorFor("kale@example.com");
  casey = await actorFor("casey@example.com");
  karen = await insertUser("Karen", "karen@example.com", "advisor");
});

/** Gone, for everyone to see: what the lists say, no buttons, and every press refused with nothing recorded. */
async function expectGone(id: string, proposer: Actor, other: Actor): Promise<void> {
  const everyone = await owners();
  const p = await view(id);
  expect(p).toMatchObject({ status: "open", sectionGone: true });
  expect(waitingOn(p, everyone)).toMatchObject({ step: "gone", ids: everyone.map((owner) => owner.id), needed: 0 });
  expect([proposer, other, karen].map((who) => waitingText(p, everyone, who.id))).toEqual([
    `${ARCHIVED} Withdraw it.`,
    `${ARCHIVED} Decline it.`,
    ARCHIVED,
  ]);
  expect(blockedNotice(p, everyone, other.id)).toBe(`${ARCHIVED} Decline it.`);
  for (const who of [proposer, other, karen]) expect(approveChoices(p, who, everyone)).toEqual({ approve: false, alone: false });
  expect([canEndorse(p, karen), canEndorse(p, other), canEditProposal(p, proposer)]).toEqual([false, false, false]);

  const seen = { revision: p.revision };
  await expect(approveProposal(other, id, seen)).rejects.toThrow(SECTION_GONE);
  await expect(approveAlone(other, id, seen)).rejects.toThrow(SECTION_GONE);
  await expect(approveAlone(proposer, id, seen)).rejects.toThrow(SECTION_GONE);
  await expect(endorseProposal(karen, id, seen)).rejects.toThrow(NOT_ENDORSED);
  await expect(endorseProposal(other, id, seen)).rejects.toThrow(NOT_ENDORSED);
  const after = await view(id);
  expect(after.status).toBe("open");
  expect(after.approvals.map((a) => a.userId)).toEqual([proposer.id]);
  expect(after.endorsements).toEqual([]);
  expect(await logged(id)).toEqual(["proposal.created"]);
}

describe("a text proposal whose section has been archived", () => {
  it("reads as gone in the lists and the count, shows no buttons, and comes back when the section does", async () => {
    const wages = await sectionId("Wages");
    const people = await sectionId("People");
    const input = { kind: "decision" as const, sectionId: wages, title: "Coffee wages", proposedOfficial: doc("Coffee staff start at $13/hr.") };
    const id = await createProposal(kale, input);
    expect(await view(id)).toMatchObject({ sectionGone: false });
    expect(waitingText(await view(id), await owners(), casey.id)).toBe("Waiting for you");
    expect([await awaiting(kale), await awaiting(casey), await awaiting(karen)]).toEqual([0, 1, 1]);

    await archiveSection(casey, wages);
    await expectGone(id, kale, casey);
    // It is on both Owners' lists now: either can clear it away.
    expect([await awaiting(kale), await awaiting(casey), await awaiting(karen)]).toEqual([1, 1, 1]);
    expect((await asSystem((db) => listOpenProposals(db))).map((p) => [p.id, p.sectionGone])).toEqual([[id, true]]);
    // Changing it is refused as well (the edit page is not offered).
    await expect(editProposal(kale, id, { ...input, title: "Coffee wages 2027" })).rejects.toThrow("That section no longer exists.");

    // The section is restored: the proposal is an ordinary one again.
    await restoreSection(casey, wages);
    expect(await view(id)).toMatchObject({ sectionGone: false });
    expect(waitingOn(await view(id), await owners())).toMatchObject({ step: "approve", ids: [casey.id] });
    expect([await awaiting(kale), await awaiting(casey)]).toEqual([0, 1]);

    // The section above it is archived: just as gone.
    await archiveSection(casey, people);
    await expectGone(id, kale, casey);
    await restoreSection(casey, people);
    expect((await view(id)).sectionGone).toBe(false);

    // The ways out work, and a decided proposal is never "gone".
    await archiveSection(casey, wages);
    await withdrawProposal(kale, id);
    expect(await view(id)).toMatchObject({ status: "withdrawn", sectionGone: false });
    const second = await createProposal(casey, { ...input, sectionId: await sectionId("Hiring"), title: "Hire at 16" });
    await archiveSection(casey, await sectionId("Hiring"));
    await expectGone(second, casey, kale);
    await declineProposal(kale, second, "The section is gone.");
    expect(await view(second)).toMatchObject({ status: "declined", sectionGone: false });
    await restoreSection(casey, wages);
    await restoreSection(casey, await sectionId("Hiring"));
  });
});

describe("a section change whose section has been archived", () => {
  it("each kind reads as gone, an add under a section archived since included", async () => {
    const benefits = await sectionId("Benefits");
    const training = await sectionId("Training");
    const policies = await sectionId("Policies and Expectations");
    const signage = await sectionId("Signage");
    const finance = await sectionId("Finance");
    const kinds: [string, ProposalInput][] = [
      [benefits, { kind: "structure", change: { action: "rename", sectionId: benefits, title: "Perks" } }],
      [training, { kind: "structure", change: { action: "move", sectionId: training, parentId: finance } }],
      [policies, { kind: "structure", change: { action: "archive", sectionId: policies } }],
      [signage, { kind: "structure", change: { action: "add", parentId: signage, title: "Banners" } }],
    ];
    for (const [section, input] of kinds) {
      const id = await createProposal(kale, input);
      expect((await view(id)).sectionGone).toBe(false);
      await archiveSection(casey, section);
      await expectGone(id, kale, casey);
      await expect(editProposal(kale, id, input)).rejects.toThrow("no longer exists");
      await restoreSection(casey, section);
      expect(await view(id)).toMatchObject({ status: "open", sectionGone: false });
      // Archived again, and declined.
      await archiveSection(casey, section);
      await declineProposal(casey, id, "");
      expect(await view(id)).toMatchObject({ status: "declined", sectionGone: false });
      await restoreSection(casey, section);
    }
  });

  it("is about the proposal's own section only", async () => {
    // A new top-level section has no section that could be gone.
    const top = await createProposal(kale, { kind: "structure", change: { action: "add", parentId: null, title: "Safety" } });
    expect(await view(top)).toMatchObject({ sectionId: null, sectionGone: false });
    // A move whose own section is in use, to a section that has been
    // archived: not "gone". It waits as before, and approving it says why
    // it cannot be done.
    const quotes = await sectionId("Quotes");
    const marketing = await sectionId("Marketing and Events");
    const move = await createProposal(kale, { kind: "structure", change: { action: "move", sectionId: quotes, parentId: marketing } });
    await archiveSection(casey, marketing);
    expect(await view(move)).toMatchObject({ sectionGone: false });
    expect(waitingText(await view(move), await owners(), casey.id)).toBe("Waiting for you");
    await expect(approveProposal(casey, move, { revision: 1 })).rejects.toThrow("This can no longer be done as proposed");
    await restoreSection(casey, marketing);
    await withdrawProposal(kale, move);
    await withdrawProposal(kale, top);
  });

  it("an approved change is never gone and can still be endorsed after its section was archived", async () => {
    const legal = await sectionId("Legal Entities");
    const id = await createProposal(kale, { kind: "structure", change: { action: "rename", sectionId: legal, title: "Companies" } });
    await approveAlone(kale, id, { revision: 1 });
    await archiveSection(casey, legal);
    const approved = await view(id);
    expect(approved).toMatchObject({ status: "approved", sectionGone: false });
    expect(canEndorse(approved, karen)).toBe(true);
    await endorseProposal(karen, id, { revision: 1 });
    expect((await view(id)).endorsements.map((e) => e.name)).toEqual(["Karen"]);
    await restoreSection(casey, legal);
  });
});

describe("an approval that would only have waited for a second one", () => {
  it("is refused as well, before it is recorded", async () => {
    // Robin proposed it and has been made an Advisor since, so the first
    // Owner's approval would not make it official: it would wait.
    const robin = await insertUser("Robin", "robin@example.com", "owner");
    const hours = await sectionId("Store Hours");
    const id = await createProposal(robin, { kind: "decision", sectionId: hours, title: "Open at 8", proposedOfficial: doc("Open 8 to 6.") });
    await changeUserRole(kale, robin.id, "advisor");
    await archiveSection(kale, hours);
    const p = await view(id);
    expect(p).toMatchObject({ sectionGone: true, proposerCanWithdraw: false });
    expect([robin, casey].map((who) => waitingText(p, [casey, kale], who.id))).toEqual([ARCHIVED, `${ARCHIVED} Decline it.`]);
    await expect(approveProposal(casey, id, { revision: 1, currentVersionId: null })).rejects.toThrow(SECTION_GONE);
    expect((await view(id)).approvals.map((a) => a.name)).toEqual(["Robin"]);
    expect(await logged(id)).toEqual(["proposal.created"]);
    // With the section back, the same press is taken and waits for Kale.
    await restoreSection(kale, hours);
    expect(await approveProposal(casey, id, { revision: 1, currentVersionId: null })).toEqual({ approved: false, waitingFor: ["Kale"] });
    await removeUser(kale, robin.id);
  });
});
