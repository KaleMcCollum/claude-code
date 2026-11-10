"use client";

import { useActionState, useEffect, useRef } from "react";
import { type ConfirmState, confirmLoginAction } from "@/app/login/actions";

const initial: ConfirmState = { status: "idle" };

/**
 * The link in the email opens this page, and the page then signs in by
 * itself. The extra step matters: some email services open every link in a
 * message to scan it, which would otherwise use up the one-time link before
 * the person ever clicks it.
 */
export function ConfirmForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(confirmLoginAction, initial);
  const formRef = useRef<HTMLFormElement>(null);
  const submitted = useRef(false);

  useEffect(() => {
    if (submitted.current) return;
    submitted.current = true;
    formRef.current?.requestSubmit();
  }, []);

  if (state.status === "failed") {
    return (
      <div>
        <h1>This link no longer works</h1>
        <p>Sign-in links work once and expire after 15 minutes.</p>
        <p>
          <a className="btn btn-primary" href="/login">
            Get a new link
          </a>
        </p>
      </div>
    );
  }

  return (
    <form ref={formRef} action={action}>
      <h1>Signing you in</h1>
      <p className="muted">One moment. If nothing happens, press the button.</p>
      <input type="hidden" name="token" value={token} />
      <button className="btn btn-primary" type="submit" disabled={pending}>
        Sign in
      </button>
    </form>
  );
}
