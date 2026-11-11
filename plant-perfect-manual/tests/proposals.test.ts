import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { asSystem } from "@/db/client";
import { activityLog, approvals, officialVersions, proposals, sections, users } from "@/db/schema";
import { addNote, removeNote } from "@/lib/notes";
import { approvalLine, loadOfficial, saveOfficial } from "@/lib/official";
import { AppError } from "@/lib/permissions";
import {
  type ProposalView,
  type StructureProposalInput,
  addApproval,
  addProposalComment,
  approveAlone,
  approveProposal,
  canApproveToo,
  countAwaiting,
  createProposal,
  declineProposal,
  describeStructure,
  editProposal,
  endorseProposal,
  listClosedProposals,
  listDecisions,
  listOneOwnerDecisions,
  listOpenProposals,
  listOpenProposalsForSection,
  loadProposal,
  loadProposalComments,
  proposalsForNotes,
  sourceNoteIds,
  withdrawProposal,
} from "@/lib/proposals";
import { type RichDoc, docToText } from "@/lib/richtext";
import { archiveSection, flattenTree, loadTree, restoreSection } from "@/lib/sections";
import { changeUserRole } from "@/lib/users";
import { formatDate } from "@/lib/time";
import { actorFor, insertUser, withTestDatabase } from "./helpers/db";

withTestDatabase();

const doc = (...paragraphs: string[]): RichDoc => ({
  type: "doc",
  content: paragraphs.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })),
});

const tree = () => asSystem((db) => loadTree(db));
async function node(title: string) {
  const found = flattenTree(await tree()).find((n) => n.title === title);
  if (!found) throw new Error(`No section called ${title}`);
  return found;
}
const sectionId = async (title: string) => (await node(title)).id;
const proposal = async (id: string) => (await asSystem((db) => loadProposal(db, id))) as ProposalView;
const official = (id: string) => asSystem((db) => loadOfficial(db, id));
const currentVersionId = async (id: string) => (await official(id))?.id ?? null;
const people = async () => ({
  kale: await actorFor("kale@example.com"),
  casey: await actorFor("casey@example.com"),
});

/** A text proposal with sensible defaults. */
async function propose(
  by: Awaited<ReturnType<typeof actorFor>>,
  section: string,
  title: string,
  text: string,
  extra: { noteIds?: string[]; businessTag?: string; now?: Date } = {},
) {
  return createProposal(
    by,
    {
      kind: "decision",
      sectionId: await sectionId(section),
      title,
      proposedOfficial: doc(text),
      businessTag: extra.businessTag,
      noteIds: extra.noteIds,
    },
    { now: extra.now },
  );
}

/** What the person "saw" on a fresh page for this proposal. */
async function seen(id: string) {
  const view = await proposal(id);
  return {
    revision: view.revision,
    currentVersionId: view.sectionId && view.type !== "structure" ? await currentVersionId(view.sectionId) : undefined,
  };
}

describe("the normal path: one Owner proposes, the other approves", () => {
  it("Kale proposes coffee wages at $15/hr, Casey approves, and Wages becomes official with both names", async () => {
    const { kale, casey } = await people();
    const wages = await sectionId("Wages");
    const id = await propose(kale, "Wages", "Coffee staff start at $15/hr", "Starting wage, Coffee Shop: $15.00/hr.", {
      businessTag: "coffee_shop",
    });

    // Proposing counts as approving, but nothing is official yet.
    let view = await proposal(id);
    expect(view).toMatchObject({ status: "open", type: "decision", proposedByName: "Kale", revision: 1, direct: false });
    expect(view.approvals.map((a) => a.name)).toEqual(["Kale"]);
    expect(await official(wages)).toBeNull();
    expect((await asSystem((db) => listOpenProposals(db))).map((p) => p.id)).toEqual([id]);
    expect((await asSystem((db) => listOpenProposalsForSection(db, wages))).map((p) => p.title)).toEqual([
      "Coffee staff start at $15/hr",
    ]);

    const outcome = await approveProposal(casey, id, await seen(id));
    expect(outcome).toEqual({ approved: true, waitingFor: [] });

    view = await proposal(id);
    expect(view.status).toBe("approved");
    expect(view.decidedByName).toBe("Casey");
    expect(view.approvals.map((a) => a.name)).toEqual(["Kale", "Casey"]);
    expect(view.resultVersion?.version).toBe(1);

    const now = await official(wages);
    expect(docToText(now!.content)).toBe("Starting wage, Coffee Shop: $15.00/hr.");
    expect(approvalLine(now!.approvals)).toBe(`Approved by Kale and Casey, ${formatDate(new Date())}`);
    expect(now).toMatchObject({ version: 1, origin: "proposal", proposedByName: "Kale", proposalId: id });

    // The Decisions Log records it; nothing is waiting any more.
    const decisions = await asSystem(async (db) => listDecisions(db, await loadTree(db)));
    expect(decisions.map((d) => d.title)).toEqual(["Coffee staff start at $15/hr"]);
    expect(await asSystem((db) => listOpenProposals(db))).toEqual([]);
    // Approved by both, so it is not a one-person decision.
    expect(await asSystem((db) => listOneOwnerDecisions(db))).toEqual([]);

    const [section] = await asSystem((db) => db.select().from(sections).where(eq(sections.id, wages)));
    expect(section.updatedBy).toBe(casey.id);
    const log = await asSystem((db) => db.select().from(activityLog).where(eq(activityLog.entityId, id)));
    expect(log.map((e) => e.summary)).toEqual([
      "Proposed: Coffee staff start at $15/hr",
      "Approved by Kale and Casey: Coffee staff start at $15/hr",
    ]);
  });

  it("the proposer pressing Approve again changes nothing: it still waits for the other Owner", async () => {
    const { kale } = await people();
    const id = await propose(kale, "Benefits", "Staff discount 20%", "Staff discount: 20%.");
    expect(await approveProposal(kale, id, await seen(id))).toEqual({ approved: false, waitingFor: ["Casey"] });
    expect((await proposal(id)).status).toBe("open");
    expect(await asSystem((db) => db.select().from(approvals).where(eq(approvals.proposalId, id)))).toHaveLength(1);
    await withdrawProposal(kale, id);
  });

  it("counts what is waiting for each person", async () => {
    const { kale, casey } = await people();
    const karen = await insertUser("Karen", "karen@example.com", "advisor");
    const id = await propose(kale, "Hiring", "Hire two seasonal staff", "Two seasonal hires for spring.");
    expect(await asSystem((db) => countAwaiting(db, casey))).toBe(1);
    expect(await asSystem((db) => countAwaiting(db, kale))).toBe(0);
    // An Advisor sees how many are open.
    expect(await asSystem((db) => countAwaiting(db, karen))).toBe(1);
    await withdrawProposal(kale, id);
    expect(await asSystem((db) => countAwaiting(db, casey))).toBe(0);
  });
});

describe("approving on your own", () => {
  it("makes it official with one name, flags it for the other Owner, who can add their approval", async () => {
    const { kale, casey } = await people();
    const hours = await sectionId("Store Hours");
    const id = await propose(kale, "Store Hours", "Open 9 to 6 in March", "March hours: 9 AM to 6 PM.");
    await approveAlone(kale, id, await seen(id));

    let view = await proposal(id);
    expect(view.status).toBe("approved");
    expect(view.approvals.map((a) => a.name)).toEqual(["Kale"]);
    expect(approvalLine((await official(hours))!.approvals)).toBe(`Approved by Kale, ${formatDate(new Date())}`);

    // Flagged, and Casey (not Kale) can add her approval.
    expect((await asSystem((db) => listOneOwnerDecisions(db))).map((d) => d.id)).toEqual([id]);
    expect(canApproveToo(view, casey)).toBe(true);
    expect(canApproveToo(view, kale)).toBe(false);

    await addApproval(casey, id);
    view = await proposal(id);
    expect(view.approvals.map((a) => a.name)).toEqual(["Kale", "Casey"]);
    expect(approvalLine((await official(hours))!.approvals)).toBe(`Approved by Kale and Casey, ${formatDate(new Date())}`);
    expect(await asSystem((db) => listOneOwnerDecisions(db))).toEqual([]);
    expect(canApproveToo(view, casey)).toBe(false);
    // Pressing it twice adds nothing.
    await addApproval(casey, id);
    expect(await asSystem((db) => db.select().from(approvals).where(eq(approvals.proposalId, id)))).toHaveLength(2);
  });

  it("flags a one-person decision for 14 days, and a text change only while it is still the current text", async () => {
    const { kale } = await people();
    const scheduling = await sectionId("Scheduling");
    const start = new Date("2026-06-01T15:00:00Z");
    const id = await propose(kale, "Scheduling", "Post schedules on Fridays", "Schedules go up every Friday.", { now: start });
    await approveAlone(kale, id, await seen(id), { now: start });

    const flagged = async (at: string) => (await asSystem((db) => listOneOwnerDecisions(db, new Date(at)))).map((d) => d.id);
    expect(await flagged("2026-06-01T20:00:00Z")).toContain(id);
    expect(await flagged("2026-06-15T20:00:00Z")).toContain(id);
    expect(await flagged("2026-06-16T20:00:00Z")).not.toContain(id);

    // A newer version of the same section takes its place.
    const later = new Date("2026-06-03T15:00:00Z");
    await saveOfficial(kale, scheduling, doc("Schedules go up every Thursday."), { now: later });
    const at = await asSystem((db) => listOneOwnerDecisions(db, new Date("2026-06-04T15:00:00Z")));
    expect(at.map((d) => d.id)).not.toContain(id);
    expect(at.filter((d) => d.sectionId === scheduling).map((d) => d.title)).toEqual(["Edited directly"]);
  });

  it("is the way forward when there is only one Owner, and then nothing is flagged", async () => {
    const { kale, casey } = await people();
    await changeUserRole(kale, casey.id, "advisor");
    const id = await propose(kale, "Training", "Two shadow shifts for new staff", "New staff shadow for two shifts.");
    expect(await approveProposal(kale, id, await seen(id))).toEqual({ approved: false, waitingFor: [] });
    await approveAlone(kale, id, await seen(id));
    expect((await proposal(id)).status).toBe("approved");
    expect((await asSystem((db) => listOneOwnerDecisions(db))).map((d) => d.id)).not.toContain(id);
    await changeUserRole(kale, casey.id, "owner");
    // With Casey an Owner again, it counts as decided by one person.
    expect((await asSystem((db) => listOneOwnerDecisions(db))).map((d) => d.id)).toContain(id);
  });
});

describe("declining and withdrawing", () => {
  it("lets the other Owner decline with a reason, and only the proposer withdraw", async () => {
    const { kale, casey } = await people();
    const id = await propose(kale, "Budget", "Raise the signage budget", "Signage budget: $12,000.");
    await expect(declineProposal(kale, id, "changed my mind")).rejects.toThrow("Withdraw it instead");
    await expect(withdrawProposal(casey, id)).rejects.toThrow("decline it instead");

    await declineProposal(casey, id, "  Too much before we see the quotes.  ");
    const view = await proposal(id);
    expect(view).toMatchObject({ status: "declined", decidedByName: "Casey", declineReason: "Too much before we see the quotes." });
    expect(await official(await sectionId("Budget"))).toBeNull();

    // Decided means decided.
    await expect(approveProposal(casey, id, { revision: 1 })).rejects.toThrow("already been declined");
    await expect(approveAlone(kale, id, { revision: 1 })).rejects.toThrow("already been declined");
    await expect(withdrawProposal(kale, id)).rejects.toThrow("already been declined");
    await expect(addApproval(casey, id)).rejects.toThrow(AppError);

    const other = await propose(kale, "Budget", "Raise the signage budget a little", "Signage budget: $9,000.");
    await withdrawProposal(kale, other);
    expect((await proposal(other)).status).toBe("withdrawn");
    expect((await asSystem((db) => listClosedProposals(db))).map((p) => p.status).sort()).toEqual(
      expect.arrayContaining(["declined", "withdrawn"]),
    );
    // Declined and withdrawn proposals are not decisions.
    const decisions = await asSystem(async (db) => listDecisions(db, await loadTree(db)));
    expect(decisions.map((d) => d.id)).not.toContain(id);
    expect(decisions.map((d) => d.id)).not.toContain(other);
  });

  it("keeps a reason short", async () => {
    const { kale, casey } = await people();
    const id = await propose(kale, "Quotes", "Go with Holly Lumber", "Signs: Holly Lumber.");
    await expect(declineProposal(casey, id, "x".repeat(501))).rejects.toThrow(AppError);
    await declineProposal(casey, id, "");
    expect((await proposal(id)).declineReason).toBeNull();
  });
});

describe("changing a proposal", () => {
  it("lets only the proposer change it, and nobody approves words they have not seen", async () => {
    const { kale, casey } = await people();
    const id = await propose(kale, "Perennials", "Order perennials in January", "Perennials are ordered in January.");
    const caseySaw = await seen(id);

    await expect(
      editProposal(casey, id, { kind: "decision", sectionId: await sectionId("Perennials"), title: "x", proposedOfficial: doc("y") }),
    ).rejects.toThrow("Only the person who made a proposal");

    await editProposal(kale, id, {
      kind: "decision",
      sectionId: await sectionId("Perennials"),
      title: "Order perennials in December",
      proposedOfficial: doc("Perennials are ordered in December."),
    });
    const view = await proposal(id);
    expect(view).toMatchObject({ title: "Order perennials in December", revision: 2, status: "open" });
    expect(view.approvals.map((a) => a.name)).toEqual(["Kale"]);

    // Casey still has the old page open.
    await expect(approveProposal(casey, id, caseySaw)).rejects.toThrow("Kale changed this proposal after you opened it");
    await expect(approveAlone(casey, id, caseySaw)).rejects.toThrow("changed this proposal");
    expect((await proposal(id)).status).toBe("open");
    expect((await proposal(id)).approvals).toHaveLength(1);

    await approveProposal(casey, id, await seen(id));
    expect(docToText((await official(await sectionId("Perennials")))!.content)).toBe("Perennials are ordered in December.");
  });

  it("cannot be changed once someone else has endorsed it", async () => {
    const { kale } = await people();
    const karen = await actorFor("karen@example.com");
    const houseplants = await sectionId("Houseplants");
    const id = await propose(kale, "Houseplants", "Stock houseplants year round", "Houseplants are stocked all year.");
    await endorseProposal(karen, id, { revision: 1 });
    await expect(
      editProposal(kale, id, { kind: "decision", sectionId: houseplants, title: "Changed", proposedOfficial: doc("Different.") }),
    ).rejects.toThrow("can no longer be changed");
    expect((await proposal(id)).title).toBe("Stock houseplants year round");
    await withdrawProposal(kale, id);
  });

  it("saving it again without a change is not a change", async () => {
    const { kale } = await people();
    const annuals = await sectionId("Annuals");
    const id = await propose(kale, "Annuals", "Annuals arrive in May", "Annuals arrive the first week of May.");
    await editProposal(kale, id, {
      kind: "decision",
      sectionId: annuals,
      title: "Annuals arrive in May",
      proposedOfficial: doc("Annuals arrive the first week of May."),
    });
    expect((await proposal(id)).revision).toBe(1);
    await expect(
      editProposal(kale, id, { kind: "decision", sectionId: await sectionId("Wages"), title: "t", proposedOfficial: doc("moved") }),
    ).rejects.toThrow("section of a proposal cannot be changed");
    await withdrawProposal(kale, id);
  });
});

describe("official text that changes while a proposal is open", () => {
  it("can still be approved, but only by someone who has seen the newer text", async () => {
    const { kale, casey } = await people();
    const signage = await sectionId("Signage");
    await saveOfficial(kale, signage, doc("Pylon sign: quote requested."));
    const id = await propose(kale, "Signage", "Go with Holly Lumber for the pylon sign", "Pylon sign: Holly Lumber, $8,400.");
    const before = await seen(id);

    // Casey fixes the text directly in the meantime.
    await saveOfficial(casey, signage, doc("Pylon sign: two quotes requested."));
    const view = await proposal(id);
    expect(view.status).toBe("open");
    expect(view.baseVersionId).not.toBe(await currentVersionId(signage));

    await expect(approveProposal(casey, id, before)).rejects.toThrow("official text of this section changed after you opened");
    expect((await proposal(id)).approvals).toHaveLength(1);

    await approveProposal(casey, id, await seen(id));
    expect(docToText((await official(signage))!.content)).toBe("Pylon sign: Holly Lumber, $8,400.");
    expect((await official(signage))!.version).toBe(3);
  });

  it("refuses a proposal that would change nothing", async () => {
    const { kale } = await people();
    const signage = await sectionId("Signage");
    await expect(
      createProposal(kale, { kind: "decision", sectionId: signage, title: "Same again", proposedOfficial: doc("Pylon sign: Holly Lumber, $8,400.") }),
    ).rejects.toThrow("same as the current one");
    await expect(
      createProposal(kale, { kind: "decision", sectionId: await sectionId("Construction"), title: "Nothing", proposedOfficial: doc(" ") }),
    ).rejects.toThrow("same as the current one");
    await expect(
      createProposal(kale, { kind: "decision", sectionId: signage, title: "  ", proposedOfficial: doc("New text.") }),
    ).rejects.toThrow(AppError);
    await expect(
      createProposal(kale, { kind: "decision", sectionId: signage, title: "x".repeat(161), proposedOfficial: doc("New text.") }),
    ).rejects.toThrow(AppError);
    await expect(
      createProposal(kale, { kind: "decision", sectionId: "00000000-0000-4000-8000-000000000000", title: "Lost", proposedOfficial: doc("x") }),
    ).rejects.toThrow("no longer exists");
  });
});

describe("direct edits are decisions too", () => {
  it("records an Edit official save as a one-person decision in the log", async () => {
    const { kale, casey } = await people();
    const mission = await sectionId("Mission and Culture");
    await saveOfficial(kale, mission, doc("We grow good plants."));
    const now = await official(mission);
    expect(now).toMatchObject({ origin: "direct", proposalTitle: "Edited directly", proposedByName: "Kale" });

    const view = await proposal(now!.proposalId);
    expect(view).toMatchObject({ direct: true, status: "approved", type: "official_text", decidedByName: "Kale" });
    expect((await asSystem((db) => listOneOwnerDecisions(db))).map((d) => d.id)).toContain(view.id);
    // It never shows as waiting, and never as declined or withdrawn.
    expect((await asSystem((db) => listOpenProposals(db))).map((p) => p.id)).not.toContain(view.id);

    await addApproval(casey, view.id);
    expect(approvalLine((await official(mission))!.approvals)).toBe(`Approved by Kale and Casey, ${formatDate(new Date())}`);
  });

  it("refuses a direct save made from an out-of-date page", async () => {
    const { kale, casey } = await people();
    const legal = await sectionId("Legal Entities");
    await saveOfficial(kale, legal, doc("Two companies."), { baseVersionId: null });
    const kaleStartedFrom = await currentVersionId(legal);
    await saveOfficial(casey, legal, doc("Two companies: garden center and coffee shop."), { baseVersionId: kaleStartedFrom });

    await expect(saveOfficial(kale, legal, doc("Two companys."), { baseVersionId: kaleStartedFrom })).rejects.toThrow(
      "Someone else changed this official text",
    );
    await expect(saveOfficial(kale, legal, doc("Starting over."), { baseVersionId: null })).rejects.toThrow(AppError);
    expect(docToText((await official(legal))!.content)).toBe("Two companies: garden center and coffee shop.");
    expect((await official(legal))!.version).toBe(2);
  });
});

describe("endorsements", () => {
  it("lets an Advisor endorse without changing anything, and shows it under the official text", async () => {
    const { kale, casey } = await people();
    const karen = await actorFor("karen@example.com");
    const pos = await sectionId("Point of Sale");
    const id = await propose(kale, "Point of Sale", "Use Square registers", "Registers: Square.");

    await endorseProposal(karen, id, { revision: 1 });
    await endorseProposal(karen, id, { revision: 1 });
    let view = await proposal(id);
    expect(view.status).toBe("open");
    expect(view.endorsements.map((e) => e.name)).toEqual(["Karen"]);

    await expect(approveProposal(karen, id, { revision: 1 })).rejects.toThrow(AppError);
    await expect(approveAlone(karen, id, { revision: 1 })).rejects.toThrow(AppError);
    await expect(declineProposal(karen, id, "no")).rejects.toThrow(AppError);
    await expect(withdrawProposal(karen, id)).rejects.toThrow(AppError);
    await expect(
      createProposal(karen, { kind: "decision", sectionId: pos, title: "Advisor proposal", proposedOfficial: doc("x") }),
    ).rejects.toThrow(AppError);

    // An Owner who approved does not also endorse.
    await expect(endorseProposal(kale, id, { revision: 1 })).rejects.toThrow("already approved");

    await approveProposal(casey, id, await seen(id));
    view = await proposal(id);
    expect(view.endorsements.map((e) => e.name)).toEqual(["Karen"]);
    expect((await official(pos))!.endorsements.map((e) => e.name)).toEqual(["Karen"]);
    expect((await official(pos))!.approvals.map((a) => a.name)).toEqual(["Kale", "Casey"]);
  });

  it("works on official text that is already approved, and not on declined proposals", async () => {
    const { kale, casey } = await people();
    const karen = await actorFor("karen@example.com");
    const coffee = await sectionId("Coffee Equipment");
    await saveOfficial(kale, coffee, doc("Espresso machine: two group."));
    const current = (await official(coffee))!;
    await endorseProposal(karen, current.proposalId, { revision: 1 });
    // Casey has not approved it, so she may endorse instead.
    await endorseProposal(casey, current.proposalId, { revision: 1 });
    expect((await official(coffee))!.endorsements.map((e) => e.name)).toEqual(["Karen", "Casey"]);
    expect((await official(coffee))!.approvals.map((a) => a.name)).toEqual(["Kale"]);

    const id = await propose(kale, "Coffee Equipment", "Buy a three group machine", "Espresso machine: three group.");
    await declineProposal(casey, id, "");
    await expect(endorseProposal(karen, id, { revision: 1 })).rejects.toThrow("declined or withdrawn");
  });

  it("is refused on a page that shows older wording", async () => {
    const { kale } = await people();
    const karen = await actorFor("karen@example.com");
    const hardGoods = await sectionId("Hard Goods");
    const id = await propose(kale, "Hard Goods", "Carry hose reels", "Hard goods include hose reels.");
    await editProposal(kale, id, { kind: "decision", sectionId: hardGoods, title: "Carry hose reels", proposedOfficial: doc("Hard goods include hose reels and timers.") });
    await expect(endorseProposal(karen, id, { revision: 1 })).rejects.toThrow("changed this proposal after you opened it");
    await endorseProposal(karen, id, { revision: 2 });
    await withdrawProposal(kale, id);
  });
});

describe("structure proposals", () => {
  it("adds a section when approved, and remembers which one", async () => {
    const { kale, casey } = await people();
    const equipment = await node("Equipment and Technology");
    const id = await createProposal(kale, {
      kind: "structure",
      change: { action: "add", parentId: equipment.id, title: "  Checkout and Line Buster Equipment " },
    });
    let view = await proposal(id);
    expect(view).toMatchObject({
      type: "structure",
      title: 'Add a section "Checkout and Line Buster Equipment" under 6 Equipment and Technology',
      sectionId: equipment.id,
      structureChange: { action: "add", title: "Checkout and Line Buster Equipment" },
    });
    expect(flattenTree(await tree()).map((n) => n.title)).not.toContain("Checkout and Line Buster Equipment");

    await approveProposal(casey, id, await seen(id));
    view = await proposal(id);
    const created = await node("Checkout and Line Buster Equipment");
    expect(created.number).toBe("6.3");
    expect(view.createdSectionId).toBe(created.id);
    expect(view.resultVersion).toBeNull();
    // Found in the Decisions Log under its parent section.
    const log = await asSystem(async (db) => listDecisions(db, await loadTree(db), { sectionId: equipment.id }));
    expect(log.map((d) => d.id)).toContain(id);
  });

  it("renames, moves and archives when approved", async () => {
    const { kale, casey } = await people();
    const benefits = await node("Benefits");
    const rename = await createProposal(kale, { kind: "structure", change: { action: "rename", sectionId: benefits.id, title: "Benefits and Perks" } });
    expect((await proposal(rename)).structureChange).toEqual({ action: "rename", title: "Benefits and Perks", fromTitle: "Benefits" });
    await approveProposal(casey, rename, await seen(rename));
    expect((await node("Benefits and Perks")).id).toBe(benefits.id);

    const coffeeShop = await node("Coffee Shop");
    const move = await createProposal(casey, { kind: "structure", change: { action: "move", sectionId: coffeeShop.id, parentId: null } });
    expect((await proposal(move)).title).toBe("Move 4.7 Coffee Shop to the top level");
    await approveProposal(kale, move, await seen(move));
    expect((await node("Coffee Shop")).depth).toBe(1);

    const timeline = await node("Opening Timeline");
    const archive = await createProposal(kale, { kind: "structure", change: { action: "archive", sectionId: timeline.id } });
    await approveAlone(kale, archive, await seen(archive));
    expect(flattenTree(await tree()).map((n) => n.title)).not.toContain("Opening Timeline");
    // A structure decision by one person is flagged like any other.
    expect((await asSystem((db) => listOneOwnerDecisions(db))).map((d) => d.id)).toContain(archive);
    await restoreSection(kale, timeline.id);
  });

  it("refuses changes that make no sense, when proposed", async () => {
    const { kale } = await people();
    const people2 = await node("People");
    const wages = await node("Wages");
    const make = (change: StructureProposalInput["change"]) => createProposal(kale, { kind: "structure", change });
    await expect(make({ action: "move", sectionId: people2.id, parentId: wages.id })).rejects.toThrow("under itself");
    await expect(make({ action: "move", sectionId: people2.id, parentId: people2.id })).rejects.toThrow("under itself");
    await expect(make({ action: "move", sectionId: wages.id, parentId: people2.id })).rejects.toThrow("already there");
    // People has subsections, so under a second-level section it would reach a fourth level.
    await expect(make({ action: "move", sectionId: people2.id, parentId: (await node("Budget")).id })).rejects.toThrow("three levels");
    await expect(make({ action: "rename", sectionId: wages.id, title: "Wages" })).rejects.toThrow("already the section's name");
    await expect(make({ action: "rename", sectionId: wages.id, title: " " })).rejects.toThrow(AppError);
    await expect(make({ action: "add", parentId: "00000000-0000-4000-8000-000000000000", title: "Orphan" })).rejects.toThrow(AppError);
    await expect(make({ action: "archive", sectionId: "00000000-0000-4000-8000-000000000000" })).rejects.toThrow(AppError);
  });

  it("does not half-apply: if the section is gone by approval time, nothing is recorded", async () => {
    const { kale, casey } = await people();
    const marketing = await node("Marketing and Events");
    const id = await createProposal(kale, { kind: "structure", change: { action: "rename", sectionId: marketing.id, title: "Marketing" } });
    await archiveSection(kale, marketing.id);

    await expect(approveProposal(casey, id, await seen(id))).rejects.toThrow("no longer exists");
    const view = await proposal(id);
    expect(view.status).toBe("open");
    // Casey's approval was undone together with the failed change.
    expect(view.approvals.map((a) => a.name)).toEqual(["Kale"]);
    await declineProposal(casey, id, "The section was archived.");
    await restoreSection(kale, marketing.id);
    expect((await node("Marketing and Events")).title).toBe("Marketing and Events");
  });

  it("says what a change does in one sentence", async () => {
    const current = await tree();
    const wages = await node("Wages");
    expect(describeStructure(current, null, { action: "add", title: "Seasonal" })).toBe('Add a top-level section "Seasonal"');
    expect(describeStructure(current, wages.id, { action: "archive" })).toBe("Archive 2.1 Wages");
    expect(describeStructure(current, "00000000-0000-4000-8000-000000000000", { action: "archive" })).toBe(
      "Archive a section that has been archived",
    );
  });
});

describe("when people change", () => {
  it("does not count the approval of someone who is no longer an Owner", async () => {
    const { kale, casey } = await people();
    const temp = await insertUser("Sam", "sam@example.com", "owner");
    const id = await propose(temp, "Vendor Contacts", "Add Holly Lumber", "Holly Lumber: signs and trim.");
    await asSystem((db) => db.update(users).set({ removedAt: new Date() }).where(eq(users.id, temp.id)));

    // Casey's approval is now the only one that counts.
    expect(await approveProposal(casey, id, await seen(id))).toEqual({ approved: false, waitingFor: ["Kale"] });
    expect(await approveProposal(kale, id, await seen(id))).toEqual({ approved: true, waitingFor: [] });
    const view = await proposal(id);
    // Sam's approval stays on record.
    expect(view.approvals.map((a) => a.name)).toEqual(["Sam", "Casey", "Kale"]);
    expect(view.decidedByName).toBe("Kale");
  });
});

describe("notes, comments and the log", () => {
  it("links a proposal to the notes it came from", async () => {
    const { kale, casey } = await people();
    const first = await addNote(kale, { body: doc("Kale suggests coffee staff at $16/hr") });
    const second = await addNote(casey, { body: doc("Casey: $16 matches the cafe down the road") });
    const id = await propose(kale, "Wages", "Coffee staff start at $16/hr", "Starting wage, Coffee Shop: $16.00/hr.", {
      noteIds: [first.id, second.id, first.id],
    });
    expect((await asSystem((db) => sourceNoteIds(db, id))).sort()).toEqual([first.id, second.id].sort());
    const byNote = await asSystem((db) => proposalsForNotes(db, [first.id, second.id]));
    expect(byNote.get(first.id)).toEqual([{ id, title: "Coffee staff start at $16/hr", status: "open" }]);
    await approveProposal(casey, id, await seen(id));
    expect((await asSystem((db) => proposalsForNotes(db, [first.id]))).get(first.id)?.[0].status).toBe("approved");

    const gone = await addNote(kale, { body: doc("pasted by mistake") });
    await removeNote(kale, gone.id);
    await expect(
      propose(kale, "Wages", "From a removed note", "Starting wage, Coffee Shop: $17.00/hr.", { noteIds: [gone.id] }),
    ).rejects.toThrow("was removed");
    await expect(
      propose(kale, "Wages", "Bad note id", "Starting wage, Coffee Shop: $17.00/hr.", { noteIds: ["not-an-id"] }),
    ).rejects.toThrow(AppError);
  });

  it("lets Owners and Advisors comment on a proposal, word for word", async () => {
    const { kale, casey } = await people();
    const karen = await actorFor("karen@example.com");
    const id = await propose(kale, "Policies and Expectations", "No phones at the registers", "Phones stay in lockers.");
    await addProposalComment(karen, id, doc("  Maybe allow them on breaks?  "));
    await addProposalComment(casey, id, doc("Agreed, breaks only."));
    const thread = await asSystem((db) => loadProposalComments(db, id));
    expect(thread.map((c) => `${c.authorName}: ${c.body.content[0].content?.[0].text}`)).toEqual([
      "Karen:   Maybe allow them on breaks?  ",
      "Casey: Agreed, breaks only.",
    ]);
    await expect(addProposalComment(karen, id, doc(" "))).rejects.toThrow(AppError);
    await expect(addProposalComment(karen, "00000000-0000-4000-8000-000000000000", doc("hello"))).rejects.toThrow(AppError);
    await withdrawProposal(kale, id);
    // Comments stay possible after a decision.
    await addProposalComment(karen, id, doc("Pity."));
    expect(await asSystem((db) => loadProposalComments(db, id))).toHaveLength(3);
  });

  it("filters the Decisions Log by section, business, approver and date", async () => {
    const { kale, casey } = await people();
    const at = (day: string) => new Date(`${day}T18:00:00Z`);
    const a = await propose(kale, "Opening Procedures", "Unlock at 8:30", "Doors unlock at 8:30 AM.", { businessTag: "garden_center", now: at("2026-03-02") });
    await approveProposal(casey, a, await seen(a), { now: at("2026-03-03") });
    const b = await propose(casey, "Closing Procedures", "Count the till twice", "The till is counted twice.", { businessTag: "both", now: at("2026-03-05") });
    await approveAlone(casey, b, await seen(b), { now: at("2026-03-05") });

    const run = (filters: Parameters<typeof listDecisions>[2]) =>
      asSystem(async (db) => (await listDecisions(db, await loadTree(db), filters)).map((d) => d.title));
    const hours = await sectionId("Hours and Daily Operations");

    expect(await run({ sectionId: hours, from: "2026-03-01", to: "2026-03-31" })).toEqual(["Count the till twice", "Unlock at 8:30"]);
    expect(await run({ sectionId: await sectionId("Opening Procedures") })).toEqual(["Unlock at 8:30"]);
    expect(await run({ from: "2026-03-03", to: "2026-03-03" })).toEqual(["Unlock at 8:30"]);
    expect(await run({ from: "2026-03-04", to: "2026-03-04" })).toEqual([]);
    expect(await run({ from: "2026-03-01", to: "2026-03-31", business: "coffee_shop" })).toEqual(["Count the till twice"]);
    expect(await run({ from: "2026-03-01", to: "2026-03-31", business: "garden_center" })).toEqual(["Count the till twice", "Unlock at 8:30"]);
    expect(await run({ from: "2026-03-01", to: "2026-03-31", approverId: kale.id })).toEqual(["Unlock at 8:30"]);
    expect(await run({ from: "2026-03-01", to: "2026-03-31", approverId: casey.id })).toEqual(["Count the till twice", "Unlock at 8:30"]);
    expect(await run({ sectionId: "00000000-0000-4000-8000-000000000000" })).toEqual([]);
  });

  it("keeps every version tied to the proposal that produced it", async () => {
    const versions = await asSystem((db) => db.select().from(officialVersions));
    const all = await asSystem((db) => db.select().from(proposals));
    expect(versions.length).toBeGreaterThan(5);
    for (const version of versions) {
      const from = all.find((p) => p.id === version.proposalId)!;
      expect(from.status).toBe("approved");
      expect(from.sectionId).toBe(version.sectionId);
      expect(from.proposedOfficialText).toBe(version.contentText);
    }
    expect(new Set(versions.map((v) => v.proposalId)).size).toBe(versions.length);
  });
});
