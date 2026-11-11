import { describe, expect, it } from "vitest";
import { listActivity } from "@/lib/activity";
import { addNote } from "@/lib/notes";
import { AppError } from "@/lib/permissions";
import { createSection, renameSection } from "@/lib/sections";
import { actorFor, insertUser, withTestDatabase } from "./helpers/db";

withTestDatabase();

const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

describe("the activity list in Settings", () => {
  it("shows who did what, newest first", async () => {
    const kale = await actorFor("kale@example.com");
    const casey = await actorFor("casey@example.com");
    await createSection(kale, { parentId: null, title: "Seasonal Plans" });
    const tree = await createSection(casey, { parentId: null, title: "Holiday Trees" });
    await renameSection(casey, tree, "Christmas Trees");

    const { rows, more } = await listActivity(kale);
    expect(more).toBe(false);
    expect(rows.slice(0, 3).map((row) => [row.userName, row.summary])).toEqual([
      ["Casey", 'Renamed section "Holiday Trees" to "Christmas Trees"'],
      ["Casey", 'Added section "Holiday Trees"'],
      ["Kale", 'Added section "Seasonal Plans"'],
    ]);
    expect(rows[0].at).toBeInstanceOf(Date);
  });

  it("comes a page at a time", async () => {
    const kale = await actorFor("kale@example.com");
    for (let i = 0; i < 7; i += 1) await addNote(kale, { body: doc(`note ${i}`) });

    const first = await listActivity(kale, { limit: 3 });
    expect(first.rows).toHaveLength(3);
    expect(first.more).toBe(true);
    const second = await listActivity(kale, { limit: 3, before: first.rows.at(-1)!.id });
    expect(second.rows).toHaveLength(3);
    expect(second.rows[0].id).toBeLessThan(first.rows.at(-1)!.id);
    // No row appears on two pages.
    const ids = [...first.rows, ...second.rows].map((row) => row.id);
    expect(new Set(ids).size).toBe(6);

    const everything = await listActivity(kale, { limit: 200 });
    expect(everything.more).toBe(false);
    const last = await listActivity(kale, { limit: 3, before: everything.rows.at(-1)!.id });
    expect(last).toEqual({ rows: [], more: false });
    // Odd page sizes fall back to something sensible.
    expect((await listActivity(kale, { limit: 0 })).rows).toHaveLength(1);
    expect((await listActivity(kale, { limit: 100000 })).rows.length).toBe(everything.rows.length);
  });

  it("is for Owners only", async () => {
    const karen = await insertUser("Karen", "karen@example.com", "advisor");
    await expect(listActivity(karen)).rejects.toThrow(AppError);
  });
});
