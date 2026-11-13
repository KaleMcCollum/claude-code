import { asc, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { asSystem } from "@/db/client";
import { activityLog, sections } from "@/db/schema";
import type { Actor } from "@/lib/permissions";
import {
  type ProposalView,
  approveAlone,
  approveProposal,
  createProposal,
  declineProposal,
  editProposal,
  loadProposal,
} from "@/lib/proposals";
import {
  archiveSection,
  createSection,
  flattenTree,
  loadTree,
  moveProblem,
  moveProblemKind,
  moveSectionTo,
  renameSection,
  restoreSection,
} from "@/lib/sections";
import { removeUser } from "@/lib/users";
import { actorFor, insertUser, withTestDatabase } from "./helpers/db";

withTestDatabase();

/**
 * A proposed section change that can no longer be carried out, because the
 * sections changed while it waited. The person approving cannot "choose
 * again" (that was the proposer's form): they are told why, and what they
 * can do. Nothing is recorded, and the proposal stays open.
 */

async function sectionId(title: string): Promise<string> {
  const [row] = await asSystem((db) => db.select().from(sections).where(eq(sections.title, title)));
  if (!row) throw new Error(`No section called ${title}`);
  return row.id;
}
const view = async (id: string) => (await asSystem((db) => loadProposal(db, id))) as ProposalView;
const logged = async (id: string) =>
  (await asSystem((db) => db.select().from(activityLog).where(eq(activityLog.entityId, id)).orderBy(asc(activityLog.id)))).map((line) => line.action);
const children = async (parent: string) =>
  flattenTree(await asSystem((db) => loadTree(db)))
    .filter((node) => node.parentId === parent)
    .map((node) => node.title);

const asProposed = (reason: string, whatNow = "Decline it, or ask Kale to change or withdraw it.") =>
  `This can no longer be done as proposed: ${reason}. ${whatNow}`;

let kale: Actor;
let casey: Actor;

beforeAll(async () => {
  kale = await actorFor("kale@example.com");
  casey = await actorFor("casey@example.com");
});

/** Nothing happened: still open, only the proposer's approval, nothing in the log but "proposed". */
async function expectUntouched(id: string): Promise<void> {
  const now = await view(id);
  expect(now.status).toBe("open");
  expect(now.approvals.map((a) => a.userId)).toEqual([now.proposedById]);
  expect(now.decidedTitle).toBeNull();
  expect(await logged(id)).toEqual(["proposal.created"]);
}

describe("approving a move that can no longer be made", () => {
  it("the section it would go under was archived", async () => {
    const signage = await sectionId("Signage");
    const marketing = await sectionId("Marketing and Events");
    const id = await createProposal(kale, { kind: "structure", change: { action: "move", sectionId: signage, parentId: marketing } });
    await archiveSection(casey, marketing);
    const message = asProposed("the section it would go under no longer exists (it may have been archived)");
    await expect(approveProposal(casey, id, { revision: 1 })).rejects.toThrow(message);
    await expect(approveAlone(casey, id, { revision: 1 })).rejects.toThrow(message);
    await expectUntouched(id);
    expect(await children(marketing)).toEqual([]);

    // It is there again: now it goes through.
    await restoreSection(casey, marketing);
    await expect(approveProposal(casey, id, { revision: 1 })).resolves.toEqual({ approved: true, waitingFor: [] });
    expect(await children(marketing)).toEqual(["Signage"]);
  });

  it("the section is already there", async () => {
    const quotes = await sectionId("Quotes");
    const vendors = await sectionId("Vendors and Purchasing");
    const id = await createProposal(kale, { kind: "structure", change: { action: "move", sectionId: quotes, parentId: vendors } });
    // Casey moves it there herself in the meantime.
    await moveSectionTo(casey, quotes, vendors);
    await expect(approveProposal(casey, id, { revision: 1 })).rejects.toThrow(asProposed("the section is already there"));
    await expectUntouched(id);
    // To the top level, when it is at the top level already.
    const timeline = await sectionId("Opening Timeline");
    const finance = await sectionId("Finance");
    await moveSectionTo(casey, timeline, finance);
    const up = await createProposal(kale, { kind: "structure", change: { action: "move", sectionId: timeline, parentId: null } });
    await moveSectionTo(casey, timeline, null);
    await expect(approveProposal(casey, up, { revision: 1 })).rejects.toThrow(asProposed("the section is already there"));
    await expectUntouched(up);
  });

  it("it would now be more than three levels deep", async () => {
    const hardGoods = await sectionId("Hard Goods");
    const pos = await sectionId("Point of Sale");
    const coffee = await sectionId("Coffee Equipment");
    const id = await createProposal(kale, { kind: "structure", change: { action: "move", sectionId: hardGoods, parentId: pos } });
    // Point of Sale goes down a level in the meantime: 6.1 becomes 6.1.1.
    await moveSectionTo(casey, pos, coffee);
    await expect(approveProposal(casey, id, { revision: 1 })).rejects.toThrow(asProposed("it would put sections more than three levels deep"));
    await expectUntouched(id);

    // Or the section got subsections of its own in the meantime.
    const construction = await sectionId("Construction");
    const budget = await sectionId("Budget");
    const second = await createProposal(kale, { kind: "structure", change: { action: "move", sectionId: construction, parentId: budget } });
    await createSection(casey, { parentId: construction, title: "Permits" });
    await expect(approveProposal(casey, second, { revision: 1 })).rejects.toThrow(asProposed("it would put sections more than three levels deep"));
    await expectUntouched(second);
    await moveSectionTo(casey, pos, await sectionId("Equipment and Technology"));
  });

  it("the section it would go under is now under it", async () => {
    const houseplants = await sectionId("Houseplants");
    const annuals = await sectionId("Annuals");
    const id = await createProposal(kale, { kind: "structure", change: { action: "move", sectionId: houseplants, parentId: annuals } });
    await moveSectionTo(casey, annuals, houseplants);
    await expect(approveProposal(casey, id, { revision: 1 })).rejects.toThrow(
      asProposed("a section cannot go under itself or under one of its own subsections"),
    );
    await expectUntouched(id);
  });
});

describe("approving an add or a rename that can no longer be made", () => {
  it("a new section would now be more than three levels deep", async () => {
    const pos = await sectionId("Point of Sale");
    const coffee = await sectionId("Coffee Equipment");
    const id = await createProposal(kale, { kind: "structure", change: { action: "add", parentId: pos, title: "Scanners" } });
    await moveSectionTo(casey, pos, coffee);
    await expect(approveProposal(casey, id, { revision: 1 })).rejects.toThrow(
      asProposed("it would put the new section more than three levels deep"),
    );
    await expectUntouched(id);
    expect(await children(pos)).toEqual([]);
    await moveSectionTo(casey, pos, await sectionId("Equipment and Technology"));
    await approveProposal(casey, id, { revision: 1 });
    expect(await children(pos)).toEqual(["Scanners"]);
  });

  it("the section already has the proposed name", async () => {
    const hours = await sectionId("Store Hours");
    const id = await createProposal(kale, { kind: "structure", change: { action: "rename", sectionId: hours, title: "Opening Hours" } });
    await renameSection(casey, hours, "Opening Hours");
    await expect(approveProposal(casey, id, { revision: 1 })).rejects.toThrow(asProposed('the section is already called "Opening Hours"'));
    await expect(approveAlone(casey, id, { revision: 1 })).rejects.toThrow(asProposed('the section is already called "Opening Hours"'));
    await expectUntouched(id);
    // Any other name it got in the meantime is no obstacle.
    await renameSection(casey, hours, "When we are open");
    await approveProposal(casey, id, { revision: 1 });
    expect(await view(id)).toMatchObject({ status: "approved", decidedTitle: 'Rename 3.1 When we are open to "Opening Hours"' });
  });

  it("a second section with the same name is still allowed, as everywhere else", async () => {
    const equipment = await sectionId("Equipment and Technology");
    const id = await createProposal(kale, { kind: "structure", change: { action: "add", parentId: equipment, title: "Line Busters" } });
    await createSection(casey, { parentId: equipment, title: "Line Busters" });
    await approveProposal(casey, id, { revision: 1 });
    expect((await children(equipment)).filter((title) => title === "Line Busters")).toHaveLength(2);
  });
});

describe("what the person is told to do next", () => {
  it("depends on who is approving and whether the proposer is still here", async () => {
    const training = await sectionId("Training");
    const facility = await sectionId("Facility and Buildout");
    const reason = "the section it would go under no longer exists (it may have been archived)";

    // The proposer themselves ("Approve on my own"): they can change or withdraw it.
    const own = await createProposal(kale, { kind: "structure", change: { action: "move", sectionId: training, parentId: facility } });
    const sam = await insertUser("Sam", "sam@example.com", "owner");
    const sams = await createProposal(sam, { kind: "structure", change: { action: "move", sectionId: training, parentId: facility } });
    await archiveSection(casey, facility);
    await expect(approveAlone(kale, own, { revision: 1 })).rejects.toThrow(asProposed(reason, "Change it, or withdraw it."));
    await expectUntouched(own);
    // Someone else's: decline it, or ask them by name.
    await expect(approveAlone(casey, own, { revision: 1 })).rejects.toThrow(asProposed(reason, "Decline it, or ask Kale to change or withdraw it."));
    await expect(approveAlone(casey, sams, { revision: 1 })).rejects.toThrow(asProposed(reason, "Decline it, or ask Sam to change or withdraw it."));
    // The proposer has been removed: there is nobody to ask.
    await removeUser(kale, sam.id);
    await expect(approveAlone(casey, sams, { revision: 1 })).rejects.toThrow(asProposed(reason, "Decline it."));
    await expectUntouched(sams);

    // Both ways out work: the proposer changes it, or the other Owner declines it.
    await editProposal(kale, own, { kind: "structure", change: { action: "move", sectionId: training, parentId: await sectionId("Finance") } });
    await expect(approveProposal(casey, own, { revision: 2 })).resolves.toEqual({ approved: true, waitingFor: [] });
    await declineProposal(casey, sams, "Facility and Buildout was archived.");
    expect((await view(sams)).status).toBe("declined");
    await restoreSection(casey, facility);
  });

  it("is still the older message when the section itself is gone", async () => {
    const legal = await sectionId("Legal Entities");
    const id = await createProposal(kale, { kind: "structure", change: { action: "rename", sectionId: legal, title: "Companies" } });
    await archiveSection(casey, legal);
    await expect(approveProposal(casey, id, { revision: 1 })).rejects.toThrow(
      "The section this is about no longer exists (it may have been archived). Withdraw or decline this proposal.",
    );
    await expectUntouched(id);
  });
});

describe("the same reasons on the form where a move is chosen", () => {
  it("keep their own wording, which tells the person to choose again", async () => {
    const tree = await asSystem((db) => loadTree(db));
    const mission = await sectionId("Mission and Culture");
    const overview = await sectionId("Company Overview");
    const perennials = await sectionId("Perennials");
    const cases: [string | null, ReturnType<typeof moveProblemKind>, string | null][] = [
      [overview, "already_there", "That section is already there."],
      ["00000000-0000-4000-8000-000000000000", "destination_gone", "The section to move it under no longer exists. Reload the page and choose again."],
      [mission, "under_itself", "A section cannot be moved under itself or under one of its own subsections."],
      [perennials, null, null],
      [null, null, null],
    ];
    for (const [to, kind, words] of cases) {
      expect([to, moveProblemKind(tree, mission, to)]).toEqual([to, kind]);
      expect([to, moveProblem(tree, mission, to)]).toEqual([to, words]);
    }
    expect(moveProblemKind(tree, "00000000-0000-4000-8000-000000000000", null)).toBe("gone");
    expect(moveProblem(tree, "00000000-0000-4000-8000-000000000000", null)).toBe("That section no longer exists. Reload the page and try again.");
    // A section with subsections cannot go under a second-level section.
    expect(moveProblemKind(tree, overview, perennials)).toBe("too_deep");
    expect(moveProblem(tree, overview, perennials)).toBe("That would put sections more than three levels deep (for example 1.1.1.1).");
    // And through the proposing form.
    await expect(createProposal(kale, { kind: "structure", change: { action: "move", sectionId: mission, parentId: overview } })).rejects.toThrow(
      "That section is already there.",
    );
  });
});
