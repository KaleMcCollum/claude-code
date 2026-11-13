/**
 * What someone who can approve is asked, in place, before their endorsement
 * is recorded (on a proposal's page and under official text). Endorsing
 * cannot be undone and is not a softer kind of approval, so they are told.
 * Advisors, who cannot approve, endorse with one tap.
 */
export const ENDORSE_QUESTION = {
  question: "Endorse this? It adds your name in support. It does not approve it, and it cannot be taken back.",
  yes: "Endorse",
  no: "Cancel",
};
