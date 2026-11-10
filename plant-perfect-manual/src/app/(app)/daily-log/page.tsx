import type { Metadata } from "next";
import { NotBuiltYet } from "@/components/NotBuiltYet";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Daily Log" };

export default async function Page() {
  await requireUser();
  return (
    <NotBuiltYet title="Daily Log" phase="phase 2 (Capture)">
      Each day will have its own page of notes, saved exactly as typed, with a New note button and a calendar to jump to any date.
    </NotBuiltYet>
  );
}
