import { type ProposalView, endorseQuestion } from "@/lib/proposals";

/**
 * The question and its two answers that someone who can approve gets, in
 * place, before their endorsement is recorded (on a proposal's page and
 * under official text). The question is worded by the rules layer
 * (`endorseQuestion`). Advisors, who cannot approve, endorse with one tap.
 *
 * Worked out on the server and handed to the button as plain words.
 */
export function endorseConfirm(view: Pick<ProposalView, "status" | "proposedByName">): {
  question: string;
  yes: string;
  no: string;
} {
  return { question: endorseQuestion(view), yes: "Endorse", no: "Cancel" };
}
