import type { Metadata } from "next";
import { NotBuiltYet } from "@/components/NotBuiltYet";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Proposals" };

export default async function Page() {
  await requireUser();
  return (
    <NotBuiltYet title="Proposals" phase="phase 3 (Decisions)">
      Decisions, structure changes and official wording will be proposed here, then approved by one or both Owners. The Decisions Log will live here too.
    </NotBuiltYet>
  );
}
