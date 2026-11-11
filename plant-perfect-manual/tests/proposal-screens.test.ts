import { describe, expect, it } from "vitest";
import { asSystem } from "@/db/client";
import { compareDocs } from "@/lib/diff";
import { loadOfficial, saveOfficial } from "@/lib/official";
import {
  type ProposalView,
  approveAlone,
  approveChoices,
  activeApprovers,
  approveProposal,
  canEditProposal,
  canEndorse,
  createProposal,
  declineProposal,
  displayTitle,
  endorseProposal,
  listDecisions,
  loadProposal,
  loadTextChange,
  statusLine,
  waitingFor,
  withdrawProposal,
} from "@/lib/proposals";
import { type RichDoc, docToLines, docToText, sanitizeDoc, textToDoc } from "@/lib/richtext";
import { flattenTree, loadTree } from "@/lib/sections";
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
    expect(displayTitle(direct, await tree())).toBe("Edited directly: 2.2 Benefits");
    expect(statusLine(direct)).toBe("Approved by Kale, Nov 14, 2026");
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

    // Approved: compared with the text it actually replaced.
    await approveProposal(kale, id, { revision: 1, currentVersionId: second.id });
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
    expect(compareDocs(plain, bold)).toEqual({ kind: "formatting" });
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
