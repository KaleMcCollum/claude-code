import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { asSystem } from "@/db/client";
import { activityLog, approvals, officialVersions, sections } from "@/db/schema";
import { approvalLine, joinNames, listVersions, loadOfficial, restoreVersion, saveOfficial } from "@/lib/official";
import { AppError } from "@/lib/permissions";
import { type RichDoc, docToText } from "@/lib/richtext";
import { search } from "@/lib/search";
import { loadTree } from "@/lib/sections";
import { formatDate } from "@/lib/time";
import { actorFor, insertUser, withTestDatabase } from "./helpers/db";

withTestDatabase();

async function sectionId(title: string): Promise<string> {
  const [row] = await asSystem((db) => db.select().from(sections).where(eq(sections.title, title)));
  return row.id;
}

function doc(...paragraphs: string[]): RichDoc {
  return {
    type: "doc",
    content: paragraphs.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })),
  };
}

describe("saving official text", () => {
  it("records a version approved by the Owner who saved it", async () => {
    const kale = await actorFor("kale@example.com");
    const id = await sectionId("Wages");
    expect(await asSystem((db) => loadOfficial(db, id))).toBeNull();

    const result = await saveOfficial(kale, id, doc("Starting wage, Coffee Shop: $13.00/hr."));
    expect(result).toEqual({ changed: true, version: 1 });

    const official = await asSystem((db) => loadOfficial(db, id));
    expect(official?.version).toBe(1);
    expect(official?.approvals.map((a) => a.name)).toEqual(["Kale"]);
    expect(approvalLine(official!.approvals)).toBe(`Approved by Kale, ${formatDate(new Date())}`);

    const [section] = await asSystem((db) => db.select().from(sections).where(eq(sections.id, id)));
    expect(section.updatedBy).toBe(kale.id);
    const log = await asSystem((db) => db.select().from(activityLog).where(eq(activityLog.action, "official.saved")));
    expect(log).toHaveLength(1);
    expect(log[0].userId).toBe(kale.id);
  });

  it("keeps the words exactly as typed", async () => {
    const kale = await actorFor("kale@example.com");
    const id = await sectionId("Hiring");
    const typed = "  we dont   hire  ppl under 16 -- EVER!!  (ask Casey)\tcafé ☕ “quotes” ";
    await saveOfficial(kale, id, doc(typed));
    const official = await asSystem((db) => loadOfficial(db, id));
    expect(official?.content.content[0].content?.[0].text).toBe(typed);
  });

  it("keeps every earlier version", async () => {
    const kale = await actorFor("kale@example.com");
    const casey = await actorFor("casey@example.com");
    const id = await sectionId("Wages");
    await saveOfficial(casey, id, doc("Starting wage, Coffee Shop: $15.00/hr."));

    const versions = await asSystem((db) =>
      db.select().from(officialVersions).where(eq(officialVersions.sectionId, id)).orderBy(asc(officialVersions.version)),
    );
    expect(versions.map((v) => v.version)).toEqual([1, 2]);
    expect(versions[0].contentText).toBe("Starting wage, Coffee Shop: $13.00/hr.");
    expect(versions[0].createdBy).toBe(kale.id);
    expect(versions[1].contentText).toBe("Starting wage, Coffee Shop: $15.00/hr.");

    // The new version is approved only by the person who saved it.
    const official = await asSystem((db) => loadOfficial(db, id));
    expect(official?.approvals.map((a) => a.name)).toEqual(["Casey"]);
    // The old approval is still on record.
    const old = await asSystem((db) => db.select().from(approvals).where(eq(approvals.proposalId, versions[0].proposalId)));
    expect(old.map((a) => a.userId)).toEqual([kale.id]);
  });

  it("does not create a version when nothing changed", async () => {
    const casey = await actorFor("casey@example.com");
    const id = await sectionId("Wages");
    const result = await saveOfficial(casey, id, doc("Starting wage, Coffee Shop: $15.00/hr."));
    expect(result).toEqual({ changed: false, version: 2 });
    const empty = await saveOfficial(casey, await sectionId("Training"), { type: "doc", content: [{ type: "paragraph" }] });
    expect(empty).toEqual({ changed: false, version: null });
  });

  it("saving the same text again from the same page changes nothing, and is not told someone else changed it", async () => {
    const kale = await actorFor("kale@example.com");
    const casey = await actorFor("casey@example.com");
    const id = await sectionId("Closing Procedures");
    await saveOfficial(kale, id, doc("Lock the back door."));
    const onScreen = (await asSystem((db) => loadOfficial(db, id)))!;
    const saves = async () => (await asSystem((db) => db.select().from(activityLog).where(eq(activityLog.entityId, id)))).length;

    // Kale changes the text and presses Save. It goes through, but the
    // answer never reaches his phone.
    const typed = doc("Lock the back door.", "Count the till.");
    expect(await saveOfficial(kale, id, typed, { baseVersionId: onScreen.id })).toEqual({ changed: true, version: 2 });
    // He presses Save again on the same page: same text, and still the
    // version the page started from. Nothing to save; nobody else changed anything.
    expect(await saveOfficial(kale, id, typed, { baseVersionId: onScreen.id })).toEqual({ changed: false, version: 2 });
    expect(await saveOfficial(kale, id, typed, { baseVersionId: onScreen.id })).toEqual({ changed: false, version: 2 });
    expect((await asSystem((db) => listVersions(db, id))).map((v) => v.version)).toEqual([2, 1]);
    expect(await saves()).toBe(2);

    // Casey's page is just as old. Saving the very text that is official now is "no changes" for her too;
    // saving anything else from that page is refused, as before, so Kale's change is not undone.
    expect(await saveOfficial(casey, id, typed, { baseVersionId: onScreen.id })).toEqual({ changed: false, version: 2 });
    await expect(saveOfficial(casey, id, doc("Lock both doors."), { baseVersionId: onScreen.id })).rejects.toThrow(
      "Someone else changed this official text after you opened it.",
    );
    // An empty first text from a page that is out of date is refused like any other.
    await expect(saveOfficial(casey, id, { type: "doc", content: [{ type: "paragraph" }] }, { baseVersionId: null })).rejects.toThrow(
      "Someone else changed this official text after you opened it.",
    );
    expect((await asSystem((db) => listVersions(db, id))).map((v) => v.version)).toEqual([2, 1]);
    expect(await saves()).toBe(2);
  });

  it("refuses Advisors", async () => {
    const karen = await insertUser("Karen", "karen@example.com", "advisor");
    await expect(saveOfficial(karen, await sectionId("Wages"), doc("Advisors decide wages"))).rejects.toThrow(AppError);
    const official = await asSystem(async (db) => loadOfficial(db, await sectionId("Wages")));
    expect(docToText(official!.content)).toBe("Starting wage, Coffee Shop: $15.00/hr.");
  });

  it("refuses archived or unknown sections", async () => {
    const kale = await actorFor("kale@example.com");
    await expect(saveOfficial(kale, "00000000-0000-4000-8000-000000000000", doc("x"))).rejects.toThrow(AppError);
    const id = await sectionId("Annuals");
    await asSystem((db) => db.update(sections).set({ archivedAt: new Date() }).where(eq(sections.id, id)));
    await expect(saveOfficial(kale, id, doc("x"))).rejects.toThrow(AppError);
  });

  it("strips anything that is not plain formatting before saving", async () => {
    const kale = await actorFor("kale@example.com");
    const id = await sectionId("Signage");
    await saveOfficial(kale, id, {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "click me", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] },
            { type: "text", text: " and me", marks: [{ type: "link", attrs: { href: "https://example.com/quote" } }, { type: "bold" }] },
          ],
        },
        { type: "scriptBlock", content: [{ type: "text", text: "kept as plain words" }] },
        { type: "image", attrs: { src: "https://example.com/x.png", onerror: "alert(1)" } },
      ],
    });
    const official = await asSystem((db) => loadOfficial(db, id));
    const saved = JSON.stringify(official!.content);
    expect(saved).not.toContain("javascript:");
    expect(saved).not.toContain("onerror");
    expect(saved).not.toContain("scriptBlock");
    expect(saved).toContain("https://example.com/quote");
    expect(docToText(official!.content)).toBe("click me and me\nkept as plain words");
  });
});

describe("version history", () => {
  const wagesVersions = async () => asSystem(async (db) => listVersions(db, await sectionId("Wages")));

  it("lists every version, newest first, with who approved each", async () => {
    const versions = await wagesVersions();
    expect(versions.map((v) => [v.version, v.origin, v.proposalTitle, v.approvals.map((a) => a.name)])).toEqual([
      [2, "direct", "Edited directly", ["Casey"]],
      [1, "direct", "Edited directly", ["Kale"]],
    ]);
    expect(await asSystem(async (db) => listVersions(db, await sectionId("Training")))).toEqual([]);
  });

  it("restores an earlier version as a new version, without touching the ones in between", async () => {
    const kale = await actorFor("kale@example.com");
    const id = await sectionId("Wages");
    const [second, first] = await wagesVersions();

    const result = await restoreVersion(kale, id, first.id, {
      currentVersionId: second.id,
      now: new Date("2026-11-20T16:00:00Z"),
    });
    expect(result).toEqual({ version: 3 });

    const versions = await wagesVersions();
    expect(versions.map((v) => v.version)).toEqual([3, 2, 1]);
    expect(versions[0]).toMatchObject({
      origin: "restored",
      restoredFromVersion: 1,
      proposalTitle: "Restored version 1",
      proposedByName: "Kale",
    });
    expect(docToText(versions[0].content)).toBe("Starting wage, Coffee Shop: $13.00/hr.");
    expect(approvalLine(versions[0].approvals)).toBe("Approved by Kale, Nov 20, 2026");
    // The versions in between are exactly as they were.
    expect(docToText(versions[1].content)).toBe("Starting wage, Coffee Shop: $15.00/hr.");
    expect(versions[1].approvals.map((a) => a.name)).toEqual(["Casey"]);
    expect(versions[2].id).toBe(first.id);

    const log = await asSystem((db) => db.select().from(activityLog).where(eq(activityLog.action, "official.restored")));
    expect(log.map((entry) => entry.summary)).toEqual([
      'Restored version 1 of the official text for "Wages" as version 3, approved by Kale',
    ]);
    expect(log[0].userId).toBe(kale.id);
  });

  it("refuses a restore that makes no sense or comes from an out-of-date page", async () => {
    const kale = await actorFor("kale@example.com");
    const karen = await actorFor("karen@example.com");
    const id = await sectionId("Wages");
    const [third, second, first] = await wagesVersions();

    // The page showed version 2 as the newest, but version 3 exists by now.
    await expect(restoreVersion(kale, id, first.id, { currentVersionId: second.id })).rejects.toThrow(/changed after you opened/);
    // Version 1 says what the official text already says.
    await expect(restoreVersion(kale, id, first.id, { currentVersionId: third.id })).rejects.toThrow(/already what the official text says/);
    // A version of another section.
    await expect(
      restoreVersion(kale, await sectionId("Hiring"), second.id, {
        currentVersionId: (await asSystem(async (db) => loadOfficial(db, await sectionId("Hiring"))))!.id,
      }),
    ).rejects.toThrow(/could not be found/);
    await expect(restoreVersion(kale, id, "not-an-id", { currentVersionId: third.id })).rejects.toThrow(AppError);
    // Advisors cannot restore.
    await expect(restoreVersion(karen, id, second.id, { currentVersionId: third.id })).rejects.toThrow(AppError);
    expect((await wagesVersions()).map((v) => v.version)).toEqual([3, 2, 1]);

    // Restoring version 2 brings the $15.00 text back as version 4.
    expect(await restoreVersion(kale, id, second.id, { currentVersionId: third.id })).toEqual({ version: 4 });
    const current = await asSystem((db) => loadOfficial(db, id));
    expect(current).toMatchObject({ version: 4, origin: "restored", restoredFromVersion: 2 });
    expect(docToText(current!.content)).toBe("Starting wage, Coffee Shop: $15.00/hr.");
  });
});

describe("approval line", () => {
  const at = new Date("2026-11-12T18:00:00Z");
  it("names one approver", () => {
    expect(approvalLine([{ userId: "1", name: "Kale", at }])).toBe("Approved by Kale, Nov 12, 2026");
  });
  it("names both approvers, with the date of the later approval", () => {
    const later = new Date("2026-11-13T18:00:00Z");
    expect(
      approvalLine([
        { userId: "1", name: "Kale", at },
        { userId: "2", name: "Casey", at: later },
      ]),
    ).toBe("Approved by Kale and Casey, Nov 13, 2026");
  });
  it("uses Central time for the date", () => {
    // 3:30 AM UTC on Nov 13 is still the evening of Nov 12 in Fargo.
    expect(approvalLine([{ userId: "1", name: "Kale", at: new Date("2026-11-13T03:30:00Z") }])).toBe(
      "Approved by Kale, Nov 12, 2026",
    );
  });
  it("is empty without approvals", () => {
    expect(approvalLine([])).toBeNull();
    expect(joinNames(["A", "B", "C"])).toBe("A, B and C");
  });
});

describe("search", () => {
  it("finds section names and current official text only", async () => {
    const run = (query: string) => asSystem(async (db) => search(db, await loadTree(db), query));

    const coffee = await run("coffee");
    expect(coffee.sections.map((h) => h.title)).toEqual(["Coffee Shop", "Coffee Equipment"]);
    expect(coffee.official.map((h) => `${h.number} ${h.title}`)).toEqual(["2.1 Wages"]);
    expect(coffee.official[0].excerpt).toContain("$15.00/hr");

    // $13.00 only exists in the old version of Wages.
    expect((await run("$13.00")).official).toEqual([]);
    // Search text is taken literally, not as a pattern.
    expect((await run("%")).official).toEqual([]);
    expect((await run("100%_")).sections).toEqual([]);
    // Too short to search.
    expect(await run("c")).toEqual({ sections: [], official: [], notes: [], comments: [], proposals: [], moreNotes: false, moreComments: false });
  });
});
