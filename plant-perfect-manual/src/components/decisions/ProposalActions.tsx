"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import {
  addApprovalAction,
  approveAloneAction,
  approveProposalAction,
  declineProposalAction,
  endorseProposalAction,
  withdrawProposalAction,
} from "@/app/(app)/proposals/actions";
import type { ActionResult } from "@/lib/actions";
import { ActionButton } from "./ActionButton";

type Props = {
  proposalId: string;
  /**
   * What this page showed when it was drawn: the proposal's revision and, for
   * a change to official text, the official version it was compared with.
   * Sent back with every button, so nobody approves words they did not see.
   */
  seen: { revision: number; currentVersionId?: string | null };
  /** Which buttons this person may use. Anything else is not drawn at all. */
  show: {
    approve: boolean;
    alone: boolean;
    decline: boolean;
    edit: boolean;
    withdraw: boolean;
    endorse: boolean;
    approveToo: boolean;
  };
  /** The other people who can approve ("Casey"), or "" when there is nobody else. */
  otherApprovers: string;
};

const NOT_SENT = "That did not go through. Check your connection and try again.";

/**
 * The buttons on a proposal's page. Everything happens in place: a question
 * or the reason field opens where the button was, and a refusal from the
 * app is shown right there.
 */
export function ProposalActions({ proposalId, seen, show, otherApprovers }: Props) {
  // What the app said after the last button that worked ("Approved. It is official now.").
  const [message, setMessage] = useState<string | null>(null);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, startWork] = useTransition();

  const anything = Object.values(show).some(Boolean);
  if (!anything && !message) return null;

  const run = (work: () => Promise<ActionResult<unknown>>, after?: () => void) => {
    startWork(async () => {
      let result: ActionResult<unknown>;
      try {
        result = await work();
      } catch {
        result = { ok: false, error: NOT_SENT };
      }
      if (result.ok) {
        setError(null);
        setMessage(result.message ?? null);
        after?.();
      } else {
        setMessage(null);
        setError(result.error);
      }
    });
  };

  return (
    <section className="proposal-actions" aria-label="Actions">
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}

      {declining ? (
        <form
          className="action-confirm"
          aria-label="Decline this proposal"
          onSubmit={(event) => {
            event.preventDefault();
            run(
              () => declineProposalAction(proposalId, reason),
              () => setDeclining(false),
            );
          }}
        >
          <label className="field">
            <span>Reason (optional)</span>
            <input
              className="input"
              type="text"
              value={reason}
              maxLength={500}
              autoComplete="off"
              autoFocus
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <div className="row">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              Decline proposal
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => {
                setError(null);
                setDeclining(false);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        anything && (
          <div className="actions">
            {show.approve && (
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() => run(() => approveProposalAction(proposalId, seen))}
              >
                Approve
              </button>
            )}
            {show.alone && (
              <ActionButton
                label="Approve on my own"
                action={() => approveAloneAction(proposalId, seen)}
                confirm={{
                  question: otherApprovers
                    ? `Make this official now with only your approval? ${otherApprovers} will see it flagged on Today.`
                    : "Make this official now with only your approval?",
                  yes: "Approve on my own",
                  no: "Cancel",
                }}
                onDone={(text) => {
                  setError(null);
                  setMessage(text);
                }}
              />
            )}
            {show.approveToo && (
              <ActionButton
                label="I approve too"
                look="primary"
                action={() => addApprovalAction(proposalId)}
                onDone={() => setMessage(null)}
              />
            )}
            {show.decline && (
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => {
                  setError(null);
                  setDeclining(true);
                }}
              >
                Decline
              </button>
            )}
            {show.edit && (
              <Link className="btn" href={`/proposals/${proposalId}/edit`}>
                Edit
              </Link>
            )}
            {show.withdraw && (
              <ActionButton
                label="Withdraw"
                action={() => withdrawProposalAction(proposalId)}
                confirm={{
                  question: "Withdraw this proposal? Nothing will change.",
                  yes: "Withdraw proposal",
                  no: "Keep it",
                }}
                onDone={() => setMessage(null)}
              />
            )}
            {show.endorse && (
              <ActionButton
                label="Endorse"
                action={() => endorseProposalAction(proposalId, seen)}
                onDone={() => setMessage(null)}
              />
            )}
          </div>
        )
      )}

      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
