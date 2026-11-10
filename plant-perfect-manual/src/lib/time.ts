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
