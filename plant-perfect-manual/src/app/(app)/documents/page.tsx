import type { Metadata } from "next";
import { NotBuiltYet } from "@/components/NotBuiltYet";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Documents" };

export default async function Page() {
  await requireUser();
  return (
    <NotBuiltYet title="Documents" phase="phase 4 (Operations records)">
      Every uploaded file in one list, with sorting, search and previews for PDFs and images.
    </NotBuiltYet>
  );
}
