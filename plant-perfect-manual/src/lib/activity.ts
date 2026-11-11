import { desc, eq, lt } from "drizzle-orm";
import { type Queryable, asUser } from "@/db/client";
import { activityLog, users } from "@/db/schema";
import { type Actor, assertCan } from "./permissions";

export type ActivityEntry = {
  action: string;
  entityType: string;
  entityId?: string | null;
  /** One plain sentence, e.g. `Renamed section "Wages" to "Pay"`. */
  summary: string;
  data?: Record<string, unknown>;
};

/** Record who did what, when. Every change in the app writes one of these. */
export async function logActivity(
  q: Queryable,
  userId: string | null,
  entry: ActivityEntry,
): Promise<void> {
  await q.insert(activityLog).values({
    userId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    summary: entry.summary,
    data: entry.data ?? null,
  });
}

export type ActivityRow = {
  id: number;
  at: Date;
  /** Who did it (empty for the app itself). */
  userName: string | null;
  summary: string;
};

/**
 * The global activity log, newest first, a page at a time. `before` is the id
 * of the last row of the previous page. Owners only (it is shown in Settings).
 */
export async function listActivity(
  actor: Actor,
  options: { before?: number; limit?: number } = {},
): Promise<{ rows: ActivityRow[]; more: boolean }> {
  assertCan(actor, "settings");
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const rows = await asUser(actor.id, (tx) =>
    tx
      .select({
        id: activityLog.id,
        at: activityLog.at,
        userName: users.name,
        summary: activityLog.summary,
      })
      .from(activityLog)
      .leftJoin(users, eq(users.id, activityLog.userId))
      .where(options.before ? lt(activityLog.id, options.before) : undefined)
      .orderBy(desc(activityLog.id))
      .limit(limit + 1),
  );
  return { rows: rows.slice(0, limit), more: rows.length > limit };
}
