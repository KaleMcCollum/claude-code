import { type Queryable, asUser } from "@/db/client";
import { settings } from "@/db/schema";
import { logActivity } from "./activity";
import { type Actor, AppError, assertCan } from "./permissions";
import { formatDateKey, isDateKey } from "./time";

/** Things Owners can change on the Settings page. */
export type AppSettings = {
  /** Target opening day, e.g. "2027-03-01". Drives the countdown on Today. */
  openingDate: string;
  /** A section counts as stale after this many days without an update. */
  staleDays: number;
};

export const DEFAULT_SETTINGS: AppSettings = { openingDate: "2027-03-01", staleDays: 30 };

const MIN_STALE_DAYS = 1;
const MAX_STALE_DAYS = 365;

function validStaleDays(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_STALE_DAYS &&
    value <= MAX_STALE_DAYS
  );
}

/** Current settings. Anything not yet set (or unreadable) uses its default. */
export async function loadSettings(q: Queryable): Promise<AppSettings> {
  const rows = await q.select({ key: settings.key, value: settings.value }).from(settings);
  const stored = new Map(rows.map((row) => [row.key, row.value]));
  const openingDate = stored.get("opening_date");
  const staleDays = stored.get("stale_days");
  return {
    openingDate: isDateKey(openingDate) ? openingDate : DEFAULT_SETTINGS.openingDate,
    staleDays: validStaleDays(staleDays) ? staleDays : DEFAULT_SETTINGS.staleDays,
  };
}

export async function saveSettings(
  actor: Actor,
  input: { openingDate: unknown; staleDays: unknown },
): Promise<{ changed: boolean }> {
  assertCan(actor, "settings");
  if (!isDateKey(input.openingDate)) throw new AppError("Choose the opening date.");
  const staleDays = typeof input.staleDays === "string" ? Number(input.staleDays) : input.staleDays;
  if (!validStaleDays(staleDays)) {
    throw new AppError(
      `Enter a whole number of days between ${MIN_STALE_DAYS} and ${MAX_STALE_DAYS}.`,
    );
  }
  const next: AppSettings = { openingDate: input.openingDate, staleDays };

  return asUser(actor.id, async (tx) => {
    const current = await loadSettings(tx);
    const now = new Date();
    const changes: { key: string; value: unknown; summary: string }[] = [];
    if (current.openingDate !== next.openingDate) {
      changes.push({
        key: "opening_date",
        value: next.openingDate,
        summary: `Changed the opening date to ${formatDateKey(next.openingDate)}`,
      });
    }
    if (current.staleDays !== next.staleDays) {
      changes.push({
        key: "stale_days",
        value: next.staleDays,
        summary: `Changed when sections count as stale to ${next.staleDays} days`,
      });
    }
    for (const change of changes) {
      await tx
        .insert(settings)
        .values({ key: change.key, value: change.value, updatedAt: now, updatedBy: actor.id })
        .onConflictDoUpdate({
          target: settings.key,
          set: { value: change.value, updatedAt: now, updatedBy: actor.id },
        });
      await logActivity(tx, actor.id, {
        action: "setting.changed",
        entityType: "setting",
        entityId: change.key,
        summary: change.summary,
        data: { key: change.key, value: change.value },
      });
    }
    return { changed: changes.length > 0 };
  });
}
