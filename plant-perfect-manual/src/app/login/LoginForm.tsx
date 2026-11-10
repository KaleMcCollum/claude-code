"use client";

import { useActionState } from "react";
import { type RequestLinkState, requestLinkAction } from "./actions";

const initial: RequestLinkState = { status: "idle" };

export function LoginForm() {
  const [state, action, pending] = useActionState(requestLinkAction, initial);

  if (state.status === "sent") {
    return (
      <div>
        <h1>Check your email</h1>
        <p>
          If <strong>{state.email}</strong> belongs to a user, a sign-in link is on its way.
        </p>
        <p className="muted">
          The link works once and expires in 15 minutes. It can take a minute to arrive. If you
          don&apos;t see it, check your spam folder.
        </p>
        <p>
          <a href="/login">Use a different email</a>
        </p>
      </div>
    );
  }

  return (
    <form action={action}>
      <h1>Plant Perfect Fargo</h1>
      <p className="muted">Operations manual. Sign in with your email. There is no password.</p>
      {state.status === "error" && (
        <p className="notice error" role="alert">
          {state.error}
        </p>
      )}
      <label className="field">
        <span>Email</span>
        <input
          className="input"
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          defaultValue={state.email ?? ""}
          required
          autoFocus
        />
      </label>
      <button className="btn btn-primary" type="submit" disabled={pending}>
        {pending ? "Sending" : "Email me a sign-in link"}
      </button>
    </form>
  );
}
