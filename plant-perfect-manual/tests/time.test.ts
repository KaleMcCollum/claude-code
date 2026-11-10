import { describe, expect, it } from "vitest";
import {
  addDays,
  centralDateKey,
  daysBetween,
  formatDate,
  formatDateKey,
  formatDateKeyLong,
  formatTime,
  isDateKey,
} from "@/lib/time";

describe("dates are in US Central time", () => {
  it("puts a late-evening moment on the right calendar day", () => {
    // 03:30 UTC on Nov 13 is 9:30 PM on Nov 12 in Fargo (winter, UTC-6).
    const evening = new Date("2026-11-13T03:30:00Z");
    expect(centralDateKey(evening)).toBe("2026-11-12");
    expect(formatDate(evening)).toBe("Nov 12, 2026");
    expect(formatTime(evening)).toBe("9:30 PM");
    // In summer the offset is UTC-5.
    expect(centralDateKey(new Date("2026-07-01T04:30:00Z"))).toBe("2026-06-30");
    expect(centralDateKey(new Date("2026-07-01T05:30:00Z"))).toBe("2026-07-01");
  });

  it("does day arithmetic on date keys, across months, years and clock changes", () => {
    expect(addDays("2026-11-10", 1)).toBe("2026-11-11");
    expect(addDays("2026-11-01", -1)).toBe("2026-10-31");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2027-03-13", 2)).toBe("2027-03-15");
    expect(daysBetween("2026-11-10", "2027-03-01")).toBe(111);
    expect(daysBetween("2027-03-01", "2026-11-10")).toBe(-111);
    expect(daysBetween("2026-11-10", "2026-11-10")).toBe(0);
  });

  it("formats date keys without shifting the day", () => {
    expect(formatDateKeyLong("2026-11-10")).toBe("Tuesday, November 10, 2026");
    expect(formatDateKey("2027-03-01")).toBe("Mar 1, 2027");
  });

  it("recognises real date keys only", () => {
    expect(isDateKey("2026-11-10")).toBe(true);
    expect(isDateKey("2026-02-30")).toBe(false);
    expect(isDateKey("2026-13-01")).toBe(false);
    expect(isDateKey("11/10/2026")).toBe(false);
    expect(isDateKey("today")).toBe(false);
    expect(isDateKey(undefined)).toBe(false);
  });
});
