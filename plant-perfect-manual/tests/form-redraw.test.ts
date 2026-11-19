import { beforeEach, describe, expect, it, vi } from "vitest";
import { asSystem } from "@/db/client";
import { loadOfficial, saveOfficial } from "@/lib/official";
import { type Actor, AppError } from "@/lib/permissions";
import { createProposal, declineProposal, endorseProposal, loadProposal } from "@/lib/proposals";
import type { RichDoc } from "@/lib/richtext";
import { archiveSection, flattenTree, loadTree } from "@/lib/sections";
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
 * The framework's "draw this page again" is stood in for by a counter here,
 * as are the signed-in person and the refresh after a successful change.
 * Everything else is the real thing, database included. The browser tests
 * (e2e/phase3.cjs, part 21) check what the person then sees.
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

/** Run one press of the form's button; hand back the answer and whether the page was drawn again. */
async function press<T>(work: () => Promise<T>): Promise<{ result: T; redrawn: boolean }> {
  redraws.count = 0;
  const result = await work();
  return { result, redrawn: redraws.count > 0 };
}

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
        "The official text of this section changed while you were writing. Nothing you typed is lost. The new official text is now shown on this page: choose whether to start over from it or keep what you typed, then propose again.",
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
    expect(unreadable.result.ok).toBe(false);
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
    expect(gone.result).toEqual({ ok: false, error: "That section no longer exists. Reload the page and choose again." });
    expect(gone.redrawn).toBe(false);
    // The same for a section the form could never have had.
    const nonsense = await press(() => createProposalAction(newForm("not-a-section", "One sign.", null)));
    expect(nonsense.result.ok).toBe(false);
    expect(nonsense.redrawn).toBe(false);
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
    expect(signedOut.result).toEqual({ ok: false, error: "You have been signed out. Reload the page and sign in again." });
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
        "The official text of this section changed while you had this page open. Nothing you typed is lost. The new official text is now shown on this page: read it, then save again.",
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
      error: "This proposal has already been declined. Reload the page to see it.",
    });
    expect(afterDecline.redrawn).toBe(false);

    // Its section archived.
    const archived = await make("Vendor Contacts");
    await archiveSection(casey, archived.section);
    const afterArchive = await press(() => editProposalAction(archived.id, archived.form, { currentVersionId: null }));
    expect(afterArchive.result.ok).toBe(false);
    expect(afterArchive.redrawn).toBe(false);

    // Not a proposal at all, and somebody else's proposal.
    const nonsense = await press(() => editProposalAction("nonsense", archived.form, { currentVersionId: null }));
    expect([nonsense.result.ok, nonsense.redrawn]).toEqual([false, false]);
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
