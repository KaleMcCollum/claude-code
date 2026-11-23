import "server-only";
import { revalidatePath } from "next/cache";
import { sqlState } from "@/db/client";
import { getCurrentUser } from "./auth/session";
import { type Actor, AppError } from "./permissions";

/**
 * The database's own error code (SQLSTATE) for "the time on this record is
 * not the current time" (see `recent_time_only` in drizzle/0009). The app
 * stamps every record with its own clock, so in normal use this can only
 * mean that the clock of the computer running the app is far off.
 */
const NOT_THE_CURRENT_TIME = "PPF02";
export const CLOCK_IS_OFF =
  "Nothing was saved, because the clock on the computer that runs this app is more than an hour off. Whoever looks after the app needs to fix that.";

/**
 * What every button in the app answers when the person is no longer signed
 * in. It never asks for a reload: on a form, that would lose what was
 * typed. Signing in again in a new tab of the same browser signs this page
 * in as well, and the same press then goes through.
 */
export const SIGNED_OUT =
  "You have been signed out, so this was not saved. To keep what you typed, leave this page open, sign in again in a new browser tab, then come back to this page and press the button again.";

/**
 * What every form or button action sends back to the screen. A few actions
 * also hand back a small piece of `data` (for example the day a new note was
 * saved to).
 */
export type ActionResult<T = never> =
  | { ok: true; message?: string; data?: T }
  | { ok: false; error: string };

/**
 * Wrapper for every change made from the screen: checks the person is still
 * signed in, turns expected problems into a plain message, and refreshes
 * every page (the sidebar included) after a successful change.
 *
 * `work` may return nothing, a message for the person, or `{ data }` for the
 * screen that asked.
 *
 * `afterRefusal` runs when the change did not go through, for whatever
 * reason, while the person is still signed in. The proposal form uses it to
 * have its page drawn again in place (see `redrawFormPage` in the proposal
 * actions). Whatever goes wrong inside it is ignored: the person still gets
 * the reason the change was refused.
 */
export async function runAction<T = never>(
  work: (actor: Actor) => Promise<string | void | { message?: string; data: T }>,
  afterRefusal?: (actor: Actor) => Promise<void>,
): Promise<ActionResult<T>> {
  const actor = await getCurrentUser();
  if (!actor) return { ok: false, error: SIGNED_OUT };
  const refused = async (error: string): Promise<ActionResult<T>> => {
    try {
      await afterRefusal?.(actor);
    } catch (problem) {
      console.error(problem);
    }
    return { ok: false, error };
  };
  try {
    const outcome = await work(actor);
    revalidatePath("/", "layout");
    if (typeof outcome === "string") return outcome ? { ok: true, message: outcome } : { ok: true };
    if (outcome) {
      return outcome.message
        ? { ok: true, message: outcome.message, data: outcome.data }
        : { ok: true, data: outcome.data };
    }
    return { ok: true };
  } catch (error) {
    if (error instanceof AppError) return refused(error.message);
    console.error(error);
    if (sqlState(error) === NOT_THE_CURRENT_TIME) return refused(CLOCK_IS_OFF);
    return refused("Something went wrong and nothing was saved. Please try again.");
  }
}
