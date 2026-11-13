import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { asSystem } from "@/db/client";
import { sections } from "@/db/schema";
import { listVersions, restoreVersion, saveOfficial } from "@/lib/official";
import {
  type OneOwnerGroup,
  type ProposalView,
  addApproval,
  approveAlone,
  createProposal,
  displayTitle,
  groupOneOwnerDecisions,
  listOneOwnerDecisions,
} from "@/lib/proposals";
import type { RichDoc } from "@/lib/richtext";
import { loadTree } from "@/lib/sections";
import { actorFor, withTestDatabase } from "./helpers/db";

withTestDatabase();

/**
 * One-person decisions, put together for Today: one entry per section for
 * changes to official text (the newest on top, the earlier ones under it),
 * and every change still there to be seen and approved.
 */

const doc = (text: string): RichDoc => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
async function sectionId(title: string): Promise<string> {
  const [row] = await asSystem((db) => db.select().from(sections).where(eq(sections.title, title)));
  return row.id;
}
const at = (time: string) => new Date(`2026-11-10T${time}Z`);

/** A one-person decision as `listOneOwnerDecisions` would hand it back. */
function decided(id: string, more: Partial<ProposalView>): ProposalView {
  return {
    id,
    type: "official_text",
    title: "Edited directly",
    description: null,
    sectionId: "wages",
    sectionTitle: "Wages",
    destinationTitle: null,
    businessTag: null,
    proposedOfficial: null,
    baseVersionId: null,
    structureChange: null,
    createdSectionId: null,
    decidedTitle: null,
    direct: true,
    proposedById: "kale",
    proposedByName: "Kale",
    revision: 1,
    status: "approved",
    createdAt: at("15:00:00"),
    decidedAt: at("15:00:00"),
    decidedById: "kale",
    decidedByName: "Kale",
    declineReason: null,
    approvals: [],
    endorsements: [],
    resultVersion: null,
    decidedAlone: true,
    soloOpen: true,
    superseded: false,
    outOfDate: false,
    proposerCanChange: false,
    ...more,
  };
}
const ids = (groups: OneOwnerGroup[]) => groups.map((group) => [group.head.id, group.earlier.map((view) => view.id)]);

describe("grouping one-person decisions", () => {
  const version = (n: number) => ({ id: `v${n}`, version: n });
  const wages1 = decided("wages-1", { decidedAt: at("15:00:00"), resultVersion: version(1) });
  const wages2 = decided("wages-2", { decidedAt: at("15:05:00"), resultVersion: version(2) });
  const wages3 = decided("wages-3", { decidedAt: at("16:00:00"), resultVersion: version(3) });
  const hiring1 = decided("hiring-1", { sectionId: "hiring", decidedAt: at("15:30:00"), resultVersion: version(1) });
  const written = decided("hiring-2", { sectionId: "hiring", direct: false, type: "decision", title: "Hire in March", decidedAt: at("17:00:00"), resultVersion: version(2) });
  const rename = decided("rename", { type: "structure", direct: false, structureChange: { action: "rename", title: "Pay", fromTitle: "Wages" }, decidedAt: at("15:45:00") });
  const archive = decided("archive", { type: "structure", direct: false, structureChange: { action: "archive" }, decidedAt: at("18:00:00") });
  const addTop = decided("add-top", { type: "structure", direct: false, sectionId: null, structureChange: { action: "add", title: "Safety" }, decidedAt: at("14:00:00") });

  it("puts the text changes of one section together, newest on top, the earlier ones newest first", () => {
    expect(ids(groupOneOwnerDecisions([wages3, wages2, wages1]))).toEqual([["wages-3", ["wages-2", "wages-1"]]]);
    expect(ids(groupOneOwnerDecisions([wages1]))).toEqual([["wages-1", []]]);
    expect(groupOneOwnerDecisions([])).toEqual([]);
    // A written proposal approved by one person is a text change of its section like a direct edit.
    expect(ids(groupOneOwnerDecisions([written, hiring1]))).toEqual([["hiring-2", ["hiring-1"]]]);
    // The newest change is the newest one still on the list: here version 3 has been approved by the other Owner since.
    expect(ids(groupOneOwnerDecisions([wages2, wages1]))).toEqual([["wages-2", ["wages-1"]]]);
  });

  it("keeps sections apart, and every section change on its own, newest group first", () => {
    const all = [archive, written, wages3, rename, hiring1, wages2, wages1, addTop];
    const expected = [
      ["archive", []],
      ["hiring-2", ["hiring-1"]],
      ["wages-3", ["wages-2", "wages-1"]],
      // Two section changes about the same section (Wages) are never folded into one another, or into its text changes.
      ["rename", []],
      ["add-top", []],
    ];
    expect(ids(groupOneOwnerDecisions(all))).toEqual(expected);
    // Whatever order they come in.
    expect(ids(groupOneOwnerDecisions([...all].reverse()))).toEqual(expected);
    expect(ids(groupOneOwnerDecisions([wages1, addTop, hiring1, wages3, archive, rename, wages2, written]))).toEqual(expected);
    // Nothing is left out and nothing is listed twice.
    const listed = groupOneOwnerDecisions(all).flatMap((group) => [group.head, ...group.earlier]);
    expect(listed).toHaveLength(all.length);
    expect(new Set(listed).size).toBe(all.length);
    // What was handed in is not reordered.
    expect(all[0]).toBe(archive);
    expect(all.at(-1)).toBe(addTop);
  });

  it("goes by the version when two saves of a section carry the same time", () => {
    const sameMoment = [1, 2, 3].map((n) => decided(`same-${n}`, { decidedAt: at("15:00:00"), resultVersion: version(n) }));
    expect(ids(groupOneOwnerDecisions(sameMoment))).toEqual([["same-3", ["same-2", "same-1"]]]);
    expect(ids(groupOneOwnerDecisions([sameMoment[1], sameMoment[2], sameMoment[0]]))).toEqual([["same-3", ["same-2", "same-1"]]]);
    // And by the time when there is no version to go by.
    const early = decided("early", { decidedAt: at("09:00:00") });
    const late = decided("late", { decidedAt: at("21:00:00") });
    expect(ids(groupOneOwnerDecisions([early, late]))).toEqual([["late", ["early"]]]);
  });
});

describe("one-person decisions from the real records", () => {
  it("a section saved three times and restored is one entry, and every change can still be approved", async () => {
    const kale = await actorFor("kale@example.com");
    const casey = await actorFor("casey@example.com");
    const benefits = await sectionId("Benefits");
    const hiring = await sectionId("Hiring");
    const people = await sectionId("People");
    const day = (time: string) => ({ now: new Date(`2026-11-10T${time}Z`) });
    const today = new Date("2026-11-11T18:00:00Z");

    await saveOfficial(kale, benefits, doc("Health after 90 days."), day("15:00:00"));
    await saveOfficial(kale, hiring, doc("Hire in April."), day("15:10:00"));
    await saveOfficial(kale, benefits, doc("Health after 60 days."), day("15:20:00"));
    const uniforms = await createProposal(kale, { kind: "structure", change: { action: "add", parentId: people, title: "Uniforms" } }, day("15:30:00"));
    await approveAlone(kale, uniforms, { revision: 1 }, day("15:30:00"));
    await saveOfficial(kale, benefits, doc("Health after 60 days. Dental too."), day("15:40:00"));
    const versions = await asSystem((db) => listVersions(db, benefits));
    await restoreVersion(kale, benefits, versions.at(-1)!.id, { currentVersionId: versions[0].id, ...day("15:50:00") });

    const grouped = async () =>
      asSystem(async (db) => {
        const tree = await loadTree(db);
        const flagged = await listOneOwnerDecisions(db, today);
        return {
          count: flagged.length,
          groups: groupOneOwnerDecisions(flagged).map((group) => [
            displayTitle(group.head, tree),
            group.earlier.map((view) => displayTitle(view, tree)),
          ]),
          flagged,
        };
      });
    let now = await grouped();
    // Six changes, three entries.
    expect(now.count).toBe(6);
    expect(now.groups).toEqual([
      [
        "Restored version 1: 2.2 Benefits (as version 4)",
        ["Edited directly: 2.2 Benefits (version 3)", "Edited directly: 2.2 Benefits (version 2)", "Edited directly: 2.2 Benefits (version 1)"],
      ],
      ['Add a section "Uniforms" under 2 People', []],
      ["Edited directly: 2.3 Hiring (version 1)", []],
    ]);

    // Casey approves the newest Benefits text too. The earlier ones stay
    // (each is a change she has not approved), now under the newest of them.
    const newest = groupOneOwnerDecisions(now.flagged)[0].head;
    await addApproval(casey, newest.id);
    now = await grouped();
    expect(now.count).toBe(5);
    // (The entry goes by its newest change, saved at 3:40, so it still comes before the new section.)
    expect(now.groups).toEqual([
      ["Edited directly: 2.2 Benefits (version 3)", ["Edited directly: 2.2 Benefits (version 2)", "Edited directly: 2.2 Benefits (version 1)"]],
      ['Add a section "Uniforms" under 2 People', []],
      ["Edited directly: 2.3 Hiring (version 1)", []],
    ]);
    // Approving one from the middle takes just that one out.
    const middle = groupOneOwnerDecisions(now.flagged).find((group) => group.earlier.length === 2)!.earlier[0];
    await addApproval(casey, middle.id);
    now = await grouped();
    expect(now.groups).toEqual([
      ["Edited directly: 2.2 Benefits (version 3)", ["Edited directly: 2.2 Benefits (version 1)"]],
      ['Add a section "Uniforms" under 2 People', []],
      ["Edited directly: 2.3 Hiring (version 1)", []],
    ]);
    expect(now.count).toBe(4);
    // With the newest of them approved as well, the entry goes by the one that is left, from 3:00.
    await addApproval(casey, groupOneOwnerDecisions(now.flagged)[0].head.id);
    now = await grouped();
    expect(now.groups).toEqual([
      ['Add a section "Uniforms" under 2 People', []],
      ["Edited directly: 2.3 Hiring (version 1)", []],
      ["Edited directly: 2.2 Benefits (version 1)", []],
    ]);
  });
});
