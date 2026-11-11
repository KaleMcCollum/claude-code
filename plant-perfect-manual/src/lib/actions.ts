import "server-only";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "./auth/session";
import { type Actor, AppError } from "./permissions";

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
 */
export async function runAction<T = never>(
  work: (actor: Actor) => Promise<string | void | { message?: string; data: T }>,
): Promise<ActionResult<T>> {
  const actor = await getCurrentUser();
  if (!actor) {
    return { ok: false, error: "You have been signed out. Reload the page and sign in again." };
  }
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
    if (error instanceof AppError) return { ok: false, error: error.message };
    console.error(error);
    return { ok: false, error: "Something went wrong and nothing was saved. Please try again." };
  }
}
