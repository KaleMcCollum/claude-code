import type { Queryable } from "@/db/client";
import { activityLog } from "@/db/schema";

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
