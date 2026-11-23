"use client";

import { useEffect } from "react";

/** Where the pages of one browser tell each other who they were drawn for. */
const KEY = "ppf:signed-in";

/**
 * One browser holds one sign-in, shared by every page of the app that is
 * open in it. A page that was drawn for one person must not go on showing
 * their name, or offering their unsaved text, after someone else has signed
 * in from another page of the same browser: whatever was saved from it
 * would be recorded under the other person's name.
 *
 * So every signed-in page says who it was drawn for each time it is loaded
 * (the person's id, in the browser's shared storage), hears when another
 * page says someone else, and then loads itself again, once: the page that
 * comes back is drawn for the person who is signed in now, says so, and
 * agrees with the others. A second page opened by the same person changes
 * nothing. Nothing is done at sign-out.
 *
 * A browser that blocks this storage tells the pages nothing, and then
 * nothing here happens at all.
 */
export function SamePerson({ userId }: { userId: string }) {
  useEffect(() => {
    const check = () => {
      try {
        const now = window.localStorage.getItem(KEY);
        if (now !== null && now !== userId) window.location.reload();
      } catch {
        // Storage is blocked: there is nothing to compare with.
      }
    };
    try {
      window.localStorage.setItem(KEY, userId);
    } catch {
      // Storage is blocked.
    }
    const heard = (event: StorageEvent) => {
      if (event.key === KEY) check();
    };
    window.addEventListener("storage", heard);
    // A page the browser had put to sleep hears nothing: it looks again when it is shown.
    window.addEventListener("pageshow", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.removeEventListener("storage", heard);
      window.removeEventListener("pageshow", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [userId]);
  return null;
}
