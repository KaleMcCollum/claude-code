import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { asSystem } from "@/db/client";
import { activityLog, sections, settings } from "@/db/schema";
import { addNote, removeNote, setNoteSorted, sortNote } from "@/lib/notes";
import { saveOfficial } from "@/lib/official";
import { AppError } from "@/lib/permissions";
import { addApproval, approveAlone, approveProposal, createProposal } from "@/lib/proposals";
import type { RichDoc } from "@/lib/richtext";
import { loadTree, renameSection } from "@/lib/sections";
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "@/lib/settings";
import { loadToday } from "@/lib/today";
import { actorFor, insertUser, withTestDatabase } from "./helpers/db";

withTestDatabase();

const doc = (text: string): RichDoc => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

describe("settings", () => {
  it("start with the opening date and stale period from the spec", async () => {
    expect(await asSystem((db) => loadSettings(db))).toEqual({ openingDate: "2027-03-01", staleDays: 30 });
    expect(DEFAULT_SETTINGS.staleDays).toBe(30);
  });

  it("can be changed by an Owner, and the change is logged", async () => {
    const kale = await actorFor("kale@example.com");
    expect(await saveSettings(kale, { openingDate: "2027-04-15", staleDays: "45" })).toEqual({ changed: true });
    expect(await asSystem((db) => loadSettings(db))).toEqual({ openingDate: "2027-04-15", staleDays: 45 });
    const log = await asSystem((db) => db.select().from(activityLog).where(eq(activityLog.action, "setting.changed")));
    expect(log.map((e) => e.summary).sort()).toEqual([
      "Changed the opening date to Apr 15, 2027",
      "Changed when sections count as stale to 45 days",
    ]);
    // Saving the same values again changes and logs nothing.
    expect(await saveSettings(kale, { openingDate: "2027-04-15", staleDays: 45 })).toEqual({ changed: false });
    expect(await asSystem((db) => db.select().from(activityLog).where(eq(activityLog.action, "setting.changed")))).toHaveLength(2);
    // One row per setting, updated in place.
    expect(await asSystem((db) => db.select().from(settings))).toHaveLength(2);
    await saveSettings(kale, { openingDate: "2027-03-01", staleDays: 30 });
    expect(await asSystem((db) => db.select().from(settings))).toHaveLength(2);
  });

  it("rejects dates and day counts that make no sense", async () => {
    const kale = await actorFor("kale@example.com");
    await expect(saveSettings(kale, { openingDate: "March 1", staleDays: 30 })).rejects.toThrow(AppError);
    await expect(saveSettings(kale, { openingDate: "2027-02-30", staleDays: 30 })).rejects.toThrow(AppError);
    await expect(saveSettings(kale, { openingDate: "2027-03-01", staleDays: 0 })).rejects.toThrow(AppError);
    await expect(saveSettings(kale, { openingDate: "2027-03-01", staleDays: 2.5 })).rejects.toThrow(AppError);
    await expect(saveSettings(kale, { openingDate: "2027-03-01", staleDays: "many" })).rejects.toThrow(AppError);
    await expect(saveSettings(kale, { openingDate: "2027-03-01", staleDays: 5000 })).rejects.toThrow(AppError);
  });

  it("cannot be changed by an Advisor", async () => {
    const karen = await insertUser("Karen", "karen@example.com", "advisor");
    await expect(saveSettings(karen, { openingDate: "2030-01-01", staleDays: 1 })).rejects.toThrow(AppError);
    expect(await asSystem((db) => loadSettings(db))).toEqual({ openingDate: "2027-03-01", staleDays: 30 });
  });
});

describe("Today page", () => {
  it("counts down to the opening date in Central time", async () => {
    const kale = await actorFor("kale@example.com");
    // 9:30 PM Central on Nov 10, 2026.
    const today = await loadToday(kale, new Date("2026-11-11T03:30:00Z"));
    expect(today.todayKey).toBe("2026-11-10");
    expect(today.opening).toEqual({ date: "2027-03-01", days: 111 });
    expect((await loadToday(kale, new Date("2027-03-01T18:00:00Z"))).opening.days).toBe(0);
    expect((await loadToday(kale, new Date("2027-03-03T18:00:00Z"))).opening.days).toBe(-2);
  });

  it("lists unsorted notes with their count", async () => {
    const kale = await actorFor("kale@example.com");
    const first = await addNote(kale, { body: doc("unsorted one") });
    await addNote(kale, { body: doc("unsorted two") });
    const done = await addNote(kale, { body: doc("already sorted") });
    await setNoteSorted(kale, done.id, true);

    const today = await loadToday(kale);
    expect(today.unsorted.total).toBe(2);
    expect(today.unsorted.notes.map((n) => n.id)).toContain(first.id);
    expect(today.unsorted.notes.map((n) => n.id)).not.toContain(done.id);
  });

  it("lists sections with content that were not updated within the stale period, stalest first", async () => {
    const kale = await actorFor("kale@example.com");
    const now = new Date();
    const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);
    const all = await asSystem((db) => db.select().from(sections));
    const byTitle = (title: string) => all.find((s) => s.title === title)!;

    // Give four sections some content: official text, or a note filed there.
    await saveOfficial(kale, byTitle("Wages").id, doc("Starting wage: $15.00/hr."));
    await saveOfficial(kale, byTitle("Signage").id, doc("Pylon sign by Holly Lumber."));
    await saveOfficial(kale, byTitle("Annuals").id, doc("Order annuals in January."));
    const filed = await addNote(kale, { body: doc("budget note") });
    await sortNote(kale, filed.id, await asSystem((db) => loadTree(db)), {
      sectionIds: [byTitle("Budget").id],
      businessTag: null,
      sorted: true,
    });

    await asSystem((db) => db.update(sections).set({ updatedAt: daysAgo(90) }).where(eq(sections.id, byTitle("Wages").id)));
    await asSystem((db) => db.update(sections).set({ updatedAt: daysAgo(31) }).where(eq(sections.id, byTitle("Signage").id)));
    await asSystem((db) => db.update(sections).set({ updatedAt: daysAgo(29) }).where(eq(sections.id, byTitle("Budget").id)));
    await asSystem((db) =>
      db.update(sections).set({ updatedAt: daysAgo(200), archivedAt: now }).where(eq(sections.id, byTitle("Annuals").id)),
    );
    // Old but empty: nothing to ask "are we still good with this?" about.
    await asSystem((db) => db.update(sections).set({ updatedAt: daysAgo(300) }).where(eq(sections.id, byTitle("Hiring").id)));
    await asSystem((db) => db.update(sections).set({ updatedAt: daysAgo(300) }).where(eq(sections.id, byTitle("People").id)));

    const today = await loadToday(kale, now);
    expect(today.stale.afterDays).toBe(30);
    expect(today.stale.sections.map((s) => `${s.number} ${s.title}`)).toEqual(["2.1 Wages", "5.2 Signage"]);
    expect(today.stale.sections[0].daysAgo).toBeGreaterThanOrEqual(89);

    // An update makes a section fresh again.
    await renameSection(kale, byTitle("Wages").id, "Wages and Pay");
    expect((await loadToday(kale, now)).stale.sections.map((s) => s.title)).toEqual(["Signage"]);

    // The period is a setting.
    await saveSettings(kale, { openingDate: "2027-03-01", staleDays: 20 });
    expect((await loadToday(kale, now)).stale.sections.map((s) => s.title)).toEqual(["Signage", "Budget"]);

    // A section whose only content was a note that has since been removed is empty again.
    await removeNote(kale, filed.id);
    expect((await loadToday(kale, now)).stale.sections.map((s) => s.title)).toEqual(["Signage"]);
  });

  it("shows at most the 10 newest unsorted notes but counts them all", async () => {
    const kale = await actorFor("kale@example.com");
    for (let i = 0; i < 12; i += 1) await addNote(kale, { body: doc(`backlog ${i}`) });
    const today = await loadToday(kale);
    expect(today.unsorted.total).toBe(14);
    expect(today.unsorted.notes).toHaveLength(10);
  });

  it("can be read by an Advisor", async () => {
    const karen = await actorFor("karen@example.com");
    const today = await loadToday(karen);
    expect(today.unsorted.total).toBe(14);
  });

  it("shows what is waiting for approval and what one person decided alone", async () => {
    const kale = await actorFor("kale@example.com");
    const casey = await actorFor("casey@example.com");
    const karen = await actorFor("karen@example.com");
    const all = await asSystem((db) => db.select().from(sections));
    const byTitle = (title: string) => all.find((s) => s.title === title)!;
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000);

    const winter = await createProposal(
      casey,
      { kind: "decision", sectionId: byTitle("Store Hours").id, title: "Winter hours", proposedOfficial: doc("Open 9 to 5 in winter.") },
      { now: twoDaysAgo },
    );
    const plans = await createProposal(kale, {
      kind: "structure",
      change: { action: "add", parentId: null, title: "Seasonal Plans" },
    });

    // The one waiting longest comes first. An Advisor sees the same list.
    let today = await loadToday(kale);
    expect(today.awaiting.map((p) => p.title)).toEqual(["Winter hours", 'Add a top-level section "Seasonal Plans"']);
    expect(today.approvers.map((a) => a.name).sort()).toEqual(["Casey", "Kale"]);
    expect((await loadToday(karen)).awaiting.map((p) => p.id)).toEqual([winter, plans]);

    // Kale's "Edit official" saves earlier in this file were one-person
    // decisions: they are flagged for Casey to see.
    expect(today.decidedAlone.length).toBeGreaterThanOrEqual(2);
    expect(today.decidedAlone.every((p) => p.direct && p.approvals.map((a) => a.name).join() === "Kale")).toBe(true);
    expect(today.decidedAlone.map((p) => p.sectionId)).toContain(byTitle("Signage").id);
    const flaggedBefore = today.decidedAlone.length;

    // Approved by both: no longer waiting, and not flagged.
    await approveProposal(kale, winter, { revision: 1, currentVersionId: null });
    today = await loadToday(casey);
    expect(today.awaiting.map((p) => p.id)).toEqual([plans]);
    expect(today.decidedAlone).toHaveLength(flaggedBefore);

    // Approved by Kale alone: flagged, newest first, until Casey adds her approval.
    await approveAlone(kale, plans, { revision: 1 });
    today = await loadToday(casey);
    expect(today.awaiting).toEqual([]);
    expect(today.decidedAlone[0]).toMatchObject({ id: plans, direct: false, decidedByName: "Kale" });
    expect(today.decidedAlone).toHaveLength(flaggedBefore + 1);
    await addApproval(casey, plans);
    expect((await loadToday(casey)).decidedAlone.map((p) => p.id)).not.toContain(plans);

    // Saving a section a second time does not take the first save off the
    // list: both are shown, the first as no longer the current text.
    const signage = byTitle("Signage").id;
    const firstSave = today.decidedAlone.find((p) => p.sectionId === signage)!;
    expect(firstSave.superseded).toBe(false);
    await saveOfficial(kale, signage, doc("Pylon sign by Holly Lumber, lit at night."));
    today = await loadToday(casey);
    const onSignage = today.decidedAlone.filter((p) => p.sectionId === signage);
    expect(onSignage.map((p) => p.superseded)).toEqual([false, true]);
    expect(onSignage[1].id).toBe(firstSave.id);
    expect(today.decidedAlone).toHaveLength(flaggedBefore + 1);
    await addApproval(casey, onSignage[0].id);
    expect((await loadToday(casey)).decidedAlone).toHaveLength(flaggedBefore);

    // After 14 days nothing from today is flagged any more.
    const later = new Date(Date.now() + 15 * 86_400_000);
    expect((await loadToday(kale, later)).decidedAlone).toEqual([]);
    expect((await loadToday(kale, new Date(Date.now() + 13 * 86_400_000))).decidedAlone).toHaveLength(flaggedBefore);
  });
});
