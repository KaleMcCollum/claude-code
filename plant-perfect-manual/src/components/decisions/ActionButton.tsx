"use client";

import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/actions";

/** Shown when a request never reached the app (for example no phone signal). */
const NOT_SENT = "That did not go through. Check your connection and try again.";

type Props = {
  /** The words on the button. */
  label: string;
  /** Says which thing the button is for, where the same label repeats on a page. */
  ariaLabel?: string;
  /** "primary": the main button. "plain": an ordinary button. "quiet": text only. */
  look?: "primary" | "plain" | "quiet";
  /** The change to make. Its answer says whether it worked. */
  action: () => Promise<ActionResult<unknown>>;
  /** Ask first, in place, before doing it. */
  confirm?: { question: string; yes: string; no: string };
  /** Called after it worked, with the message the app sent back (if any). */
  onDone?: (message: string | null) => void;
};

const LOOKS = { primary: "btn btn-primary", plain: "btn", quiet: "btn-text" };

/**
 * One button that makes a change: I approve too, Endorse, Withdraw, Approve
 * on my own, Restore. It grays out while the change is on its way, can ask
 * "are you sure?" right where it stands, and shows a refusal in place.
 */
export function ActionButton({ label, ariaLabel, look = "plain", action, confirm, onDone }: Props) {
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, startWork] = useTransition();

  const run = () => {
    startWork(async () => {
      let result: ActionResult<unknown>;
      try {
        result = await action();
      } catch {
        result = { ok: false, error: NOT_SENT };
      }
      if (result.ok) {
        setError(null);
        setAsking(false);
        onDone?.(result.message ?? null);
      } else {
        setError(result.error);
      }
    });
  };

  const problem = error && (
    <p className="notice error action-error" role="alert">
      {error}
    </p>
  );

  if (confirm && asking) {
    return (
      <div className="action-confirm" role="group" aria-label={ariaLabel ?? label}>
        <p>{confirm.question}</p>
        <div className="row">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={run}>
            {confirm.yes}
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => {
              setError(null);
              setAsking(false);
            }}
          >
            {confirm.no}
          </button>
        </div>
        {problem}
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        className={LOOKS[look]}
        aria-label={ariaLabel}
        disabled={busy}
        onClick={() => {
          setError(null);
          if (confirm) setAsking(true);
          else run();
        }}
      >
        {label}
      </button>
      {problem}
    </>
  );
}
