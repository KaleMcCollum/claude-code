import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { asSystem } from "@/db/client";
import { activityLog, sections } from "@/db/schema";
import { AppError } from "@/lib/permissions";
import {
  type SectionNode,
  archiveSection,
  buildTree,
  createSection,
  flattenTree,
  listArchivedSections,
  loadTree,
  moveProblem,
  moveSection,
  moveSectionTo,
  renameSection,
  reorderSections,
  restoreSection,
} from "@/lib/sections";
import { actorFor, insertUser, withTestDatabase } from "./helpers/db";

withTestDatabase();

const tree = () => asSystem((db) => loadTree(db));
const labels = (nodes: SectionNode[]) => nodes.map((n) => `${n.number} ${n.title}`);
const byTitle = async (title: string) => {
  const node = flattenTree(await tree()).find((n) => n.title === title);
  if (!node) throw new Error(`No section called ${title}`);
  return node;
};

describe("starting sections", () => {
  it("match the build spec, numbered in order", async () => {
    const top = await tree();
    expect(labels(top)).toEqual([
      "1 Company Overview",
      "2 People",
      "3 Hours and Daily Operations",
      "4 Departments",
      "5 Facility and Buildout",
      "6 Equipment and Technology",
      "7 Vendors and Purchasing",
      "8 Finance",
      "9 Marketing and Events",
      "10 Opening Timeline",
    ]);
    expect(labels(top[1].children)).toEqual([
      "2.1 Wages",
      "2.2 Benefits",
      "2.3 Hiring",
      "2.4 Training",
      "2.5 Policies and Expectations",
    ]);
    expect(labels(top[3].children).at(-1)).toBe("4.7 Coffee Shop");
    expect(top[8].children).toEqual([]);
  });
});

describe("numbering", () => {
  it("is worked out from order alone and skips archived sections", () => {
    const at = new Date();
    const row = (id: string, parentId: string | null, position: number, archived = false) => ({
      id,
      parentId,
      title: id,
      position,
      archivedAt: archived ? at : null,
      createdAt: at,
      updatedAt: at,
      updatedBy: null,
    });
    const built = buildTree([
      row("b", null, 2),
      row("a", null, 1),
      row("hidden", null, 3, true),
      row("under-hidden", "hidden", 1),
      row("c", null, 4),
      row("a2", "a", 2),
      row("a1", "a", 1),
      row("a1x", "a1", 1),
    ]);
    expect(labels(flattenTree(built))).toEqual(["1 a", "1.1 a1", "1.1.1 a1x", "1.2 a2", "2 b", "3 c"]);
  });
});

describe("Owners changing the structure", () => {
  it("adds a section at the end with the next number", async () => {
    const kale = await actorFor("kale@example.com");
    await createSection(kale, { parentId: null, title: "  Seasonal   Plans " });
    expect(labels(await tree()).at(-1)).toBe("11 Seasonal Plans");
    const people = await byTitle("People");
    await createSection(kale, { parentId: people.id, title: "Reviews" });
    expect((await byTitle("Reviews")).number).toBe("2.6");
  });

  it("supports a third level but not a fourth", async () => {
    const kale = await actorFor("kale@example.com");
    const wages = await byTitle("Wages");
    await createSection(kale, { parentId: wages.id, title: "Seasonal Staff" });
    const third = await byTitle("Seasonal Staff");
    expect(third.number).toBe("2.1.1");
    await expect(createSection(kale, { parentId: third.id, title: "Too Deep" })).rejects.toThrow(AppError);
  });

  it("rejects empty and overlong names", async () => {
    const kale = await actorFor("kale@example.com");
    await expect(createSection(kale, { parentId: null, title: "   " })).rejects.toThrow(AppError);
    await expect(createSection(kale, { parentId: null, title: "x".repeat(121) })).rejects.toThrow(AppError);
  });

  it("renames a section and records who and when", async () => {
    const casey = await actorFor("casey@example.com");
    const before = await byTitle("Benefits");
    await renameSection(casey, before.id, "Benefits and Perks");
    const after = await byTitle("Benefits and Perks");
    expect(after.id).toBe(before.id);
    expect(after.updatedBy).toBe(casey.id);
    expect(after.updatedAt.getTime()).toBeGreaterThanOrEqual(before.updatedAt.getTime());
    const log = await asSystem((db) => db.select().from(activityLog).where(eq(activityLog.entityId, before.id)));
    expect(log.map((entry) => entry.summary)).toContain('Renamed section "Benefits" to "Benefits and Perks"');
    expect(log.every((entry) => entry.userId === casey.id)).toBe(true);
  });

  it("moves a section up or down and renumbers its neighbours", async () => {
    const kale = await actorFor("kale@example.com");
    const finance = await byTitle("Finance");
    await moveSection(kale, finance.id, "up");
    expect((await byTitle("Finance")).number).toBe("7");
    expect((await byTitle("Vendors and Purchasing")).number).toBe("8");
    await moveSection(kale, finance.id, "down");
    expect((await byTitle("Finance")).number).toBe("8");
    // Already first: nothing happens.
    const first = (await tree())[0];
    await moveSection(kale, first.id, "up");
    expect((await tree())[0].id).toBe(first.id);
  });

  it("reorders a whole group at once (drag and drop)", async () => {
    const kale = await actorFor("kale@example.com");
    const hours = await byTitle("Hours and Daily Operations");
    const ids = hours.children.map((c) => c.id);
    const before = hours.children.map((c) => c.updatedAt.getTime());
    await reorderSections(kale, hours.id, [...ids].reverse());
    const after = await byTitle("Hours and Daily Operations");
    expect(labels(after.children)).toEqual([
      "3.1 Scheduling",
      "3.2 Closing Procedures",
      "3.3 Opening Procedures",
      "3.4 Store Hours",
    ]);
    // Changing the order is not a content change.
    expect(after.children.map((c) => c.updatedAt.getTime()).sort()).toEqual([...before].sort());
    await reorderSections(kale, hours.id, ids);
  });

  it("refuses a reorder that does not match the current sections", async () => {
    const kale = await actorFor("kale@example.com");
    const hours = await byTitle("Hours and Daily Operations");
    const ids = hours.children.map((c) => c.id);
    await expect(reorderSections(kale, hours.id, ids.slice(1))).rejects.toThrow(AppError);
    await expect(reorderSections(kale, hours.id, [ids[0], ids[0], ids[1], ids[2]])).rejects.toThrow(AppError);
    const wages = await byTitle("Wages");
    await expect(reorderSections(kale, hours.id, [...ids.slice(1), wages.id])).rejects.toThrow(AppError);
  });

  it("archives a section with everything under it, and restores it", async () => {
    const kale = await actorFor("kale@example.com");
    const departments = await byTitle("Departments");
    await archiveSection(kale, departments.id);

    const titles = flattenTree(await tree()).map((n) => n.title);
    expect(titles).not.toContain("Departments");
    expect(titles).not.toContain("Coffee Shop");
    expect((await byTitle("Facility and Buildout")).number).toBe("4");

    // Nothing was deleted.
    const rows = await asSystem((db) => db.select().from(sections).where(eq(sections.parentId, departments.id)));
    expect(rows).toHaveLength(7);
    const archived = await asSystem((db) => listArchivedSections(db));
    expect(archived.map((a) => a.title)).toContain("Departments");
    expect(archived.find((a) => a.title === "Departments")?.archivedByName).toBe("Kale");

    await restoreSection(kale, departments.id);
    const restored = await byTitle("Departments");
    expect(restored.children).toHaveLength(7);
    // Restored sections come back at the end of their group.
    expect(restored.number).toBe(String((await tree()).length));
  });
});

describe("moving a section somewhere else", () => {
  it("takes everything under it along and goes to the end of the new group", async () => {
    const kale = await actorFor("kale@example.com");
    const training = await byTitle("Training");
    await createSection(kale, { parentId: training.id, title: "Barista Training" });
    const before = await byTitle("Training");
    const finance = await byTitle("Finance");

    await moveSectionTo(kale, training.id, finance.id);
    let moved = await byTitle("Training");
    expect(moved.parentId).toBe(finance.id);
    expect(moved.number).toBe(`${finance.number}.4`);
    expect((await byTitle("Barista Training")).number).toBe(`${finance.number}.4.1`);
    // The group it left closes up.
    expect((await byTitle("People")).children.map((n) => n.title)).not.toContain("Training");
    expect((await byTitle("Policies and Expectations")).number).toBe("2.4");
    // Like reordering, moving is not a content update (it does not reset "stale").
    expect(moved.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    const log = await asSystem((db) => db.select().from(activityLog).where(eq(activityLog.action, "section.moved")));
    expect(log.at(-1)?.summary).toBe(`Moved section 2.4 Training under ${finance.number} Finance`);

    // To the top level, then back under People (at the end).
    await moveSectionTo(kale, training.id, null);
    moved = await byTitle("Training");
    expect(moved.parentId).toBeNull();
    expect(moved.number).toBe(String((await tree()).length));
    expect((await byTitle("Barista Training")).number).toBe(`${moved.number}.1`);
    const people = await byTitle("People");
    await moveSectionTo(kale, training.id, people.id);
    expect((await byTitle("Training")).number).toBe(`2.${people.children.length + 1}`);
  });

  it("refuses moves that make no sense", async () => {
    const kale = await actorFor("kale@example.com");
    const people = await byTitle("People");
    const wages = await byTitle("Wages");
    const seasonal = await byTitle("Seasonal Staff");
    const finance = await byTitle("Finance");
    const budget = await byTitle("Budget");
    const marketing = await byTitle("Marketing and Events");
    const refuse = (id: string, parentId: string | null, why: RegExp) =>
      expect(moveSectionTo(kale, id, parentId)).rejects.toThrow(why);

    await refuse(wages.id, people.id, /already there/);
    await refuse(people.id, null, /already there/);
    await refuse(wages.id, wages.id, /under itself/);
    await refuse(wages.id, seasonal.id, /under itself or under one of its own subsections/);
    await refuse(people.id, seasonal.id, /under itself/);
    // People has three levels in it, Finance has two: neither fits a level down.
    await refuse(people.id, finance.id, /more than three levels/);
    await refuse(finance.id, budget.id, /under itself/);
    await refuse(finance.id, wages.id, /more than three levels/);
    await refuse(marketing.id, seasonal.id, /more than three levels/);
    await refuse(marketing.id, "00000000-0000-4000-8000-000000000000", /no longer exists/);
    await refuse("00000000-0000-4000-8000-000000000000", null, AppError as unknown as RegExp);

    // An archived section is not there to move, or to move under.
    const quotes = await byTitle("Quotes");
    await archiveSection(kale, quotes.id);
    await refuse(quotes.id, null, AppError as unknown as RegExp);
    await refuse(marketing.id, quotes.id, /no longer exists/);
    await restoreSection(kale, quotes.id);

    // The same check, without doing anything: null means the move is fine.
    const now = await tree();
    expect(moveProblem(now, marketing.id, wages.id)).toBeNull();
    expect(moveProblem(now, marketing.id, finance.id)).toBeNull();
    expect(moveProblem(now, wages.id, null)).toBeNull();
    expect(moveProblem(now, wages.id, people.id)).toBe("That section is already there.");
    expect((await byTitle("Wages")).number).toBe("2.1");
    expect((await byTitle("Marketing and Events")).parentId).toBeNull();
  });
});

describe("Advisors", () => {
  it("cannot change the structure", async () => {
    const karen = await insertUser("Karen", "karen@example.com", "advisor");
    const wages = await byTitle("Wages");
    await expect(createSection(karen, { parentId: null, title: "Nope" })).rejects.toThrow(AppError);
    await expect(renameSection(karen, wages.id, "Nope")).rejects.toThrow(AppError);
    await expect(moveSection(karen, wages.id, "down")).rejects.toThrow(AppError);
    await expect(moveSectionTo(karen, wages.id, null)).rejects.toThrow(AppError);
    await expect(archiveSection(karen, wages.id)).rejects.toThrow(AppError);
    await expect(restoreSection(karen, wages.id)).rejects.toThrow(AppError);
    expect((await byTitle("Wages")).number).toBe("2.1");
  });
});
