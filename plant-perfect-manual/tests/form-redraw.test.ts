import { beforeEach, describe, expect, it, vi } from "vitest";
import { asSystem } from "@/db/client";
import { addNote, removeNote } from "@/lib/notes";
import { loadOfficial, saveOfficial } from "@/lib/official";
import { type Actor, AppError } from "@/lib/permissions";
import { approveProposal, createProposal, declineProposal, endorseProposal, loadProposal, withdrawProposal } from "@/lib/proposals";
import type { RichDoc } from "@/lib/richtext";
import { archiveSection, flattenTree, loadTree, restoreSection } from "@/lib/sections";
import { changeUserRole } from "@/lib/users";
import { actorFor, insertUser, withTestDatabase } from "./helpers/db";

/**
 * When the proposal form (a new proposal, or changes to an open one) is
 * refused, the app draws the form's page again in place, so it shows the
 * sections and the official text as they are now while everything typed
 * stays in the form. Nobody is asked to reload, which would lose the title
 * and the "Why".
 *
 * That redraw must never take the form away. Where the page would no
 * longer show the form (the proposal was declined or endorsed in the
 * meantime, the section archived, the person signed out), the page is left
 * as it is, with the refusal on it and the typed words still there to copy.
 *
 * And no refusal of these two forms ever says "reload", whatever it is
 * about: every refused press in this file is checked for that (see `press`),
 * and the last group presses the refusals the stories above do not reach.
 *
 * The framework's "draw this page again" is stood in for by a counter here,
 * as are the signed-in person and the refresh after a successful change.
 * Everything else is the real thing, database included. The browser tests
 * (e2e/phase3.cjs, parts 21 and 25) check what the person then sees.
 */
const signedIn: { actor: Actor | null } = { actor: null };
const redraws = { count: 0 };
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  refresh: () => {
    redraws.count += 1;
  },
}));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: async () => signedIn.actor }));

const { createProposalAction, editProposalAction } = await import("@/app/(app)/proposals/actions");
const { runAction } = await import("@/lib/actions");

withTestDatabase();

const doc = (text: string): RichDoc => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});
const sectionId = async (title: string) =>
  flattenTree(await asSystem((db) => loadTree(db))).find((node) => node.title === title)!.id;
/** The id of a section's official version as it is now (null: it has no official text). */
const currentVersion = async (id: string) => (await asSystem((db) => loadOfficial(db, id)))?.id ?? null;

/** What the New proposal form sends for a text proposal. */
const newForm = (section: string, text: string, baseVersionId: string | null, more: Record<string, unknown> = {}) => ({
  kind: "decision",
  sectionId: section,
  title: "Staff discount",
  businessTag: "",
  proposedOfficial: doc(text),
  why: "Typed with care.",
  baseVersionId,
  ...more,
});
/** What the Edit proposal form sends for a text proposal. */
const editForm = (section: string, text: string, title = "Staff discount") => ({
  kind: "decision",
  sectionId: section,
  title,
  businessTag: "",
  proposedOfficial: doc(text),
  why: "",
});

/**
 * Run one press of the form's button; hand back the answer and whether the
 * page was drawn again. Whatever the press is refused with, it must not ask
 * for a reload: the form stays open with everything typed, and a reload
 * would lose the title and the "Why".
 */
async function press<T extends { ok: boolean; error?: string }>(work: () => Promise<T>): Promise<{ result: T; redrawn: boolean }> {
  redraws.count = 0;
  const result = await work();
  if (!result.ok) expect(result.error).not.toMatch(/reload/i);
  return { result, redrawn: redraws.count > 0 };
}

const STILL_HERE = "What you typed is still on this page: copy it if you want to keep it.";
const SIGNED_OUT =
  "You have been signed out, so this was not saved. To keep what you typed, leave this page open, sign in again in a new browser tab, then come back to this page and press the button again.";
const FORM_UNREADABLE = "That could not be read, so nothing was saved. What you typed is still on this page: press the button again.";
const SECTION_GONE = "That section no longer exists. It may have been archived.";
const SECTION_GONE_FOR_TEXT = `That section no longer exists. It may have been archived, and nothing can be proposed for it now. ${STILL_HERE}`;
const NO_SUCH_PROPOSAL = `That proposal could not be found, so nothing was saved. ${STILL_HERE}`;

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("the New proposal form, when Propose is refused", () => {
  it("the official text changed while the person was writing: refused in the new words, and the page is drawn again", async () => {
    const kale = await actorFor("kale@example.com");
    const casey = await actorFor("casey@example.com");
    const benefits = await sectionId("Benefits");
    await saveOfficial(casey, benefits, doc("All staff get 10% off plants."));
    const opened = await currentVersion(benefits);
    // Casey changes the section while Kale's form is open.
    await saveOfficial(casey, benefits, doc("All staff get 15% off plants."));

    signedIn.actor = kale;
    const stale = await press(() => createProposalAction(newForm(benefits, "All staff get 20% off plants.", opened)));
    expect(stale.result).toEqual({
      ok: false,
      error:
        "The official text of this section changed while you were writing. Nothing you typed is lost. The new official text is now shown above what you typed: choose there whether to start over from it or keep what you typed, then propose again.",
    });
    expect(stale.redrawn).toBe(true);

    // The form now holds the new version. The same words go through, and a
    // press that works does not ask for this kind of redraw.
    const fresh = await press(async () =>
      createProposalAction(newForm(benefits, "All staff get 20% off plants.", await currentVersion(benefits))),
    );
    expect(fresh.result.ok).toBe(true);
    expect(fresh.redrawn).toBe(false);
  });

  it("any other refusal draws the page again too, as long as the form would still be on it", async () => {
    const kale = await actorFor("kale@example.com");
    const hiring = await sectionId("Hiring");
    signedIn.actor = kale;
    // No title.
    const untitled = await press(() => createProposalAction(newForm(hiring, "Hire two baristas.", null, { title: "  " })));
    expect(untitled.result).toEqual({ ok: false, error: "Say in a few words what is being decided." });
    expect(untitled.redrawn).toBe(true);
    // Something that cannot be read at all.
    const unreadable = await press(() => createProposalAction("not a form"));
    expect(unreadable.result).toEqual({ ok: false, error: FORM_UNREADABLE });
    expect(unreadable.redrawn).toBe(true);
    // A change to the sections that cannot be made: the list of sections is drawn again.
    const noName = await press(() =>
      createProposalAction({ kind: "structure", why: "", change: { action: "add", parentId: "", title: "" } }),
    );
    expect(noName.result).toEqual({ ok: false, error: "Enter a name for the section." });
    expect(noName.redrawn).toBe(true);
  });

  it("the section was archived meanwhile: the page is left alone, so the form and what was typed stay", async () => {
    const kale = await actorFor("kale@example.com");
    const signage = await sectionId("Signage");
    await archiveSection(kale, signage);
    signedIn.actor = kale;
    const gone = await press(() => createProposalAction(newForm(signage, "One sign at the gate.", null)));
    expect(gone.result).toEqual({ ok: false, error: SECTION_GONE_FOR_TEXT });
    expect(gone.redrawn).toBe(false);
    // The same for a section the form could never have had (which is no reason for a mishap).
    const mishaps = vi.mocked(console.error).mock.calls.length;
    const nonsense = await press(() => createProposalAction(newForm("not-a-section", "One sign.", null)));
    expect(nonsense.result.ok).toBe(false);
    expect(nonsense.redrawn).toBe(false);
    expect(vi.mocked(console.error).mock.calls.length).toBe(mishaps);
  });

  it("the person may no longer propose, or is signed out: the page is left alone", async () => {
    const dana = await insertUser("Dana", "dana@example.com", "owner");
    const kale = await actorFor("kale@example.com");
    const hiring = await sectionId("Hiring");
    await changeUserRole(kale, dana.id, "advisor");
    // Her page was opened while she was an Owner. (Drawing it again would send her to the Proposals page.)
    signedIn.actor = await actorFor("dana@example.com");
    const advisor = await press(() => createProposalAction(newForm(hiring, "Hire two baristas.", null)));
    expect(advisor.result.ok).toBe(false);
    expect(advisor.redrawn).toBe(false);

    signedIn.actor = null;
    const signedOut = await press(() => createProposalAction(newForm(hiring, "Hire two baristas.", null)));
    expect(signedOut.result).toEqual({ ok: false, error: SIGNED_OUT });
    expect(signedOut.redrawn).toBe(false);
  });
});

describe("the Edit proposal form, when Save changes is refused", () => {
  it("the official text changed while the page was open: refused in the new words, the page is drawn again, and the next save goes through", async () => {
    const kale = await actorFor("kale@example.com");
    const casey = await actorFor("casey@example.com");
    const training = await sectionId("Training");
    const id = await createProposal(kale, {
      kind: "decision",
      sectionId: training,
      title: "Staff discount",
      proposedOfficial: doc("New baristas train for two weeks."),
    });
    const opened = await currentVersion(training);
    await saveOfficial(casey, training, doc("Casey saved this in the meantime."));

    signedIn.actor = kale;
    const stale = await press(() =>
      editProposalAction(id, editForm(training, "New baristas train for two weeks.", "A longer title"), { currentVersionId: opened }),
    );
    expect(stale.result).toEqual({
      ok: false,
      error:
        "The official text of this section changed while you had this page open. Nothing you typed is lost. The new official text is now shown above the proposed text: read it, then save again.",
    });
    expect(stale.redrawn).toBe(true);
    expect((await asSystem((db) => loadProposal(db, id)))?.title).toBe("Staff discount");

    const fresh = await press(async () =>
      editProposalAction(id, editForm(training, "New baristas train for two weeks.", "A longer title"), {
        currentVersionId: await currentVersion(training),
      }),
    );
    expect(fresh.result).toEqual({ ok: true });
    expect(fresh.redrawn).toBe(false);
    const saved = await asSystem((db) => loadProposal(db, id));
    expect([saved?.title, saved?.outOfDate]).toEqual(["A longer title", false]);
  });

  it("another refusal with the proposal still its proposer's to change: drawn again", async () => {
    const kale = await actorFor("kale@example.com");
    const policies = await sectionId("Policies and Expectations");
    const id = await createProposal(kale, {
      kind: "decision",
      sectionId: policies,
      title: "Phones",
      proposedOfficial: doc("Phones stay in the break room."),
    });
    signedIn.actor = kale;
    const untitled = await press(() =>
      editProposalAction(id, editForm(policies, "Phones stay in the break room.", ""), { currentVersionId: null }),
    );
    expect(untitled.result).toEqual({ ok: false, error: "Say in a few words what is being decided." });
    expect(untitled.redrawn).toBe(true);
  });

  it("someone endorsed it, or it was declined, or its section was archived: the page is left alone, so nothing typed is taken away", async () => {
    const kale = await actorFor("kale@example.com");
    const casey = await actorFor("casey@example.com");
    const make = async (title: string) => {
      const section = await sectionId(title);
      const id = await createProposal(kale, {
        kind: "decision",
        sectionId: section,
        title: `About ${title}`,
        proposedOfficial: doc(`Text for ${title}.`),
      });
      return { id, section, form: editForm(section, `Changed text for ${title}.`, `About ${title}, retitled`) };
    };

    // Endorsed by the other Owner after the edit page was opened.
    const endorsed = await make("Point of Sale");
    await endorseProposal(casey, endorsed.id, { revision: 1 });
    signedIn.actor = kale;
    const afterEndorse = await press(() => editProposalAction(endorsed.id, endorsed.form, { currentVersionId: null }));
    expect(afterEndorse.result).toEqual({
      ok: false,
      error:
        "Someone has already approved or endorsed this proposal, so it can no longer be changed. Withdraw it and make a new one.",
    });
    expect(afterEndorse.redrawn).toBe(false);

    // Declined.
    const declined = await make("Coffee Equipment");
    await declineProposal(casey, declined.id, "Not now.");
    const afterDecline = await press(() => editProposalAction(declined.id, declined.form, { currentVersionId: null }));
    expect(afterDecline.result).toEqual({
      ok: false,
      error: `This proposal has already been declined, so it can no longer be changed. ${STILL_HERE}`,
    });
    expect(afterDecline.redrawn).toBe(false);

    // Its section archived.
    const archived = await make("Vendor Contacts");
    await archiveSection(casey, archived.section);
    const afterArchive = await press(() => editProposalAction(archived.id, archived.form, { currentVersionId: null }));
    expect(afterArchive.result).toEqual({ ok: false, error: SECTION_GONE_FOR_TEXT });
    expect(afterArchive.redrawn).toBe(false);

    // Not a proposal at all (which is no reason for a mishap), and somebody else's proposal.
    const mishaps = vi.mocked(console.error).mock.calls.length;
    const nonsense = await press(() => editProposalAction("nonsense", archived.form, { currentVersionId: null }));
    expect(nonsense.result).toEqual({ ok: false, error: NO_SUCH_PROPOSAL });
    expect(nonsense.redrawn).toBe(false);
    expect(vi.mocked(console.error).mock.calls.length).toBe(mishaps);
    const theirs = await make("Scheduling");
    signedIn.actor = casey;
    const notMine = await press(() => editProposalAction(theirs.id, theirs.form, { currentVersionId: null }));
    expect(notMine.result).toEqual({
      ok: false,
      error: "Only the person who made a proposal can change it. You can comment on it, or decline it.",
    });
    expect(notMine.redrawn).toBe(false);
  });
});

describe("no refusal of the two forms asks for a reload", () => {
  // (Every refused press above is checked for it too, inside `press`. These
  // are the refusals those stories do not reach, each with what it says.)
  const structure = (change: Record<string, unknown>) => ({ kind: "structure", why: "Typed with care.", change });

  it("the note a new proposal comes from was removed: the next press sends it without the note", async () => {
    const kale = await actorFor("kale@example.com");
    const scheduling = await sectionId("Scheduling");
    const note = await addNote(kale, { body: doc("Schedules should go up two weeks ahead.") });
    await removeNote(kale, note.id);
    signedIn.actor = kale;
    const form = newForm(scheduling, "Schedules go up two weeks ahead.", null, { noteIds: [note.id] });
    const removed = await press(() => createProposalAction(form));
    expect(removed.result).toEqual({
      ok: false,
      error: "The note this proposal comes from was removed. Press the button again to send it without the note.",
    });
    // The page is drawn again, and it leaves a removed note out: so the form no longer sends it.
    expect(removed.redrawn).toBe(true);
    const again = await press(() => createProposalAction({ ...form, noteIds: [] }));
    expect(again.result.ok).toBe(true);
    // Notes that are not notes at all. (The form's own reader refuses them
    // first; the rule behind it has words of its own.)
    const unreadable = await press(() => createProposalAction({ ...form, noteIds: ["not-a-note"] }));
    expect(unreadable.result).toEqual({ ok: false, error: FORM_UNREADABLE });
    await expect(
      createProposal(kale, { kind: "decision", sectionId: scheduling, title: "Schedules", proposedOfficial: doc("Three weeks ahead."), noteIds: ["not-a-note"] }),
    ).rejects.toThrow(`The note this proposal comes from could not be read, so the proposal was not sent. ${STILL_HERE}`);
  });

  it("a section change whose section, or whose new place, was archived meanwhile: the form is drawn again with the sections as they are", async () => {
    const kale = await actorFor("kale@example.com");
    const casey = await actorFor("casey@example.com");
    const annuals = await sectionId("Annuals");
    const perennials = await sectionId("Perennials");
    await archiveSection(casey, annuals);
    signedIn.actor = kale;
    const changes = [
      { action: "rename", sectionId: annuals, title: "Summer annuals" },
      { action: "move", sectionId: annuals, parentId: "" },
      { action: "archive", sectionId: annuals },
    ];
    for (const change of changes) {
      const gone = await press(() => createProposalAction(structure(change)));
      expect(gone.result).toEqual({ ok: false, error: SECTION_GONE });
      expect(gone.redrawn).toBe(true);
    }
    const placeGone = await press(() => createProposalAction(structure({ action: "move", sectionId: perennials, parentId: annuals })));
    expect(placeGone.result).toEqual({ ok: false, error: "The section to move it under no longer exists. Choose where it should go." });
    expect(placeGone.redrawn).toBe(true);
    const parentGone = await press(() => createProposalAction(structure({ action: "add", parentId: annuals, title: "Petunias" })));
    expect(parentGone.result).toEqual({ ok: false, error: "The section to add it under no longer exists. Choose again." });
    expect(parentGone.redrawn).toBe(true);
    await restoreSection(casey, annuals);

    // The same on the edit page of a section change. Its section archived: the page is left as it is.
    const rename = await createProposal(kale, { kind: "structure", change: { action: "rename", sectionId: annuals, title: "Summer annuals" } });
    const move = await createProposal(kale, { kind: "structure", change: { action: "move", sectionId: perennials, parentId: annuals } });
    await archiveSection(casey, annuals);
    const renameGone = await press(() => editProposalAction(rename, structure({ action: "rename", sectionId: annuals, title: "Annuals and herbs" })));
    expect(renameGone.result).toEqual({ ok: false, error: SECTION_GONE });
    expect(renameGone.redrawn).toBe(false);
    // The place it would move under archived: the edit page is drawn again, without that place.
    const moveGone = await press(() => editProposalAction(move, structure({ action: "move", sectionId: perennials, parentId: annuals })));
    expect(moveGone.result).toEqual({ ok: false, error: "The section to move it under no longer exists. Choose where it should go." });
    expect(moveGone.redrawn).toBe(true);
    await restoreSection(casey, annuals);
    await withdrawProposal(kale, rename);
    await withdrawProposal(kale, move);
  });

  it("an edit of a proposal that was approved or withdrawn meanwhile, or that cannot be found: what was typed is still there to copy", async () => {
    const kale = await actorFor("kale@example.com");
    const casey = await actorFor("casey@example.com");
    const houseplants = await sectionId("Houseplants");
    const hardGoods = await sectionId("Hard Goods");
    const make = (section: string, title: string) =>
      createProposal(kale, { kind: "decision", sectionId: section, title, proposedOfficial: doc(`${title}.`) });
    signedIn.actor = kale;

    const approved = await make(houseplants, "Water on Mondays");
    await approveProposal(casey, approved, { revision: 1, currentVersionId: null });
    const afterApproval = await press(() => editProposalAction(approved, editForm(houseplants, "Water on Tuesdays."), { currentVersionId: null }));
    expect(afterApproval.result).toEqual({
      ok: false,
      error: `This proposal has already been approved, so it can no longer be changed. ${STILL_HERE}`,
    });
    expect(afterApproval.redrawn).toBe(false);

    // Withdrawn from his other device while this edit page was open.
    const withdrawn = await make(hardGoods, "Carry hose reels");
    await withdrawProposal(kale, withdrawn);
    const afterWithdrawal = await press(() => editProposalAction(withdrawn, editForm(hardGoods, "Carry two hose reels."), { currentVersionId: null }));
    expect(afterWithdrawal.result).toEqual({
      ok: false,
      error: `This proposal has already been withdrawn, so it can no longer be changed. ${STILL_HERE}`,
    });
    expect(afterWithdrawal.redrawn).toBe(false);

    // An address that looks like a proposal's and is not one.
    const unknown = await press(() =>
      editProposalAction("00000000-0000-4000-8000-000000000000", editForm(hardGoods, "Carry two hose reels."), { currentVersionId: null }),
    );
    expect(unknown.result).toEqual({ ok: false, error: NO_SUCH_PROPOSAL });
    expect(unknown.redrawn).toBe(false);
  });

  it("a form that cannot be read, or a person who is signed out, on either form", async () => {
    const kale = await actorFor("kale@example.com");
    const quotes = await sectionId("Quotes");
    const id = await createProposal(kale, { kind: "decision", sectionId: quotes, title: "Three quotes", proposedOfficial: doc("Get three quotes.") });
    signedIn.actor = kale;
    const unreadable = [
      () => createProposalAction(newForm(quotes, "Get two quotes.", null, { why: 7 })),
      () => createProposalAction(newForm(quotes, "Get two quotes.", null, { baseVersionId: "not-a-version" })),
      () => createProposalAction(newForm(quotes, "Get two quotes.", null, { noteIds: "not-a-list" })),
      () => editProposalAction(id, "not a form", { currentVersionId: null }),
      () => editProposalAction(id, editForm(quotes, "Get two quotes."), "not what a page saw"),
      () => editProposalAction(id, editForm(quotes, "Get two quotes."), { currentVersionId: "not-a-version" }),
    ];
    for (const work of unreadable) expect((await press(work)).result).toEqual({ ok: false, error: FORM_UNREADABLE });
    expect((await asSystem((db) => loadProposal(db, id)))?.revision).toBe(1);

    signedIn.actor = null;
    const signedOut = await press(() => editProposalAction(id, editForm(quotes, "Get two quotes."), { currentVersionId: null }));
    expect(signedOut.result).toEqual({ ok: false, error: SIGNED_OUT });
    expect(signedOut.redrawn).toBe(false);
    await withdrawProposal(kale, id);
  });
});

describe("what runs after a refusal", () => {
  it("only after a refusal, with the signed-in person, and a mishap in it never hides the reason", async () => {
    const kale = await actorFor("kale@example.com");
    signedIn.actor = kale;
    const seen: string[] = [];
    const note = async (actor: Actor) => {
      seen.push(actor.name);
    };
    // It went through: nothing runs.
    expect(await runAction(async () => "Saved.", note)).toEqual({ ok: true, message: "Saved." });
    expect(seen).toEqual([]);
    // Refused in plain words, and failed in a way nobody expected: both count.
    expect(
      await runAction(async () => {
        throw new AppError("Enter a name for the section.");
      }, note),
    ).toEqual({ ok: false, error: "Enter a name for the section." });
    expect(
      await runAction(async () => {
        throw new Error("something nobody expected");
      }, note),
    ).toEqual({ ok: false, error: "Something went wrong and nothing was saved. Please try again." });
    expect(seen).toEqual(["Kale", "Kale"]);
    // Whatever goes wrong while drawing again, the person still reads why they were refused.
    expect(
      await runAction(
        async () => {
          throw new AppError("Enter a name for the section.");
        },
        async () => {
          throw new Error("the page could not be drawn again");
        },
      ),
    ).toEqual({ ok: false, error: "Enter a name for the section." });
    // Signed out: there is nobody to draw a page for.
    signedIn.actor = null;
    expect((await runAction(async () => "Saved.", note)).ok).toBe(false);
    expect(seen).toEqual(["Kale", "Kale"]);
  });
});
