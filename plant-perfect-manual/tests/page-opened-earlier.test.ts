import { asc, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { asSystem } from "@/db/client";
import { activityLog, sections } from "@/db/schema";
import { listVersions, loadOfficial, saveOfficial } from "@/lib/official";
import type { Actor } from "@/lib/permissions";
import {
  type ProposalView,
  type Seen,
  activeApprovers,
  approveAlone,
  approveChoices,
  approveProposal,
  blockedNotice,
  canEndorse,
  createProposal,
  editProposal,
  endorseProposal,
  listOneOwnerDecisions,
  loadProposal,
  loadTextChange,
  waitingText,
} from "@/lib/proposals";
import { type RichDoc, docToText } from "@/lib/richtext";
import { archiveSection } from "@/lib/sections";
import { actorFor, insertUser, withTestDatabase } from "./helpers/db";

withTestDatabase();

/**
 * A button pressed on a proposal's page that was opened BEFORE the official
 * text of its section changed. Such a page still shows "Approve", "Approve
 * on my own" and "Endorse", and with the press it sends what it showed: the
 * proposal's revision and the official version it compared with, which is
 * now an older one. (No page opened after the change has those buttons.)
 *
 * The answer has to be something the person can act on. "Reload the page
 * and read it again, then approve" is not: after that reload the page has
 * no approve button. So the press is answered with what stands in the way,
 * in the words the page itself would use after a reload, and nothing is
 * recorded.
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
const officialText = async (sectionId: string) => docToText((await asSystem((db) => loadOfficial(db, sectionId)))?.content ?? doc());
const currentId = async (sectionId: string) => (await asSystem((db) => loadOfficial(db, sectionId)))?.id ?? null;
/** What a proposal page sends back with a button press: what it showed when it was opened. */
async function pageOpenedNow(id: string): Promise<Required<Seen>> {
  const p = await view(id);
  const change = (await asSystem((db) => loadTextChange(db, p)))!;
  return { revision: p.revision, currentVersionId: change.currentVersionId };
}
/** Everything a refused press could have left behind. */
async function record(sectionId: string, id: string) {
  const p = await view(id);
  return {
    text: await officialText(sectionId),
    versions: (await asSystem((db) => listVersions(db, sectionId))).length,
    status: p.status,
    revision: p.revision,
    approvals: p.approvals.map((a) => a.name),
    endorsements: p.endorsements.map((e) => e.name),
    logged: (await asSystem((db) => db.select().from(activityLog).where(eq(activityLog.entityId, id)).orderBy(asc(activityLog.id)))).map((line) => line.action),
    flagged: (await asSystem((db) => listOneOwnerDecisions(db))).some((decision) => decision.id === id),
  };
}
/** Why a press was refused: the sentence the person reads. */
async function answer(press: Promise<unknown>): Promise<string> {
  try {
    await press;
  } catch (error) {
    return (error as Error).message;
  }
  return "(it went through)";
}

// What the two older checks say. The second is the one that used to answer these presses.
const RELOAD_THEN_APPROVE =
  "The official text of this section changed after you opened this page. Reload the page and read it again, then approve.";
// Approving, as its proposer reads it and as the other Owner reads it.
const CHECK_FIRST =
  "The official text of this section has changed since you proposed this. Check your proposal against the new text and save it again. Then it can be approved.";
const CANNOT_CHANGE_IT =
  "The official text of this section has changed since you proposed this, and you can no longer change it. Withdraw it and make a new proposal.";
const sinceProposed = (name: string) =>
  `The official text of this section has changed since ${name} proposed this. ${name} needs to check the proposal against the new text and save it again before it can be approved. You can comment on it or decline it.`;
const CANNOT_BE_CHECKED =
  "The official text of this section has changed since this was proposed, and the person who proposed it can no longer change it. Decline it and make a new proposal.";
// Endorsing.
const ENDORSE_ONCE_CHECKED = (name: string) =>
  `The official text of this section has changed since this was proposed. It can be endorsed once ${name} has checked it against the new text.`;
const NEVER_ENDORSED =
  "The official text of this section has changed since this was proposed, and it can no longer be approved. It cannot be endorsed.";
const NOTHING_TO_ENDORSE = "The official text of this section already says what this proposes, so there is nothing to endorse.";
// The two other things that can stand in the way.
const NOTHING_TO_APPROVE = "The official text of this section already says what this proposes, so there is nothing to approve.";
const SECTION_GONE = "The section this is about no longer exists (it may have been archived). Withdraw or decline this proposal.";

let kale: Actor;
let casey: Actor;
let karen: Actor;

beforeAll(async () => {
  kale = await actorFor("kale@example.com");
  casey = await actorFor("casey@example.com");
  karen = await insertUser("Karen", "karen@example.com", "advisor");
});

/**
 * Casey proposes a change to a section that has official text. Everyone
 * opens its page. Then Kale saves other words as the official text of that
 * section, directly. The pages opened before that are handed back.
 */
async function proposedThenOfficialTextChanged(
  sectionTitle: string,
  options: { endorsedFirstBy?: Actor; newOfficial?: string } = {},
): Promise<{ sectionId: string; id: string; opened: Required<Seen>; shownVersion: string }> {
  const sectionId = await section(sectionTitle);
  await saveOfficial(kale, sectionId, doc("The text before anyone proposed anything."));
  const shownVersion = (await currentId(sectionId)) as string;
  const id = await createProposal(casey, { kind: "decision", sectionId, title: `About ${sectionTitle}`, proposedOfficial: doc(`What Casey proposes for ${sectionTitle}.`) });
  if (options.endorsedFirstBy) await endorseProposal(options.endorsedFirstBy, id, await pageOpenedNow(id));
  // The pages, as they are opened now: they compare the proposal with the official text of this moment.
  const opened = await pageOpenedNow(id);
  expect(opened).toEqual({ revision: 1, currentVersionId: shownVersion });
  const before = await view(id);
  expect(before.outOfDate).toBe(false);
  // Those pages show the buttons: Approve on my own for its proposer, Approve for the other Owner.
  expect(approveChoices(before, casey, await owners())).toEqual({ approve: false, alone: true });
  expect(approveChoices(before, kale, await owners())).toEqual({ approve: true, alone: false });
  await saveOfficial(kale, sectionId, doc(options.newOfficial ?? "Kale's newer words, saved directly."));
  // The version those pages showed is an older one now. No page opened from here on has an approve button.
  expect(await currentId(sectionId)).not.toBe(shownVersion);
  for (const who of [casey, kale]) expect(approveChoices(await view(id), who, await owners())).toEqual({ approve: false, alone: false });
  return { sectionId, id, opened, shownVersion };
}

describe("Approve on my own, pressed by its proposer on a page opened before the official text changed", () => {
  it("while it waits for their check: they read the check sentence, not 'reload, then approve'", async () => {
    const { sectionId, id, opened } = await proposedThenOfficialTextChanged("Wages");
    expect(await view(id)).toMatchObject({ outOfDate: true, proposerCanChange: true });
    const before = await record(sectionId, id);
    expect(await answer(approveAlone(casey, id, opened))).toBe(CHECK_FIRST);
    expect(await record(sectionId, id)).toEqual(before);
    expect(before).toMatchObject({ text: "Kale's newer words, saved directly.", status: "open", approvals: ["Casey"], logged: ["proposal.created"], flagged: false });

    // The sentence can be followed: she checks it and saves it again, and then approves it on her own.
    await editProposal(
      casey,
      id,
      { kind: "decision", sectionId, title: "About Wages", proposedOfficial: doc("What Casey proposes for Wages.") },
      { currentVersionId: await currentId(sectionId) },
    );
    await approveAlone(casey, id, await pageOpenedNow(id));
    expect(await view(id)).toMatchObject({ status: "approved", decidedAlone: true });
    expect(await officialText(sectionId)).toBe("What Casey proposes for Wages.");
  });

  it("once they can only withdraw it: they read the withdraw sentence of their own page", async () => {
    // Karen endorsed it before the official text changed, so Casey can no longer change it.
    const { sectionId, id, opened } = await proposedThenOfficialTextChanged("Hiring", { endorsedFirstBy: karen });
    const p = await view(id);
    expect(p).toMatchObject({ outOfDate: true, proposerCanChange: false, proposerCanWithdraw: true });
    const before = await record(sectionId, id);
    expect(await answer(approveAlone(casey, id, opened))).toBe(CANNOT_CHANGE_IT);
    // It is the sentence her page shows her once she has reloaded it.
    expect(blockedNotice(p, await owners(), casey.id)).toBe(CANNOT_CHANGE_IT);
    expect(await record(sectionId, id)).toEqual(before);
    expect(before).toMatchObject({ status: "open", approvals: ["Casey"], endorsements: ["Karen"], flagged: false });
  });
});

describe("Approve, pressed by the other Owner on a page opened before the official text changed", () => {
  it("he reads that its proposer needs to check it, not 'reload, then approve'", async () => {
    const { sectionId, id, opened } = await proposedThenOfficialTextChanged("Training");
    const before = await record(sectionId, id);
    expect(await answer(approveProposal(kale, id, opened))).toBe(sinceProposed("Casey"));
    expect(await record(sectionId, id)).toEqual(before);
    expect(before).toMatchObject({ text: "Kale's newer words, saved directly.", status: "open", approvals: ["Casey"], logged: ["proposal.created"] });
  });

  it("and that it has to be declined, once its proposer can no longer change it", async () => {
    const { sectionId, id, opened } = await proposedThenOfficialTextChanged("Store Hours", { endorsedFirstBy: karen });
    const before = await record(sectionId, id);
    expect(await answer(approveProposal(kale, id, opened))).toBe(CANNOT_BE_CHECKED);
    expect(await record(sectionId, id)).toEqual(before);
    expect(before).toMatchObject({ status: "open", approvals: ["Casey"], endorsements: ["Karen"] });
  });
});

describe("Endorse, pressed on a page opened before the official text changed", () => {
  it("an Advisor and an Owner read when it can be endorsed, not 'reload, then endorse'", async () => {
    const sectionId = await section("Annuals");
    await saveOfficial(kale, sectionId, doc("The text before anyone proposed anything."));
    const id = await createProposal(casey, { kind: "decision", sectionId, title: "About Annuals", proposedOfficial: doc("What Casey proposes for Annuals.") });
    const opened = await pageOpenedNow(id);
    expect([canEndorse(await view(id), karen), canEndorse(await view(id), kale)]).toEqual([true, true]);
    await saveOfficial(kale, sectionId, doc("Kale's newer words, saved directly."));
    expect([canEndorse(await view(id), karen), canEndorse(await view(id), kale)]).toEqual([false, false]);
    const before = await record(sectionId, id);
    for (const who of [karen, kale]) {
      const said = await answer(endorseProposal(who, id, opened));
      expect(said).toBe(ENDORSE_ONCE_CHECKED("Casey"));
      expect(said).not.toMatch(/reload/i);
    }
    expect(await record(sectionId, id)).toEqual(before);
    expect(before).toMatchObject({ endorsements: [], logged: ["proposal.created"] });
  });

  it("and that it cannot be endorsed at all, once nobody can bring it up to date", async () => {
    const { sectionId, id, opened } = await proposedThenOfficialTextChanged("Perennials", { endorsedFirstBy: karen });
    const before = await record(sectionId, id);
    expect(await answer(endorseProposal(kale, id, opened))).toBe(NEVER_ENDORSED);
    expect(await record(sectionId, id)).toEqual(before);
    expect(before).toMatchObject({ endorsements: ["Karen"] });
  });
});

describe("the two other things that can stand in the way are said the same way from such a page", () => {
  it("the official text now says exactly what it proposes: there is nothing to approve or endorse", async () => {
    // Kale saved, word for word, what Casey had proposed.
    const { sectionId, id, opened } = await proposedThenOfficialTextChanged("Signage", { newOfficial: "What Casey proposes for Signage." });
    const p = await view(id);
    expect(p).toMatchObject({ sameAsOfficial: true, outOfDate: true });
    const before = await record(sectionId, id);
    // (Not "Kale needs to check it and save it again": that save would be refused.)
    expect(await answer(approveProposal(kale, id, opened))).toBe(`${NOTHING_TO_APPROVE} Decline it.`);
    expect(await answer(approveAlone(casey, id, opened))).toBe(`${NOTHING_TO_APPROVE} Withdraw it.`);
    expect(await answer(endorseProposal(karen, id, opened))).toBe(NOTHING_TO_ENDORSE);
    expect(await record(sectionId, id)).toEqual(before);
    expect(before).toMatchObject({ versions: 2, status: "open", approvals: ["Casey"], endorsements: [] });
  });

  it("its section was archived as well: it can only be withdrawn or declined, and nobody is told to check it first", async () => {
    const { sectionId, id, opened } = await proposedThenOfficialTextChanged("Budget");
    await archiveSection(kale, sectionId);
    const p = await view(id);
    expect(p).toMatchObject({ sectionGone: true, outOfDate: true });
    expect([casey, kale].map((who) => waitingText(p, [casey, kale], who.id))).toEqual([
      "Its section has been archived. Withdraw it.",
      "Its section has been archived. Decline it.",
    ]);
    const before = await record(sectionId, id);
    expect(await answer(approveProposal(kale, id, opened))).toBe(SECTION_GONE);
    // (Not "Check your proposal against the new text and save it again": that save is refused for an archived section.)
    expect(await answer(approveAlone(casey, id, opened))).toBe(SECTION_GONE);
    expect(await answer(approveAlone(casey, id, { revision: 1 }))).toBe(SECTION_GONE);
    expect(await answer(endorseProposal(karen, id, opened))).toBe("The section this proposal is about has been archived, so it can no longer be endorsed.");
    expect(await record(sectionId, id)).toEqual(before);
    expect(before).toMatchObject({ status: "open", approvals: ["Casey"], endorsements: [] });
  });
});

describe("what stays as it was", () => {
  it("the proposal itself was changed since the page was opened: that is still said first", async () => {
    // Her edit is saved from an edit page that showed the official text of that moment, so the
    // proposal is up to date again; then the official text changes once more.
    const { sectionId, id, opened } = await proposedThenOfficialTextChanged("Quotes");
    await editProposal(
      casey,
      id,
      { kind: "decision", sectionId, title: "About Quotes", proposedOfficial: doc("What Casey proposes for Quotes, reworded.") },
      { currentVersionId: await currentId(sectionId) },
    );
    await saveOfficial(kale, sectionId, doc("Kale's third wording."));
    expect(await view(id)).toMatchObject({ revision: 2, outOfDate: true });
    const before = await record(sectionId, id);
    expect(await answer(approveProposal(kale, id, opened))).toBe("Casey changed this proposal after you opened it. Reload the page and read it again, then approve.");
    expect(await answer(endorseProposal(karen, id, opened))).toBe("Casey changed this proposal after you opened it. Reload the page and read it again, then endorse.");
    expect(await record(sectionId, id)).toEqual(before);
  });

  it("the older check is still in place behind the others: a press that names official text other than the newest is refused", async () => {
    // No real page can send this for a proposal that is up to date and unchanged: the version a
    // page shows is the newest of its moment, and any newer one makes the proposal out of date.
    // The check stays for whatever does not come from a page of the app.
    const sectionId = await section("Payments Log");
    await saveOfficial(kale, sectionId, doc("The first text."));
    const first = (await currentId(sectionId)) as string;
    await saveOfficial(kale, sectionId, doc("The second text."));
    const id = await createProposal(casey, { kind: "decision", sectionId, title: "About the payments log", proposedOfficial: doc("What Casey proposes.") });
    expect(await view(id)).toMatchObject({ outOfDate: false, revision: 1 });
    const before = await record(sectionId, id);
    for (const named of [first, null, "00000000-0000-4000-8000-000000000000"]) {
      expect(await answer(approveProposal(kale, id, { revision: 1, currentVersionId: named }))).toBe(RELOAD_THEN_APPROVE);
      expect(await answer(approveAlone(casey, id, { revision: 1, currentVersionId: named }))).toBe(RELOAD_THEN_APPROVE);
    }
    expect(await record(sectionId, id)).toEqual(before);
    // With the newest version named, as a page would, both presses are taken.
    expect(await approveProposal(kale, id, await pageOpenedNow(id))).toEqual({ approved: true, waitingFor: [] });
    expect(await officialText(sectionId)).toBe("What Casey proposes.");
  });
});
