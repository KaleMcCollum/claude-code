/** All dates in the app are shown in US Central time. */
export const TIME_ZONE = "America/Chicago";

const dateFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  month: "short",
  day: "numeric",
  year: "numeric",
});

const dateTimeFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const longDateFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
});

/** "Nov 12, 2026" */
export function formatDate(date: Date): string {
  return dateFormat.format(date);
}

/** "Nov 12, 2026, 3:42 PM" */
export function formatDateTime(date: Date): string {
  return dateTimeFormat.format(date);
}

/** "Thursday, November 12, 2026" */
export function formatLongDate(date: Date): string {
  return longDateFormat.format(date);
}

const timeFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  hour: "numeric",
  minute: "2-digit",
});

const dateKeyFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** "3:42 PM" */
export function formatTime(date: Date): string {
  return timeFormat.format(date);
}

/**
 * A calendar day is written as a "date key": "2026-11-10". Daily Logs and
 * date filters use the day as it is in US Central time, not the server's.
 */
export function centralDateKey(date: Date = new Date()): string {
  return dateKeyFormat.format(date);
}

/**
 * True for a real calendar day written as a date key. The year 0000 is
 * refused: JavaScript has one, the database does not (its years go from 1),
 * and a date key ends up in a database query.
 */
export function isDateKey(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  if (value.startsWith("0000")) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Noon UTC on that calendar day: safe to format or do day arithmetic with. */
function dateKeyAtNoon(dateKey: string): Date {
  return new Date(`${dateKey}T12:00:00Z`);
}

/** The date key `days` after (or, if negative, before) `dateKey`. */
export function addDays(dateKey: string, days: number): string {
  const date = dateKeyAtNoon(dateKey);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (negative if `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((dateKeyAtNoon(to).getTime() - dateKeyAtNoon(from).getTime()) / 86_400_000);
}

const keyLongFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
});

const keyShortFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "short",
  day: "numeric",
  year: "numeric",
});

/** "Tuesday, November 10, 2026" for a date key. */
export function formatDateKeyLong(dateKey: string): string {
  return keyLongFormat.format(dateKeyAtNoon(dateKey));
}

/** "Nov 10, 2026" for a date key. */
export function formatDateKey(dateKey: string): string {
  return keyShortFormat.format(dateKeyAtNoon(dateKey));
}
