import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeftIcon } from "@/components/icons";
import { asUser } from "@/db/client";
import { requirePermission } from "@/lib/auth/session";
import { formatDate, formatDateTime } from "@/lib/time";
import { loadSettings } from "@/lib/settings";
import { listRoles, listUsers } from "@/lib/users";
import { TodaySettingsPanel } from "./TodaySettingsPanel";
import { UsersPanel } from "./UsersPanel";

export const metadata: Metadata = { title: "Settings" };

/** Only go back to a page inside this app. */
function safeReturnPath(value: string | string[] | undefined): string {
  if (typeof value !== "string") return "/";
  // A single leading slash followed by ordinary path characters only.
  if (!/^\/[A-Za-z0-9\-._~/]*$/.test(value) || value.startsWith("//")) return "/";
  if (value.startsWith("/settings")) return "/";
  return value;
}

/**
 * Settings is the one screen that opens as its own page, without the
 * sidebar, with a Back button. Owners only.
 */
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string | string[] }>;
}) {
  const user = await requirePermission("manage_users");
  const backTo = safeReturnPath((await searchParams).from);
  const [users, { roles, settings }] = await Promise.all([
    listUsers(user),
    asUser(user.id, async (tx) => ({ roles: await listRoles(tx), settings: await loadSettings(tx) })),
  ]);

  return (
    <main className="plain-page">
      <Link href={backTo} className="btn back-link">
        <ArrowLeftIcon size={18} /> Back
      </Link>
      <h1>Settings</h1>

      <section className="settings-section" aria-labelledby="users-heading">
        <h2 id="users-heading">Users</h2>
        <UsersPanel
          roles={roles}
          users={users.map((row) => ({
            id: row.id,
            name: row.name,
            email: row.email,
            roleKey: row.roleKey,
            added: formatDate(row.createdAt),
            lastActive: row.lastActiveAt ? formatDateTime(row.lastActiveAt) : "Not yet signed in",
            isYou: row.id === user.id,
          }))}
        />
      </section>

      <section className="settings-section" aria-labelledby="today-heading">
        <h2 id="today-heading">Today page</h2>
        <TodaySettingsPanel openingDate={settings.openingDate} staleDays={settings.staleDays} />
      </section>

      <section className="settings-section" aria-labelledby="activity-heading">
        <h2 id="activity-heading">Activity log</h2>
        <p>
          <Link className="tap-link" href="/settings/activity">
            See every change, who made it and when
          </Link>
        </p>
      </section>

      <section className="settings-section" aria-labelledby="later-heading">
        <h2 id="later-heading">Coming in later phases</h2>
        <p className="muted">
          AI on or off, backup status, export defaults and the one-page Owner Guide will be added
          here as those parts are built.
        </p>
      </section>
    </main>
  );
}
