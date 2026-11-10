import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { formatLongDate } from "@/lib/time";

export const metadata: Metadata = { title: "Today" };

export default async function TodayPage() {
  const user = await requireUser();
  return (
    <>
      <div className="page-head">
        <h1>Today</h1>
        <p className="meta">{formatLongDate(new Date())}</p>
      </div>
      <p>Hi {user.name}.</p>
      <p className="muted">
        This page will show today&apos;s to-dos, upcoming deadlines, proposals waiting for approval,
        unsorted notes and the opening countdown. Those parts are built in phases 2 to 4. For now,
        the manual sections on the left are ready to use.
      </p>
    </>
  );
}
