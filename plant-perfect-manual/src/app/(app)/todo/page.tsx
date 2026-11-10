import type { Metadata } from "next";
import { NotBuiltYet } from "@/components/NotBuiltYet";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "To-do" };

export default async function Page() {
  await requireUser();
  return (
    <NotBuiltYet title="To-do" phase="phase 4 (Operations records)">
      To-dos with an owner, due date and status, linked to the section and note they came from.
    </NotBuiltYet>
  );
}
