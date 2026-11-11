import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeftIcon } from "@/components/icons";
import { requirePermission } from "@/lib/auth/session";
import { listActivity } from "@/lib/activity";
import { formatDateTime } from "@/lib/time";

export const metadata: Metadata = { title: "Activity log" };

/**
 * How many rows one page shows: 50. (The browser test sets
 * ACTIVITY_PAGE_SIZE to a smaller number, so it can turn the page without
 * making 50 changes first.)
 */
function pageSize(): number {
  const asked = Number(process.env.ACTIVITY_PAGE_SIZE);
  return Number.isInteger(asked) && asked >= 1 && asked <= 200 ? asked : 50;
}

/**
 * The activity log: every change, who made it and when, newest first.
 * Read-only, Owners only. Like Settings it opens as its own page, without
 * the sidebar, with a Back button.
 */
export default async function ActivityLogPage({
  searchParams,
}: {
  searchParams: Promise<{ before?: string | string[] }>;
}) {
  const user = await requirePermission("settings");
  const asked = (await searchParams).before;
  // `before` is the number of the last row on the page before this one.
  const before = typeof asked === "string" && /^\d{1,15}$/.test(asked) ? Number(asked) : undefined;
  const { rows, more } = await listActivity(user, { before, limit: pageSize() });
  const last = rows.at(-1);

  return (
    <main className="plain-page">
      <Link href="/settings" className="btn back-link">
        <ArrowLeftIcon size={18} /> Back
      </Link>
      <h1>Activity log</h1>
      <p className="meta">Every change, who made it and when. Newest first.</p>

      {rows.length === 0 ? (
        <p className="muted" style={{ marginTop: 20 }}>
          {before ? "Nothing older than this." : "Nothing has been recorded yet."}
        </p>
      ) : (
        <ul className="activity-list" aria-label="Activity" style={{ marginTop: 20 }}>
          {rows.map((row) => (
            <li key={row.id}>
              <p className="byline">
                {formatDateTime(row.at)} · <span className="who">{row.userName ?? "The app"}</span>
              </p>
              <p>{row.summary}</p>
            </li>
          ))}
        </ul>
      )}

      {(before !== undefined || (more && last)) && (
        <nav className="pager" aria-label="Pages">
          {before !== undefined && <Link href="/settings/activity">Newest</Link>}
          {more && last && <Link href={`/settings/activity?before=${last.id}`}>Older</Link>}
        </nav>
      )}
    </main>
  );
}
