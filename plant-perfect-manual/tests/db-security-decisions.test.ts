import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { asSystem, asUser } from "@/db/client";
import {
  approvals,
  comments,
  endorsements,
  officialVersions,
  proposalNotes,
  proposals,
  sections,
} from "@/db/schema";
import { addNote } from "@/lib/notes";
import { loadOfficial, saveOfficial } from "@/lib/official";
import {
  approveProposal,
  createProposal,
  declineProposal,
  endorseProposal,
  loadProposal,
} from "@/lib/proposals";
import type { RichDoc } from "@/lib/richtext";
import { actorFor, insertUser, withTestDatabase } from "./helpers/db";

withTestDatabase();

/**
 * These tests skip the app's own checks and talk to the database directly as
 * each kind of user, to prove the database itself keeps the promises about
 * proposals, approvals, endorsements and official text.
 */

const doc = (text: string): RichDoc => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

async function section(title: string): Promise<string> {
  const [row] = await asSystem((db) => db.select().from(sections).where(eq(sections.title, title)));
  return row.id;
}

async function setup() {
  const kale = await actorFor("kale@example.com");
  const casey = await actorFor("casey@example.com");
  const existing = await asSystem((db) =>
    db.query.users.findFirst({ where: (u, { eq: is }) => is(u.email, "karen@example.com") }),
  );
  const karen = existing ? await actorFor("karen@example.com") : await insertUser("Karen", "karen@example.com", "advisor");
  return { kale, casey, karen };
}

/** An open text proposal by Kale on the given section. */
async function openProposal(title: string, sectionTitle: string, text: string): Promise<string> {
  const { kale } = await setup();
  return createProposal(kale, {
    kind: "decision",
    sectionId: await section(sectionTitle),
    title,
    proposedOfficial: doc(text),
  });
}

const row = async (id: string) => (await asSystem((db) => db.select().from(proposals).where(eq(proposals.id, id))))[0];

describe("database rules: making a proposal", () => {
  it("only in your own name, always starting open", async () => {
    const { kale, casey, karen } = await setup();
    const wages = await section("Wages");
    const base = {
      type: "decision" as const,
      title: "Direct to the table",
      sectionId: wages,
      proposedOfficial: doc("x"),
      proposedOfficialText: "x",
    };
    await expect(asUser(kale.id, (tx) => tx.insert(proposals).values({ ...base, proposedBy: casey.id }))).rejects.toThrow();
    await expect(
      asUser(kale.id, (tx) =>
        tx.insert(proposals).values({ ...base, proposedBy: kale.id, status: "approved", decidedAt: new Date(), decidedBy: kale.id }),
      ),
    ).rejects.toThrow();
    await expect(asUser(kale.id, (tx) => tx.insert(proposals).values({ ...base, proposedBy: kale.id, revision: 5 }))).rejects.toThrow();
    // Advisors cannot propose at all.
    await expect(asUser(karen.id, (tx) => tx.insert(proposals).values({ ...base, proposedBy: karen.id }))).rejects.toThrow();
    const ok = await asUser(kale.id, (tx) => tx.insert(proposals).values({ ...base, proposedBy: kale.id }).returning());
    expect(ok).toHaveLength(1);
  });

  it("must match its kind: text proposals have text and a section, structure proposals have a change", async () => {
    const { kale } = await setup();
    const wages = await section("Wages");
    await expect(
      asUser(kale.id, (tx) => tx.insert(proposals).values({ type: "decision", title: "No text", sectionId: wages, proposedBy: kale.id })),
    ).rejects.toThrow();
    await expect(
      asUser(kale.id, (tx) =>
        tx.insert(proposals).values({ type: "decision", title: "No section", proposedOfficial: doc("x"), proposedOfficialText: "x", proposedBy: kale.id }),
      ),
    ).rejects.toThrow();
    await expect(
      asUser(kale.id, (tx) => tx.insert(proposals).values({ type: "structure", title: "No change", proposedBy: kale.id })),
    ).rejects.toThrow();
    await expect(
      asUser(kale.id, (tx) =>
        tx.insert(proposals).values({ type: "decision", title: "Not a document", sectionId: wages, proposedOfficial: "<p>html</p>", proposedOfficialText: "x", proposedBy: kale.id }),
      ),
    ).rejects.toThrow();
  });
});

describe("database rules: approvals and endorsements", () => {
  it("are only ever added, in your own name, by people allowed to", async () => {
    const { kale, casey, karen } = await setup();
    const id = await openProposal("Approvals test", "Benefits", "Benefits text.");
    await expect(asUser(kale.id, (tx) => tx.insert(approvals).values({ proposalId: id, userId: casey.id }))).rejects.toThrow();
    await expect(asUser(karen.id, (tx) => tx.insert(approvals).values({ proposalId: id, userId: karen.id }))).rejects.toThrow();
    await expect(asUser(karen.id, (tx) => tx.insert(endorsements).values({ proposalId: id, userId: kale.id }))).rejects.toThrow();
    // Never twice.
    await expect(asUser(kale.id, (tx) => tx.insert(approvals).values({ proposalId: id, userId: kale.id }))).rejects.toThrow();

    await endorseProposal(karen, id, { revision: 1 });
    await expect(asUser(karen.id, (tx) => tx.insert(endorsements).values({ proposalId: id, userId: karen.id }))).rejects.toThrow();
    // Never changed, never removed.
    await expect(asUser(kale.id, (tx) => tx.update(approvals).set({ createdAt: new Date(0) }))).rejects.toThrow();
    await expect(asUser(kale.id, (tx) => tx.delete(approvals))).rejects.toThrow();
    await expect(asUser(karen.id, (tx) => tx.update(endorsements).set({ createdAt: new Date(0) }))).rejects.toThrow();
    await expect(asUser(karen.id, (tx) => tx.delete(endorsements))).rejects.toThrow();
    await expect(asUser(kale.id, (tx) => tx.delete(proposals))).rejects.toThrow();
  });

  it("cannot be added to a declined or withdrawn proposal", async () => {
    const { casey, karen } = await setup();
    const id = await openProposal("To decline", "Hiring", "Hiring text.");
    await declineProposal(casey, id, "");
    await expect(asUser(casey.id, (tx) => tx.insert(approvals).values({ proposalId: id, userId: casey.id }))).rejects.toThrow();
    await expect(asUser(karen.id, (tx) => tx.insert(endorsements).values({ proposalId: id, userId: karen.id }))).rejects.toThrow();
  });
});

describe("database rules: deciding", () => {
  it("nothing is approved without the approval of the person approving it", async () => {
    const { casey } = await setup();
    const id = await openProposal("Needs an approval", "Training", "Training text.");
    // Casey has not approved it, so she cannot mark it approved.
    await expect(
      asUser(casey.id, (tx) => tx.update(proposals).set({ status: "approved", decidedBy: casey.id }).where(eq(proposals.id, id))),
    ).rejects.toThrow();
    expect((await row(id)).status).toBe("open");
  });

  it("only in your own name, and an Advisor cannot decide anything", async () => {
    const { kale, casey, karen } = await setup();
    const id = await openProposal("Whose decision", "Store Hours", "Hours text.");
    await expect(
      asUser(kale.id, (tx) => tx.update(proposals).set({ status: "approved", decidedBy: casey.id }).where(eq(proposals.id, id))),
    ).rejects.toThrow();
    for (const status of ["approved", "declined", "withdrawn"] as const) {
      const changed = await asUser(karen.id, (tx) =>
        tx.update(proposals).set({ status, decidedBy: karen.id }).where(eq(proposals.id, id)).returning(),
      );
      expect(changed).toHaveLength(0);
    }
    expect((await row(id)).status).toBe("open");
  });

  it("your own proposal is withdrawn, someone else's is declined", async () => {
    const { kale, casey } = await setup();
    const id = await openProposal("Withdraw or decline", "Scheduling", "Scheduling text.");
    await expect(
      asUser(kale.id, (tx) => tx.update(proposals).set({ status: "declined", decidedBy: kale.id }).where(eq(proposals.id, id))),
    ).rejects.toThrow();
    await expect(
      asUser(casey.id, (tx) => tx.update(proposals).set({ status: "withdrawn", decidedBy: casey.id }).where(eq(proposals.id, id))),
    ).rejects.toThrow();
    // A reason belongs to a decline only.
    await expect(
      asUser(kale.id, (tx) =>
        tx.update(proposals).set({ status: "withdrawn", decidedBy: kale.id, declineReason: "because" }).where(eq(proposals.id, id)),
      ),
    ).rejects.toThrow();
    const done = await asUser(casey.id, (tx) =>
      tx.update(proposals).set({ status: "declined", decidedBy: casey.id, declineReason: "No." }).where(eq(proposals.id, id)).returning(),
    );
    expect(done[0]).toMatchObject({ status: "declined", decidedBy: casey.id });
    expect(done[0].decidedAt).not.toBeNull();
  });

  it("a decided proposal never changes again, for anyone", async () => {
    const { kale, casey } = await setup();
    const id = await openProposal("Final", "Budget", "Budget text.");
    await approveProposal(casey, id, { revision: 1 });
    expect((await row(id)).status).toBe("approved");
    for (const actor of [kale, casey]) {
      await expect(asUser(actor.id, (tx) => tx.update(proposals).set({ title: "Rewritten" }).where(eq(proposals.id, id)))).rejects.toThrow();
      await expect(
        asUser(actor.id, (tx) => tx.update(proposals).set({ status: "declined", decidedBy: actor.id }).where(eq(proposals.id, id))),
      ).rejects.toThrow();
      await expect(
        asUser(actor.id, (tx) => tx.update(proposals).set({ proposedOfficial: doc("other"), proposedOfficialText: "other" }).where(eq(proposals.id, id))),
      ).rejects.toThrow();
    }
    // Not even with full database rights, outside the app's permission rules.
    await expect(asSystem((db) => db.update(proposals).set({ title: "By a script" }).where(eq(proposals.id, id)))).rejects.toThrow();
    await expect(
      asSystem((db) => db.update(proposals).set({ decidedAt: new Date(0) }).where(eq(proposals.id, id))),
    ).rejects.toThrow();
    expect((await row(id)).title).toBe("Final");
  });
});

describe("database rules: changing an open proposal", () => {
  it("only its proposer, only until someone else has approved or endorsed, and the revision counts by itself", async () => {
    const { kale, casey, karen } = await setup();
    const id = await openProposal("Editable", "Quotes", "Quotes text.");
    await expect(asUser(casey.id, (tx) => tx.update(proposals).set({ title: "Casey's title" }).where(eq(proposals.id, id)))).rejects.toThrow();
    // Who proposed it, its kind and its section cannot be changed at all.
    await expect(asUser(kale.id, (tx) => tx.update(proposals).set({ proposedBy: casey.id }).where(eq(proposals.id, id)))).rejects.toThrow();
    await expect(asUser(kale.id, (tx) => tx.update(proposals).set({ type: "official_text" }).where(eq(proposals.id, id)))).rejects.toThrow();
    const wages = await section("Wages");
    await expect(asUser(kale.id, (tx) => tx.update(proposals).set({ sectionId: wages }).where(eq(proposals.id, id)))).rejects.toThrow();
    await expect(asUser(kale.id, (tx) => tx.update(proposals).set({ direct: true }).where(eq(proposals.id, id)))).rejects.toThrow();
    // The revision cannot be set by hand.
    await expect(asUser(kale.id, (tx) => tx.update(proposals).set({ revision: 9 }).where(eq(proposals.id, id)))).rejects.toThrow();

    await asUser(kale.id, (tx) => tx.update(proposals).set({ title: "Edited once", revision: 1 }).where(eq(proposals.id, id)));
    expect(await row(id)).toMatchObject({ title: "Edited once", revision: 2, updatedBy: kale.id });
    // Changing it and deciding it cannot be one step.
    await expect(
      asUser(kale.id, (tx) =>
        tx.update(proposals).set({ title: "Edited and approved", status: "approved", decidedBy: kale.id }).where(eq(proposals.id, id)),
      ),
    ).rejects.toThrow();

    await endorseProposal(karen, id, { revision: 2 });
    await expect(asUser(kale.id, (tx) => tx.update(proposals).set({ title: "After endorsement" }).where(eq(proposals.id, id)))).rejects.toThrow();
    expect((await row(id)).title).toBe("Edited once");
  });
});

describe("database rules: official text comes only from an approved proposal", () => {
  it("refuses a version for an open proposal, another section, other words, or a second version", async () => {
    const { kale, casey } = await setup();
    const construction = await section("Construction");
    const signage = await section("Signage");
    const id = await openProposal("Tie test", "Construction", "Construction text.");
    const insert = (actorId: string, values: Partial<typeof officialVersions.$inferInsert>) =>
      asUser(actorId, (tx) =>
        tx.insert(officialVersions).values({
          sectionId: construction,
          version: 50,
          content: doc("Construction text."),
          contentText: "Construction text.",
          createdBy: actorId,
          proposalId: id,
          ...values,
        }),
      );
    // Still open: no version yet.
    await expect(insert(kale.id, {})).rejects.toThrow();
    await approveProposal(casey, id, { revision: 1 });
    // The real version exists now; a second one from the same proposal is refused.
    await expect(insert(casey.id, { version: 51 })).rejects.toThrow();

    // Pointing a version at someone else's approved proposal to borrow its approvals.
    const other = await openProposal("Borrowed approvals", "Signage", "Signage text.");
    await approveProposal(casey, other, { revision: 1 });
    await saveOfficial(kale, await section("Offices and Finishing"), doc("Offices text."));
    const [mine] = await asSystem((db) => db.select().from(proposals).where(eq(proposals.title, "Edited directly")));
    await expect(insert(kale.id, { sectionId: construction, proposalId: other, version: 60 })).rejects.toThrow();
    await expect(insert(kale.id, { sectionId: signage, proposalId: other, version: 60, content: doc("Different words."), contentText: "Different words." })).rejects.toThrow();
    // Only the Owner whose approval finalized it may save its version.
    await expect(insert(kale.id, { sectionId: signage, proposalId: other, version: 61, content: doc("Signage text."), contentText: "Signage text." })).rejects.toThrow();
    expect(mine.status).toBe("approved");
    // Versions are never changed or removed.
    await expect(asUser(kale.id, (tx) => tx.update(officialVersions).set({ contentText: "changed" }))).rejects.toThrow();
    await expect(asUser(kale.id, (tx) => tx.delete(officialVersions))).rejects.toThrow();
    const official = await asSystem((db) => loadOfficial(db, construction));
    expect(official?.approvals.map((a) => a.name)).toEqual(["Kale", "Casey"]);
  });
});

describe("database rules: comments and source notes", () => {
  it("a comment is on a note or on a proposal, never both or neither", async () => {
    const { kale, karen } = await setup();
    const id = await openProposal("Commented", "Vendor Contacts", "Vendors text.");
    const note = await addNote(kale, { body: doc("a note") });
    const base = { body: doc("hello"), bodyText: "hello", createdBy: karen.id };
    await expect(asUser(karen.id, (tx) => tx.insert(comments).values(base))).rejects.toThrow();
    await expect(asUser(karen.id, (tx) => tx.insert(comments).values({ ...base, noteId: note.id, proposalId: id }))).rejects.toThrow();
    const ok = await asUser(karen.id, (tx) => tx.insert(comments).values({ ...base, proposalId: id }).returning());
    expect(ok).toHaveLength(1);
  });

  it("only the proposer links notes, while the proposal is open", async () => {
    const { kale, casey, karen } = await setup();
    const id = await openProposal("With notes", "Order Deadlines", "Deadlines text.");
    const note = await addNote(kale, { body: doc("source note") });
    await expect(asUser(casey.id, (tx) => tx.insert(proposalNotes).values({ proposalId: id, noteId: note.id, createdBy: casey.id }))).rejects.toThrow();
    await expect(asUser(karen.id, (tx) => tx.insert(proposalNotes).values({ proposalId: id, noteId: note.id, createdBy: karen.id }))).rejects.toThrow();
    await asUser(kale.id, (tx) => tx.insert(proposalNotes).values({ proposalId: id, noteId: note.id, createdBy: kale.id }));
    await expect(asUser(kale.id, (tx) => tx.delete(proposalNotes))).rejects.toThrow();
    await approveProposal(casey, id, { revision: 1 });
    const second = await addNote(kale, { body: doc("too late") });
    await expect(asUser(kale.id, (tx) => tx.insert(proposalNotes).values({ proposalId: id, noteId: second.id, createdBy: kale.id }))).rejects.toThrow();
    expect((await asSystem((db) => loadProposal(db, id)))?.status).toBe("approved");
  });
});
