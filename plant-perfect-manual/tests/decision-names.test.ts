import { asc, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { asSystem } from "@/db/client";
import { activityLog, officialVersions, sections } from "@/db/schema";
import { DIRECT_EDIT_TITLE, listVersions, loadOfficial, restoreVersion, restoredTitle, saveOfficial } from "@/lib/official";
import type { Actor } from "@/lib/permissions";
import {
  type ProposalView,
  addApproval,
  addProposalComment,
  approveAlone,
  approveProposal,
  createProposal,
  describeStructure,
  displayTitle,
  endorseProposal,
  listDecisions,
  listOneOwnerDecisions,
  listOpenProposals,
  loadProposal,
  sectionText,
  storedSectionNames,
} from "@/lib/proposals";
import type { RichDoc } from "@/lib/richtext";
import { archiveSection, createSection, flattenTree, loadTree, restoreSection } from "@/lib/sections";
import { actorFor, insertUser, withTestDatabase } from "./helpers/db";

withTestDatabase();

/**
 * How decisions are named in lists and in the activity log: a direct edit by
 * its section and version, and a section that has since been archived by the
 * name it had ("Hiring (archived)"); and that the Decisions Log's section
 * filter still finds decisions about archived subsections.
 */

const doc = (...paragraphs: string[]): RichDoc => ({
  type: "doc",
  content: paragraphs.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })),
});
const tree = () => asSystem((db) => loadTree(db));
/** By stored name, so it also finds an archived section. */
async function sectionId(title: string): Promise<string> {
  const [row] = await asSystem((db) => db.select().from(sections).where(eq(sections.title, title)));
  if (!row) throw new Error(`No section called ${title}`);
  return row.id;
}
/** "2.3 Hiring": a section's number and name as they are right now. (Restoring a section puts it last in its group, so numbers move during these tests.) */
async function numbered(title: string): Promise<string> {
  const node = flattenTree(await tree()).find((n) => n.title === title);
  if (!node) throw new Error(`${title} is not among the sections`);
  return `${node.number} ${node.title}`;
}
const view = async (id: string) => (await asSystem((db) => loadProposal(db, id))) as ProposalView;
const shown = async (id: string) => displayTitle(await view(id), await tree());
const decisions = (filters: Parameters<typeof listDecisions>[2] = {}) =>
  asSystem(async (db) => {
    const now = await loadTree(db);
    return (await listDecisions(db, now, filters)).map((decision) => displayTitle(decision, now));
  });
/** The proposal behind each version of a section, oldest first. */
const proposalsBehind = async (section: string) =>
  (await asSystem((db) => db.select().from(officialVersions).where(eq(officialVersions.sectionId, section)).orderBy(asc(officialVersions.version)))).map(
    (version) => version.proposalId,
  );
const logLines = async (proposalId: string) =>
  (await asSystem((db) => db.select().from(activityLog).where(eq(activityLog.entityId, proposalId)).orderBy(asc(activityLog.id)))).map((line) => line.summary);

let kale: Actor;
let casey: Actor;
let karen: Actor;

beforeAll(async () => {
  kale = await actorFor("kale@example.com");
  casey = await actorFor("casey@example.com");
  karen = await insertUser("Karen", "karen@example.com", "advisor");
});

describe("the title of a direct edit or a restore", () => {
  it("says which section and which version, so two saves of one section do not read the same", async () => {
    const benefits = await sectionId("Benefits");
    await saveOfficial(kale, benefits, doc("Health after 90 days."));
    await saveOfficial(kale, benefits, doc("Health after 60 days."));
    const versions = await asSystem((db) => listVersions(db, benefits));
    await restoreVersion(kale, benefits, versions.at(-1)!.id, { currentVersionId: versions[0].id });
    const [first, second, restore] = await proposalsBehind(benefits);

    expect(await shown(first)).toBe("Edited directly: 2.2 Benefits (version 1)");
    expect(await shown(second)).toBe("Edited directly: 2.2 Benefits (version 2)");
    expect(await shown(restore)).toBe("Restored version 1: 2.2 Benefits (as version 3)");
    // The stored titles are the app's own two, and are what tells them apart.
    expect((await view(first)).title).toBe(DIRECT_EDIT_TITLE);
    expect((await view(restore)).title).toBe(restoredTitle(1));
    expect(await view(second)).toMatchObject({ sectionTitle: "Benefits", destinationTitle: null, resultVersion: { version: 2 } });
    expect(await decisions({ sectionId: benefits })).toEqual([
      "Restored version 1: 2.2 Benefits (as version 3)",
      "Edited directly: 2.2 Benefits (version 2)",
      "Edited directly: 2.2 Benefits (version 1)",
    ]);
    // On Today's list of one-person changes as well.
    const flagged = await asSystem((db) => listOneOwnerDecisions(db));
    expect(flagged.filter((d) => d.sectionId === benefits).map((d) => displayTitle(d, [])).sort()).toEqual([
      "Edited directly: Benefits (archived) (version 1)",
      "Edited directly: Benefits (archived) (version 2)",
      "Restored version 1: Benefits (archived) (as version 3)",
    ]);
  });

  it("goes by the title the app gave it, and does without what it is not told", async () => {
    const now = await tree();
    const benefits = await sectionId("Benefits");
    const parts = { direct: true, sectionId: benefits, type: "official_text", status: "approved", structureChange: null } as const;
    const version = { id: "v", version: 7 };
    expect(displayTitle({ ...parts, title: DIRECT_EDIT_TITLE, resultVersion: version }, now)).toBe("Edited directly: 2.2 Benefits (version 7)");
    expect(displayTitle({ ...parts, title: restoredTitle(4), resultVersion: version }, now)).toBe("Restored version 4: 2.2 Benefits (as version 7)");
    // Without the version (older callers): as it always read.
    expect(displayTitle({ ...parts, title: DIRECT_EDIT_TITLE }, now)).toBe("Edited directly: 2.2 Benefits");
    expect(displayTitle({ ...parts, title: DIRECT_EDIT_TITLE, resultVersion: null }, now)).toBe("Edited directly: 2.2 Benefits");
    expect(displayTitle({ ...parts, title: restoredTitle(4) }, now)).toBe("Restored version 4: 2.2 Benefits");
    // Without the stored name, a section that is not among the sections cannot be named.
    expect(displayTitle({ ...parts, title: DIRECT_EDIT_TITLE, resultVersion: version }, [])).toBe(
      "Edited directly: a section that has been archived (version 7)",
    );
    expect(displayTitle({ ...parts, title: DIRECT_EDIT_TITLE, resultVersion: version, sectionTitle: "Benefits" }, [])).toBe(
      "Edited directly: Benefits (archived) (version 7)",
    );
    // A written proposal is never given a version, whatever its title.
    expect(displayTitle({ ...parts, direct: false, title: DIRECT_EDIT_TITLE, resultVersion: version }, now)).toBe("Edited directly");
  });
});

describe("a section that has been archived", () => {
  it("is still named on its decisions, and they stay in the filter of the section above it", async () => {
    const people = await sectionId("People");
    const wages = await sectionId("Wages");
    const hiring = await sectionId("Hiring");
    // A subsection of Hiring, to see that "everything under it" goes all the way down.
    const interviews = await createSection(kale, { parentId: hiring, title: "Interviews" });

    const wage = await createProposal(kale, { kind: "decision", sectionId: wages, title: "Coffee wages $15", proposedOfficial: doc("Coffee staff start at $15/hr.") });
    await approveProposal(casey, wage, { revision: 1, currentVersionId: null });
    const hire = await createProposal(kale, { kind: "decision", sectionId: hiring, title: "Hire in March", proposedOfficial: doc("Hire in March.") });
    await approveAlone(kale, hire, { revision: 1, currentVersionId: null });
    await saveOfficial(kale, hiring, doc("Hire in April."));
    await saveOfficial(casey, interviews, doc("Two interviews each."));
    const uniforms = await createProposal(kale, { kind: "structure", change: { action: "add", parentId: people, title: "Uniforms" } });
    await approveProposal(casey, uniforms, { revision: 1 });
    const archive = await createProposal(kale, { kind: "structure", change: { action: "archive", sectionId: hiring } });

    const aboutPeople = [
      'Add a section "Uniforms" under 2 People',
      "Edited directly: 2.3.1 Interviews (version 1)",
      "Edited directly: 2.3 Hiring (version 2)",
      "Hire in March",
      "Coffee wages $15",
      // (From the test above.)
      "Restored version 1: 2.2 Benefits (as version 3)",
      "Edited directly: 2.2 Benefits (version 2)",
      "Edited directly: 2.2 Benefits (version 1)",
    ];
    expect(await decisions({ sectionId: people })).toEqual(aboutPeople);
    expect(sectionText(await view(hire), await tree())).toBe("2.3 Hiring");

    // Hiring is archived, by an approved proposal.
    await approveProposal(casey, archive, { revision: 1 });
    const [, direct] = await proposalsBehind(hiring);
    const [sub] = await proposalsBehind(interviews);
    expect(await shown(direct)).toBe("Edited directly: Hiring (archived) (version 2)");
    // Interviews was not archived itself, but it went with Hiring.
    expect(await shown(sub)).toBe("Edited directly: Interviews (archived) (version 1)");
    expect(await shown(hire)).toBe("Hire in March");
    expect(await shown(archive)).toBe("Archive 2.3 Hiring");
    const now = await tree();
    expect(sectionText(await view(hire), now)).toBe("Hiring (archived)");
    expect(sectionText(await view(direct), now)).toBe("Hiring (archived)");
    expect(sectionText(await view(sub), now)).toBe("Interviews (archived)");
    expect(sectionText(await view(archive), now)).toBe("Hiring (archived)");
    expect(sectionText(await view(wage), now)).toBe("2.1 Wages");
    // A proposal with no section of its own (a new top-level section) has no such line.
    const top = await createProposal(kale, { kind: "structure", change: { action: "add", parentId: null, title: "Safety" } });
    expect(sectionText(await view(top), now)).toBeNull();
    expect(await view(top)).toMatchObject({ sectionId: null, sectionTitle: null });
    // Without the stored name (a caller that does not pass it) it cannot be named.
    expect(sectionText({ sectionId: hiring }, now)).toBe("a section that has been archived");

    // Everything decided about Hiring is still in People's list, the decision to archive it too.
    const afterArchiving = [
      "Archive 2.3 Hiring",
      'Add a section "Uniforms" under 2 People',
      "Edited directly: Interviews (archived) (version 1)",
      "Edited directly: Hiring (archived) (version 2)",
      "Hire in March",
      "Coffee wages $15",
      "Restored version 1: 2.2 Benefits (as version 3)",
      "Edited directly: 2.2 Benefits (version 2)",
      "Edited directly: 2.2 Benefits (version 1)",
    ];
    expect(await decisions({ sectionId: people })).toEqual(afterArchiving);
    // The archived section can be asked for itself: it and what is under it.
    expect(await decisions({ sectionId: hiring })).toEqual([
      "Archive 2.3 Hiring",
      "Edited directly: Interviews (archived) (version 1)",
      "Edited directly: Hiring (archived) (version 2)",
      "Hire in March",
    ]);
    expect(await decisions({ sectionId: interviews })).toEqual(["Edited directly: Interviews (archived) (version 1)"]);
    // Other sections' lists are not widened.
    expect(await decisions({ sectionId: wages })).toEqual(["Coffee wages $15"]);
    expect(await decisions({ sectionId: await sectionId("Finance") })).toEqual([]);
    // A section that does not exist, or something that is not a section at all.
    expect(await decisions({ sectionId: "00000000-0000-4000-8000-000000000000" })).toEqual([]);
    expect(await decisions({ sectionId: "not-a-section" })).toEqual([]);
    // The other filters still narrow it.
    expect(await decisions({ sectionId: people, approverId: casey.id })).toEqual([
      "Archive 2.3 Hiring",
      'Add a section "Uniforms" under 2 People',
      "Edited directly: Interviews (archived) (version 1)",
      "Coffee wages $15",
    ]);

    // People itself is archived: its whole list is still there, under stored names.
    await archiveSection(kale, people);
    expect(await decisions({ sectionId: people })).toEqual([
      "Archive 2.3 Hiring",
      'Add a section "Uniforms" under 2 People',
      "Edited directly: Interviews (archived) (version 1)",
      "Edited directly: Hiring (archived) (version 2)",
      "Hire in March",
      "Coffee wages $15",
      "Restored version 1: Benefits (archived) (as version 3)",
      "Edited directly: Benefits (archived) (version 2)",
      "Edited directly: Benefits (archived) (version 1)",
    ]);
    expect(sectionText(await view(wage), await tree())).toBe("Wages (archived)");

    // It is only how they are shown: bring the sections back and the numbers are back.
    await restoreSection(kale, people);
    await restoreSection(kale, hiring);
    // (Restored sections come back last in their group: People is now 10, Hiring 10.6.)
    expect(await numbered("Interviews")).toBe("10.6.1 Interviews");
    expect(await decisions({ sectionId: hiring })).toEqual([
      "Archive 2.3 Hiring",
      "Edited directly: 10.6.1 Interviews (version 1)",
      "Edited directly: 10.6 Hiring (version 2)",
      "Hire in March",
    ]);
  });

  it("is named in an open proposal about it, about a section under it, or to move something under it", async () => {
    const training = await sectionId("Training");
    const facility = await sectionId("Facility and Buildout");
    const signage = await sectionId("Signage");
    const marketing = await sectionId("Marketing and Events");

    const rename = await createProposal(kale, { kind: "structure", change: { action: "rename", sectionId: signage, title: "Signs" } });
    const move = await createProposal(kale, { kind: "structure", change: { action: "move", sectionId: training, parentId: marketing } });
    const add = await createProposal(casey, { kind: "structure", change: { action: "add", parentId: signage, title: "Pylon sign" } });
    const text = await createProposal(casey, { kind: "decision", sectionId: signage, title: "One pylon sign", proposedOfficial: doc("One pylon sign by the road.") });
    expect(await shown(rename)).toBe(`Rename ${await numbered("Signage")} to "Signs"`);
    expect(await shown(move)).toBe(`Move ${await numbered("Training")} under ${await numbered("Marketing and Events")}`);
    expect(await numbered("Training")).toMatch(/^\d+\.\d Training$/);
    expect(await view(move)).toMatchObject({ sectionTitle: "Training", destinationTitle: "Marketing and Events" });
    expect(await view(rename)).toMatchObject({ sectionTitle: "Signage", destinationTitle: null });

    // The section above Signage is archived: Signage itself is not, but it is gone from the sections.
    await archiveSection(casey, facility);
    expect(await shown(rename)).toBe('Rename Signage (archived) to "Signs"');
    expect(await shown(add)).toBe('Add a section "Pylon sign" under Signage (archived)');
    expect(await shown(text)).toBe("One pylon sign");
    expect(sectionText(await view(text), await tree())).toBe("Signage (archived)");
    // Where it would go is archived.
    await archiveSection(casey, marketing);
    const trainingNow = await numbered("Training");
    expect(await shown(move)).toBe(`Move ${trainingNow} under Marketing and Events (archived)`);
    // The list of open proposals carries the same names.
    const open = await asSystem(async (db) => {
      const now = await loadTree(db);
      return (await listOpenProposals(db)).map((p) => displayTitle(p, now));
    });
    expect(open).toEqual(
      expect.arrayContaining([
        'Rename Signage (archived) to "Signs"',
        `Move ${trainingNow} under Marketing and Events (archived)`,
        'Add a section "Pylon sign" under Signage (archived)',
      ]),
    );
    // What it would move is archived as well.
    await archiveSection(casey, training);
    expect(await shown(move)).toBe("Move Training (archived) under Marketing and Events (archived)");

    // The sentence helper says the same when it is handed the stored names, and the old words when it is not.
    const now = await tree();
    const moving = await view(move);
    expect(describeStructure(now, moving.sectionId, moving.structureChange!, storedSectionNames(moving))).toBe(
      "Move Training (archived) under Marketing and Events (archived)",
    );
    expect(describeStructure(now, moving.sectionId, moving.structureChange!)).toBe(
      "Move a section that has been archived under a section that has been archived",
    );
    expect([...storedSectionNames(moving)]).toEqual([
      [training, "Training"],
      [marketing, "Marketing and Events"],
    ]);
    expect([...storedSectionNames(await view(rename))]).toEqual([[signage, "Signage"]]);
    // A name for the destination is only taken from a move.
    expect([...storedSectionNames({ sectionId: signage, sectionTitle: "Signage", destinationTitle: "Elsewhere", structureChange: { action: "archive" } })]).toEqual([
      [signage, "Signage"],
    ]);

    await restoreSection(kale, facility);
    await restoreSection(kale, marketing);
    await restoreSection(kale, training);
    expect(await shown(rename)).toBe(`Rename ${await numbered("Signage")} to "Signs"`);
  });
});

describe("Edit official and Restore on a section that is no longer among the sections", () => {
  it("are refused when the section above it was archived, as approving a proposal is", async () => {
    const hours = await sectionId("Store Hours");
    const daily = await sectionId("Hours and Daily Operations");
    await saveOfficial(kale, hours, doc("Open 9 to 6."));
    await saveOfficial(kale, hours, doc("Open 8 to 6."));
    const before = await asSystem((db) => listVersions(db, hours));
    expect(before.map((v) => v.version)).toEqual([2, 1]);
    const gone = "That section no longer exists. Reload the page and try again.";

    // Store Hours is not archived itself; the section above it is.
    await archiveSection(casey, daily);
    await expect(saveOfficial(kale, hours, doc("Open 7 to 6."), { baseVersionId: before[0].id })).rejects.toThrow(gone);
    await expect(saveOfficial(kale, hours, doc("Open 7 to 6."))).rejects.toThrow(gone);
    await expect(restoreVersion(kale, hours, before[1].id, { currentVersionId: before[0].id })).rejects.toThrow(gone);
    expect((await asSystem((db) => listVersions(db, hours))).map((v) => v.version)).toEqual([2, 1]);

    // Back among the sections: both work again.
    await restoreSection(casey, daily);
    await expect(saveOfficial(kale, hours, doc("Open 7 to 6."), { baseVersionId: before[0].id })).resolves.toEqual({ changed: true, version: 3 });
    const now = await asSystem((db) => listVersions(db, hours));
    await expect(restoreVersion(kale, hours, before[1].id, { currentVersionId: now[0].id })).resolves.toEqual({ version: 4 });

    // And a section archived itself, or one that never existed.
    await archiveSection(casey, hours);
    await expect(saveOfficial(kale, hours, doc("Open 6 to 6."))).rejects.toThrow(gone);
    await expect(restoreVersion(kale, hours, before[0].id, { currentVersionId: (await asSystem((db) => loadOfficial(db, hours)))!.id })).rejects.toThrow(gone);
    await expect(saveOfficial(kale, "00000000-0000-4000-8000-000000000000", doc("Nowhere."))).rejects.toThrow(gone);
    await restoreSection(casey, hours);
  });
});

describe("activity log lines about a direct edit or a restore", () => {
  it("say which section and version was approved, endorsed or commented on", async () => {
    const budget = await sectionId("Budget");
    await saveOfficial(kale, budget, doc("Signage budget: $9,000."));
    await saveOfficial(kale, budget, doc("Signage budget: $12,000."));
    const versions = await asSystem((db) => listVersions(db, budget));
    await restoreVersion(kale, budget, versions.at(-1)!.id, { currentVersionId: versions[0].id });
    const [first, second, restore] = await proposalsBehind(budget);
    // "7.1 Budget", or whatever its number is by now.
    const place = await numbered("Budget");
    expect(place).toMatch(/^\d+\.1 Budget$/);

    await addApproval(casey, second);
    await endorseProposal(karen, second, { revision: 1 });
    await addProposalComment(casey, second, doc("Why the jump?"));
    expect(await logLines(second)).toEqual([
      `Added their approval: Edited directly: ${place} (version 2)`,
      `Endorsed: Edited directly: ${place} (version 2)`,
      `Commented on the proposal: Edited directly: ${place} (version 2)`,
    ]);
    await addApproval(casey, restore);
    await endorseProposal(karen, restore, { revision: 1 });
    await addProposalComment(karen, restore, doc("Back to the first number."));
    expect(await logLines(restore)).toEqual([
      `Added their approval: Restored version 1: ${place} (as version 3)`,
      `Endorsed: Restored version 1: ${place} (as version 3)`,
      `Commented on the proposal: Restored version 1: ${place} (as version 3)`,
    ]);
    // The line reads as the lists do at that moment, also for a section that has been archived since.
    await archiveSection(kale, budget);
    await endorseProposal(karen, first, { revision: 1 });
    expect(await logLines(first)).toEqual(["Endorsed: Edited directly: Budget (archived) (version 1)"]);
    expect(await shown(first)).toBe("Edited directly: Budget (archived) (version 1)");
    await restoreSection(kale, budget);
  });

  it("go by the written title for a written proposal, as before", async () => {
    const quotes = await sectionId("Quotes");
    const id = await createProposal(kale, { kind: "decision", sectionId: quotes, title: "Go with Holly Lumber", proposedOfficial: doc("Signs: Holly Lumber.") });
    await endorseProposal(karen, id, { revision: 1 });
    await addProposalComment(karen, id, doc("Their quote was the lowest."));
    await approveAlone(kale, id, { revision: 1, currentVersionId: null });
    await addApproval(casey, id);
    expect(await logLines(id)).toEqual([
      "Proposed: Go with Holly Lumber",
      "Endorsed: Go with Holly Lumber",
      "Commented on the proposal: Go with Holly Lumber",
      "Approved by Kale: Go with Holly Lumber",
      "Added their approval: Go with Holly Lumber",
    ]);
  });
});

describe("dates the pages hand to the database", () => {
  it("the first and last day a date in an address can name are days the database knows", async () => {
    // `isDateKey` lets these two through; the year 0000, which the database
    // refuses, it does not (tests/time.test.ts).
    expect(await decisions({ from: "0001-01-01", to: "9999-12-31" })).not.toEqual([]);
    expect(await decisions({ from: "9999-12-31" })).toEqual([]);
    expect(await decisions({ to: "0001-01-01" })).toEqual([]);
    await expect(decisions({ from: "0000-01-01" })).rejects.toThrow();
  });
});
