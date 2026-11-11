import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { asSystem } from "@/db/client";
import { sections } from "@/db/schema";
import { loadOfficial, saveOfficial } from "@/lib/official";
import { type Actor, AppError } from "@/lib/permissions";
import type { RichDoc } from "@/lib/richtext";
import { actorFor, withRealTimeOnly, withTestDatabase } from "./helpers/db";

/**
 * `runAction` is what every button and form goes through. It needs a
 * signed-in person from the browser's cookie and tells the framework to
 * refresh the screens afterwards; neither exists in a test, so those two
 * are stood in for here. Everything else is the real thing, database included.
 */
const signedIn: { actor: Actor | null } = { actor: null };
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: async () => signedIn.actor }));

const { CLOCK_IS_OFF, runAction } = await import("@/lib/actions");

withTestDatabase();

const doc = (text: string): RichDoc => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

describe("what a person is told when an action fails", () => {
  let errors: unknown[][];
  beforeEach(() => {
    errors = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args);
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("the clock message, when the database refuses a time", async () => {
    signedIn.actor = await actorFor("kale@example.com");
    const [wages] = await asSystem((db) => db.select().from(sections).where(eq(sections.title, "Wages")));
    // The app's clock says it is 2020. The database knows better and refuses the record.
    const wrongClock = new Date("2020-01-01T15:00:00Z");
    const result = await withRealTimeOnly(() =>
      runAction(async (actor) => {
        await saveOfficial(actor, wages.id, doc("Starting wage: $15.00/hr."), { now: wrongClock });
      }),
    );
    expect(result).toEqual({
      ok: false,
      error:
        "Nothing was saved, because the clock on the computer that runs this app is more than an hour off. Whoever looks after the app needs to fix that.",
    });
    expect(CLOCK_IS_OFF).toBe((result as { error: string }).error);
    expect(await asSystem((db) => loadOfficial(db, wages.id))).toBeNull();
    // It is also written down for whoever looks after the app.
    expect(errors).toHaveLength(1);

    // With the right time the same action goes through.
    const fine = await withRealTimeOnly(() =>
      runAction(async (actor) => {
        await saveOfficial(actor, wages.id, doc("Starting wage: $15.00/hr."));
        return "Saved.";
      }),
    );
    expect(fine).toEqual({ ok: true, message: "Saved." });
  });

  it("its own plain message, the general one for anything unexpected, and to sign in again", async () => {
    signedIn.actor = await actorFor("kale@example.com");
    expect(
      await runAction(async () => {
        throw new AppError("Enter a name for the section.");
      }),
    ).toEqual({ ok: false, error: "Enter a name for the section." });
    expect(errors).toHaveLength(0);
    expect(
      await runAction(async () => {
        throw new Error("something nobody expected");
      }),
    ).toEqual({ ok: false, error: "Something went wrong and nothing was saved. Please try again." });
    expect(errors).toHaveLength(1);
    signedIn.actor = null;
    expect(await runAction(async () => "Saved.")).toEqual({
      ok: false,
      error: "You have been signed out. Reload the page and sign in again.",
    });
  });
});
