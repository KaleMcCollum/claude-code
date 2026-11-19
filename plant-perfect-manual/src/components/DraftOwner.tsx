"use client";

import { createContext, useContext } from "react";

/**
 * Whose unsaved text this browser is keeping right now: the signed-in
 * person's id. The app's layout says it once, around every signed-in page,
 * and the pieces that keep a copy of what is being typed (official text, a
 * proposal's text, a note, a comment) read it to build their keys (see
 * src/lib/drafts.ts). A copy is only ever offered to the person who typed it.
 */
const DraftOwnerContext = createContext<string | null>(null);

export function DraftOwner({ userId, children }: { userId: string; children: React.ReactNode }) {
  return <DraftOwnerContext.Provider value={userId}>{children}</DraftOwnerContext.Provider>;
}

/** The signed-in person's id, for the keys of the copies kept on this device. */
export function useDraftOwner(): string {
  const owner = useContext(DraftOwnerContext);
  // Never fall back to a key shared by everyone: that is how one person
  // would be offered another person's words.
  if (!owner) throw new Error("A piece that keeps unsaved text was drawn outside the signed-in pages.");
  return owner;
}
