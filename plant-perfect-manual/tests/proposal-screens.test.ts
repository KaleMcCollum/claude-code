import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { asSystem } from "@/db/client";
import { activityLog } from "@/db/schema";
import { compareDocs } from "@/lib/diff";
import { loadOfficial, saveOfficial } from "@/lib/official";
import {
  type ProposalView,
  UNREADABLE_CHANGE_SENTENCE,
  addApproval,
  approveAlone,
  approveChoices,
  activeApprovers,
  approveProposal,
  canApproveToo,
  canEditProposal,
  canEndorse,
  changesNotApprovedBy,
  createProposal,
  declineProposal,
  describeStructure,
  displayTitle,
  editProposal,
  endorseProposal,
  listDecisions,
  listOneOwnerDecisions,
  loadProposal,
  loadTextChange,
  statusLine,
  waitingFor,
  withdrawProposal,
} from "@/lib/proposals";
import { type RichDoc, docToLines, docToText, sanitizeDoc, textToDoc } from "@/lib/richtext";
import { flattenTree, loadTree, moveSection, renameSection, restoreSection } from "@/lib/sections";
import { removeUser } from "@/lib/users";
import { actorFor, insertUser, withTestDatabase } from "./helpers/db";

withTestDatabase();

/**
 * The small questions the proposal screens ask: which buttons to show, what
 * to compare the proposed text with, what one line says about its status.
 */

const doc = (...paragraphs: string[]): RichDoc => ({
  type: "doc",
  content: paragraphs.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })),
});
const tree = () => asSystem((db) => loadTree(db));
const sectionId = async (title: string) => flattenTree(await tree()).find((n) => n.title === title)!.id;
const view = async (id: string) => (await asSystem((db) => loadProposal(db, id))) as ProposalView;
const approvers = () => asSystem((db) => activeApprovers(db));
const change = async (id: string) => asSystem(async (db) => loadTextChange(db, (await loadProposal(db, id))!));
const at = (day: string) => new Date(`${day}T18:00:00Z`);

describe("which buttons a proposal shows", () => {
  it("follows who has approved and who could", async () => {
    const kale = await actorFor("kale@example.com");
    const casey = await actorFor("casey@example.com");
    const karen = await insertUser("Karen", "karen@example.com", "advisor");
    const id = await createProposal(
      kale,
      { kind: "decision", sectionId: await sectionId("Wages"), title: "Coffee wages", proposedOfficial: doc("$15.00/hr") },
      { now: at("2026-11-10") },
    );
    let p = await view(id);
    const owners = await approvers();

    // Kale proposed it, so his approval is in: he can only go ahead alone.
    expect(approveChoices(p, kale, owners)).toEqual({ approve: false, alone: true });
    // Casey's approval completes it, so there is nothing to do "on her own".
    expect(approveChoices(p, casey, owners)).toEqual({ approve: true, alone: false });
    expect(approveChoices(p, karen, owners)).toEqual({ approve: false, alone: false });
    expect(waitingFor(p, owners)).toEqual(["Casey"]);
    expect(statusLine(p)).toBe("Waiting for approval");
    expect(displayTitle(p, await tree())).toBe("Coffee wages");

    expect(canEditProposal(p, kale)).toBe(true);
    expect(canEditProposal(p, casey)).toBe(false);
    expect(canEndorse(p, karen)).toBe(true);
    expect(canEndorse(p, casey)).toBe(true);
    // He approved it by proposing it, which says more than an endorsement.
    expect(canEndorse(p, kale)).toBe(false);

    await endorseProposal(karen, id, { revision: 1 });
    p = await view(id);
    expect(canEndorse(p, karen)).toBe(false);
    // Someone else has put their name to these words: no more changes.
    expect(canEditProposal(p, kale)).toBe(false);

    await approveProposal(casey, id, { revision: 1, currentVersionId: null }, { now: at("2026-11-12") });
    p = await view(id);
    expect(approveChoices(p, casey, owners)).toEqual({ approve: false, alone: false });
    expect(waitingFor(p, owners)).toEqual([]);
    expect(statusLine(p)).toBe("Approved by Kale and Casey, Nov 12, 2026");
    expect(canEndorse(p, karen)).toBe(false);
  });

  it("offers both ways when the proposer can no longer approve", async () => {
    const casey = await actorFor("casey@example.com");
    const kale = await actorFor("kale@example.com");
    const sam = await insertUser("Sam", "sam@example.com", "owner");
    const id = await createProposal(sam, {
      kind: "decision",
      sectionId: await sectionId("Hiring"),
      title: "Hire at 16",
      proposedOfficial: doc("We hire from age 16."),
    });
    // With three Owners, one more approval completes it for either of the others.
    expect(approveChoices(await view(id), casey, await approvers())).toEqual({ approve: true, alone: false });
    await removeUser(kale, sam.id);
    // Sam's approval no longer counts: Casey can approve and wait for Kale, or go ahead alone.
    const owners = await approvers();
    expect(owners.map((o) => o.name).sort()).toEqual(["Casey", "Kale"]);
    expect(approveChoices(await view(id), casey, owners)).toEqual({ approve: true, alone: true });
    expect(waitingFor(await view(id), owners).sort()).toEqual(["Casey", "Kale"]);
    await declineProposal(kale, id, "Not yet", { now: at("2026-11-13") });
    expect(statusLine(await view(id))).toBe("Declined by Kale, Nov 13, 2026");
    expect(approveChoices(await view(id), casey, owners)).toEqual({ approve: false, alone: false });
    expect(canEndorse(await view(id), casey)).toBe(false);
  });

  it("names the section of a direct edit, which has no title of its own", async () => {
    const kale = await actorFor("kale@example.com");
    const benefits = await sectionId("Benefits");
    await saveOfficial(kale, benefits, doc("One free coffee per shift."), { now: at("2026-11-14") });
    const [direct] = await asSystem(async (db) => listDecisions(db, await loadTree(db), { sectionId: benefits }));
    expect(displayTitle(direct, await tree())).toBe("Edited directly: 2.2 Benefits (version 1)");
    expect(statusLine(direct)).toBe("Approved by Kale, Nov 14, 2026");
  });
});

describe("the title of a structure proposal", () => {
  it("is worked out from what it will do, with the sections as they are named and numbered now", async () => {
    const kale = await actorFor("kale@example.com");
    const casey = await actorFor("casey@example.com");
    const training = flattenTree(await tree()).find((n) => n.title === "Training")!;
    expect(training.number).toBe("2.4");
    const archive = await createProposal(kale, { kind: "structure", change: { action: "archive", sectionId: training.id } });
    const rename = await createProposal(kale, { kind: "structure", change: { action: "rename", sectionId: training.id, title: "Learning" } });
    const move = await createProposal(casey, { kind: "structure", change: { action: "move", sectionId: training.id, parentId: await sectionId("Finance") } });
    const shown = async (id: string) => displayTitle(await view(id), await tree());
    expect(await shown(archive)).toBe("Archive 2.4 Training");
    expect(await shown(rename)).toBe('Rename 2.4 Training to "Learning"');
    expect(await shown(move)).toBe("Move 2.4 Training under 8 Finance");

    // The section is renamed, and moved up one place, while the proposals are open.
    await renameSection(kale, training.id, "Training and Shadowing");
    await moveSection(kale, training.id, "up");
    await renameSection(kale, await sectionId("Finance"), "Money");
    expect(await shown(archive)).toBe("Archive 2.3 Training and Shadowing");
    expect(await shown(rename)).toBe('Rename 2.3 Training and Shadowing to "Learning"');
    expect(await shown(move)).toBe("Move 2.3 Training and Shadowing under 8 Money");
    // What was stored when they were proposed is not what is shown.
    expect((await view(archive)).title).toBe("Archive 2.4 Training");

    // A declined or withdrawn proposal goes back to the title stored when it was proposed.
    await declineProposal(casey, archive, "");
    expect(await shown(archive)).toBe("Archive 2.4 Training");
    await withdrawProposal(casey, move);
    expect(await shown(move)).toBe("Move 2.4 Training under 8 Finance");
    // An approved one keeps the sentence the approver was shown when she
    // pressed Approve, whatever the sections are called afterwards.
    await approveProposal(casey, rename, { revision: 1 });
    expect(await shown(rename)).toBe('Rename 2.3 Training and Shadowing to "Learning"');
    expect(await view(rename)).toMatchObject({
      title: 'Rename 2.4 Training to "Learning"',
      decidedTitle: 'Rename 2.3 Training and Shadowing to "Learning"',
    });
    await renameSection(kale, training.id, "Coaching");
    expect(await shown(rename)).toBe('Rename 2.3 Training and Shadowing to "Learning"');
    // Only an approved section change has such a sentence.
    expect((await view(archive)).decidedTitle).toBeNull();
    expect((await view(move)).decidedTitle).toBeNull();
    await renameSection(kale, await sectionId("Money"), "Finance");
  });

  it("an approved section change is recorded as what the approver was shown, not as it was first proposed", async () => {
    const kale = await actorFor("kale@example.com");
    const casey = await actorFor("casey@example.com");
    const perennials = await sectionId("Perennials");
    const annuals = await sectionId("Annuals");
    const shown = async (id: string) => displayTitle(await view(id), await tree());
    const logged = async (id: string) =>
      (await asSystem((db) => db.select().from(activityLog).where(eq(activityLog.entityId, id)).orderBy(activityLog.id))).map((e) => e.summary);

    // Kale proposes to archive Perennials, then swaps the names of the two sections.
    const archive = await createProposal(kale, { kind: "structure", change: { action: "archive", sectionId: perennials } });
    expect(await shown(archive)).toBe("Archive 4.3 Perennials");
    await renameSection(kale, perennials, "Old stock list");
    await renameSection(kale, annuals, "Perennials");
    await renameSection(kale, perennials, "Annuals");
    // Casey is shown what it will really do, and approves that.
    expect(await shown(archive)).toBe("Archive 4.3 Annuals");
    await approveProposal(casey, archive, { revision: 1 });
    // The record says what she approved: in lists, in the Decisions Log and in the activity log.
    expect(await shown(archive)).toBe("Archive 4.3 Annuals");
    const decisions = await asSystem(async (db) => listDecisions(db, await loadTree(db)));
    expect(displayTitle(decisions.find((d) => d.id === archive)!, await tree())).toBe("Archive 4.3 Annuals");
    expect(await logged(archive)).toEqual(["Proposed: Archive 4.3 Perennials", "Approved by Kale and Casey: Archive 4.3 Annuals"]);
    // The section called Perennials today is still there.
    expect(flattenTree(await tree()).map((n) => n.id)).toContain(annuals);
    expect(flattenTree(await tree()).map((n) => n.id)).not.toContain(perennials);
    await restoreSection(kale, perennials);

    // A rename, when the section was renamed and moved up while the proposal waited.
    const deadlines = await sectionId("Order Deadlines");
    const rename = await createProposal(kale, { kind: "structure", change: { action: "rename", sectionId: deadlines, title: "Cut-off dates" } });
    expect((await view(rename)).title).toBe('Rename 7.2 Order Deadlines to "Cut-off dates"');
    await renameSection(casey, deadlines, "Ordering deadlines");
    await moveSection(casey, deadlines, "up");
    expect(await shown(rename)).toBe('Rename 7.1 Ordering deadlines to "Cut-off dates"');
    await approveProposal(casey, rename, { revision: 1 });
    expect(await shown(rename)).toBe('Rename 7.1 Ordering deadlines to "Cut-off dates"');
    expect((await logged(rename)).at(-1)).toBe('Approved by Kale and Casey: Rename 7.1 Ordering deadlines to "Cut-off dates"');

    // An added section: the sentence names the parent as it was just before.
    const vendors = await sectionId("Vendors and Purchasing");
    const add = await createProposal(casey, { kind: "structure", change: { action: "add", parentId: vendors, title: "Returns" } });
    await renameSection(kale, vendors, "Suppliers");
    await approveAlone(casey, add, { revision: 1 });
    expect(await view(add)).toMatchObject({
      title: 'Add a section "Returns" under 7 Vendors and Purchasing',
      decidedTitle: 'Add a section "Returns" under 7 Suppliers',
    });
    // A text proposal has no such sentence: its title is its own.
    const text = await createProposal(kale, { kind: "decision", sectionId: vendors, title: "Pay suppliers in 30 days", proposedOfficial: doc("Suppliers are paid within 30 days.") });
    await approveProposal(casey, text, { revision: 1, currentVersionId: null });
    expect(await view(text)).toMatchObject({ status: "approved", decidedTitle: null });
    expect(await shown(text)).toBe("Pay suppliers in 30 days");
    // And a section change decided before the sentence was recorded shows its stored title.
    expect(
      displayTitle({ title: "Archive 9 Old", direct: false, sectionId: null, type: "structure", status: "approved", structureChange: { action: "archive" } }, await tree()),
    ).toBe("Archive 9 Old");
    expect(
      displayTitle({ title: "Archive 9 Old", decidedTitle: null, direct: false, sectionId: null, type: "structure", status: "approved", structureChange: { action: "archive" } }, await tree()),
    ).toBe("Archive 9 Old");
  });

  it("says so plainly when a change is not one the app knows", async () => {
    const current = await tree();
    const hiring = await sectionId("Hiring");
    for (const odd of [{ action: "tidy" }, { action: "rename" }, { action: "add", title: " " }, { action: "move" }, {}]) {
      expect(describeStructure(current, hiring, odd as never)).toBe(UNREADABLE_CHANGE_SENTENCE);
      expect(
        displayTitle(
          { title: "Tidy up the Hiring page", direct: false, sectionId: hiring, type: "structure", status: "open", structureChange: odd as never },
          current,
        ),
      ).toBe(UNREADABLE_CHANGE_SENTENCE);
    }
    expect(UNREADABLE_CHANGE_SENTENCE).toContain("cannot read");
  });
});

describe("a one-person change that is followed by a small proposal", () => {
  it("stays flagged, and the proposal page can warn what the comparison already contains", async () => {
    const kale = await actorFor("kale@example.com");
    const casey = await actorFor("casey@example.com");
    const karen = await actorFor("karen@example.com");
    const pay = await sectionId("Policies and Expectations");
    const flagged = async () => (await asSystem((db) => listOneOwnerDecisions(db))).filter((d) => d.sectionId === pay);

    // Both Owners agreed on $15.
    const agreed = await createProposal(kale, {
      kind: "decision",
      sectionId: pay,
      title: "Coffee staff start at $15/hr",
      proposedOfficial: doc("Coffee staff start at $15.00/hr. Raises are reviewed every March"),
    });
    await approveProposal(casey, agreed, { revision: 1, currentVersionId: null });
    expect(await asSystem((db) => changesNotApprovedBy(db, pay, casey))).toEqual({ items: [], total: 0 });

    // Kale alone changes the wage, then proposes only a full stop.
    await saveOfficial(kale, pay, doc("Coffee staff start at $11.00/hr. Raises are reviewed every March"));
    const [solo] = await flagged();
    expect(solo).toMatchObject({ direct: true, decidedAlone: true, soloOpen: true, superseded: false });
    const fix = await createProposal(kale, {
      kind: "official_text",
      sectionId: pay,
      title: "Add the missing full stop",
      proposedOfficial: doc("Coffee staff start at $11.00/hr. Raises are reviewed every March."),
    });

    // Casey's page compares $11 with $11 plus a full stop. The warning says
    // what that $11 text is: a change she never approved.
    const c = (await change(fix))!;
    expect(docToText(c.before!)).toContain("$11.00/hr");
    const warning = await asSystem((db) => changesNotApprovedBy(db, pay, casey));
    expect(warning.total).toBe(1);
    expect(warning.items[0]).toMatchObject({ version: 2, proposalId: solo.id, title: "Edited directly", approvedBy: ["Kale"], versionId: c.currentVersionId });
    // Kale approved everything that is in the current text; an Advisor is not asked.
    expect(await asSystem((db) => changesNotApprovedBy(db, pay, kale))).toEqual({ items: [], total: 0 });
    expect(await asSystem((db) => changesNotApprovedBy(db, pay, karen))).toEqual({ items: [], total: 0 });

    // She approves the full stop. The $11 change is still on her list, marked as no longer current.
    await approveProposal(casey, fix, { revision: 1, currentVersionId: c.currentVersionId });
    const after = await flagged();
    expect(after.map((d) => [d.id, d.superseded])).toEqual([[solo.id, true]]);
    expect(canApproveToo(after[0], casey)).toBe(true);
    expect(canApproveToo(after[0], kale)).toBe(false);
    expect(canApproveToo(after[0], karen)).toBe(false);
    expect(statusLine(after[0])).toMatch(/^Approved by Kale, /);
    await addApproval(casey, solo.id);
    expect(await flagged()).toEqual([]);
  });
});

describe("what a text proposal is compared with", () => {
  it("is the official text now while open, and says when that has moved on", async () => {
    const kale = await actorFor("kale@example.com");
    const casey = await actorFor("casey@example.com");
    const hours = await sectionId("Store Hours");
    await saveOfficial(kale, hours, doc("Open 9 to 6."));
    const first = (await asSystem((db) => loadOfficial(db, hours)))!;

    const id = await createProposal(casey, {
      kind: "official_text",
      sectionId: hours,
      title: "Sunday hours",
      proposedOfficial: doc("Open 9 to 6.", "Closed Sundays."),
    });
    let c = (await change(id))!;
    expect(c).toMatchObject({ basis: "now", changedSince: false, currentVersionId: first.id });
    expect(docToText(c.before!)).toBe("Open 9 to 6.");
    expect(compareDocs(c.before, c.after)).toEqual({
      kind: "words",
      parts: [
        { kind: "same", text: "Open 9 to 6." },
        { kind: "added", text: "\nClosed Sundays." },
      ],
    });

    // The official text changes while the proposal is open.
    await saveOfficial(kale, hours, doc("Open 8 to 6."));
    const second = (await asSystem((db) => loadOfficial(db, hours)))!;
    c = (await change(id))!;
    expect(c).toMatchObject({ basis: "now", changedSince: true, currentVersionId: second.id });
    expect(docToText(c.before!)).toBe("Open 8 to 6.");

    // The proposal is now out of date. Kale is offered neither button: with
    // Casey's approval on it, his would make it a two-person decision, and
    // hers was never given on top of the new text. A press of either is
    // refused. Casey herself could still go ahead on her own (flagged).
    let p = await view(id);
    expect(p.outOfDate).toBe(true);
    expect(approveChoices(p, kale, await approvers())).toEqual({ approve: false, alone: false });
    expect(approveChoices(p, casey, await approvers())).toEqual({ approve: false, alone: true });
    const sinceCasey =
      "The official text of this section has changed since Casey proposed this. Casey needs to check the proposal against the new text and save it again before it can be approved. You can comment on it or decline it.";
    await expect(approveProposal(kale, id, { revision: 1, currentVersionId: second.id })).rejects.toThrow(sinceCasey);
    await expect(approveAlone(kale, id, { revision: 1, currentVersionId: second.id })).rejects.toThrow(sinceCasey);
    expect((await view(id)).approvals.map((a) => a.name)).toEqual(["Casey"]);
    // Casey checks her proposal against the new text (her edit page showed
    // the current version) and saves it again.
    await editProposal(
      casey,
      id,
      { kind: "official_text", sectionId: hours, title: "Sunday hours", proposedOfficial: doc("Open 9 to 6.", "Closed Sundays.") },
      { currentVersionId: second.id },
    );
    p = await view(id);
    expect(p).toMatchObject({ outOfDate: false, revision: 2, baseVersionId: second.id });
    expect(await change(id)).toMatchObject({ basis: "now", changedSince: false, currentVersionId: second.id });
    expect(approveChoices(p, kale, await approvers())).toEqual({ approve: true, alone: false });

    // Approved: compared with the text it actually replaced.
    await approveProposal(kale, id, { revision: 2, currentVersionId: second.id });
    c = (await change(id))!;
    expect(c).toMatchObject({ basis: "replaced", changedSince: false });
    expect(docToText(c.before!)).toBe("Open 8 to 6.");
    expect(docToText(c.after)).toBe("Open 9 to 6.\nClosed Sundays.");
  });

  it("is the text of the time for a withdrawn proposal, and nothing for a first text", async () => {
    const kale = await actorFor("kale@example.com");
    const hours = await sectionId("Store Hours");
    const before = (await asSystem((db) => loadOfficial(db, hours)))!;
    const id = await createProposal(kale, {
      kind: "official_text",
      sectionId: hours,
      title: "Longer hours",
      proposedOfficial: doc("Open 7 to 9."),
    });
    await withdrawProposal(kale, id);
    await saveOfficial(kale, hours, doc("Open 10 to 4."));
    const c = (await change(id))!;
    expect(c.basis).toBe("then");
    expect(docToText(c.before!)).toBe(docToText(before.content));

    const first = await createProposal(kale, {
      kind: "decision",
      sectionId: await sectionId("Scheduling"),
      title: "Two-week schedules",
      proposedOfficial: doc("Schedules are posted two weeks ahead."),
    });
    expect(await change(first)).toMatchObject({ before: null, basis: "now", changedSince: false, currentVersionId: null });
    await approveAlone(kale, first, { revision: 1, currentVersionId: null });
    expect(await change(first)).toMatchObject({ before: null, basis: "replaced" });

    const structure = await createProposal(kale, {
      kind: "structure",
      change: { action: "add", parentId: null, title: "Seasonal Plans" },
    });
    expect(await change(structure)).toBeNull();
  });
});

describe("comparing two versions", () => {
  it("tells words from formatting", () => {
    const plain = doc("Starting wage: $15.00/hr.");
    const bold: RichDoc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Starting wage: $15.00/hr.", marks: [{ type: "bold" }] }] },
      ],
    };
    expect(compareDocs(plain, plain)).toEqual({ kind: "same" });
    expect(compareDocs(plain, bold)).toEqual({ kind: "formatting", links: false, checks: false });
    expect(compareDocs(null, { type: "doc", content: [{ type: "paragraph" }] })).toEqual({ kind: "same" });
    expect(compareDocs(null, plain)).toEqual({ kind: "words", parts: [{ kind: "added", text: "Starting wage: $15.00/hr." }] });
    expect(compareDocs(plain, doc("Starting wage: $16.00/hr."))).toEqual({
      kind: "words",
      parts: [
        { kind: "same", text: "Starting wage: " },
        { kind: "removed", text: "$15.00/hr." },
        { kind: "added", text: "$16.00/hr." },
      ],
    });
    const long = doc(Array.from({ length: 3000 }, (_, i) => `w${i}`).join(" "));
    expect(compareDocs(plain, long)).toEqual({ kind: "tooLong" });
  });
});

describe("text typed in a plain box", () => {
  it("becomes one paragraph per line, exactly as typed, and goes back the same", () => {
    const typed = "  Karen said   $15 is right\n\n- matches the registers\t(ask Casey)  \n";
    const made = textToDoc(typed);
    expect(made.content).toEqual([
      { type: "paragraph", content: [{ type: "text", text: "  Karen said   $15 is right" }] },
      { type: "paragraph" },
      { type: "paragraph", content: [{ type: "text", text: "- matches the registers\t(ask Casey)  " }] },
      { type: "paragraph" },
    ]);
    // The app's own check accepts it unchanged.
    expect(sanitizeDoc(made)).toEqual(made);
    expect(docToLines(made)).toBe(typed);
    expect(docToLines(textToDoc("one line"))).toBe("one line");
    // Line endings from other systems are the same line breaks.
    expect(textToDoc("a\r\nb\rc")).toEqual(textToDoc("a\nb\nc"));
    expect(textToDoc("").content).toEqual([{ type: "paragraph" }]);
  });
});
