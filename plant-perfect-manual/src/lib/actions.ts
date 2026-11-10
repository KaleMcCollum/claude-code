import "server-only";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "./auth/session";
import { type Actor, AppError } from "./permissions";

/** What every form or button action sends back to the screen. */
export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

/**
 * Wrapper for every change made from the screen: checks the person is still
 * signed in, turns expected problems into a plain message, and refreshes
 * every page (the sidebar included) after a successful change.
 */
export async function runAction(
  work: (actor: Actor) => Promise<string | void>,
): Promise<ActionResult> {
  const actor = await getCurrentUser();
  if (!actor) {
    return { ok: false, error: "You have been signed out. Reload the page and sign in again." };
  }
  try {
    const message = await work(actor);
    revalidatePath("/", "layout");
    return message ? { ok: true, message } : { ok: true };
  } catch (error) {
    if (error instanceof AppError) return { ok: false, error: error.message };
    console.error(error);
    return { ok: false, error: "Something went wrong and nothing was saved. Please try again." };
  }
}
