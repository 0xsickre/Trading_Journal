import { describe, expect, it } from "vitest";
import {
  addWeeksToWeekStart,
  defaultWeekStart,
  emptyWeeklyReview,
  formatWeekRange,
  isWeekComplete,
  weekDayKeys,
  weekEndOfWeekStart,
  weekStartOfDayKey,
} from "./weekly-review";

// 2026-01-05 is a Monday; 2026-01-11 the Sunday that closes that week.
const MON = "2026-01-05";

describe("weekStartOfDayKey", () => {
  it("returns the Monday for every day of the week", () => {
    for (const [day, expected] of [
      ["2026-01-05", MON], // Mon
      ["2026-01-08", MON], // Thu
      ["2026-01-11", MON], // Sun — ISO puts Sunday at the END of its week
    ] as const) {
      expect(weekStartOfDayKey(day)).toBe(expected);
    }
  });

  it("crosses a month boundary backwards", () => {
    // Fri 2026-01-02 belongs to the week that began Mon 2025-12-29.
    expect(weekStartOfDayKey("2026-01-02")).toBe("2025-12-29");
  });

  it("returns empty for a key it cannot parse, not a plausible wrong week", () => {
    expect(weekStartOfDayKey("not-a-day")).toBe("");
    expect(weekStartOfDayKey("")).toBe("");
  });
});

describe("week arithmetic", () => {
  it("ends on the Sunday", () => {
    expect(weekEndOfWeekStart(MON)).toBe("2026-01-11");
  });

  it("shifts whole weeks in both directions", () => {
    expect(addWeeksToWeekStart(MON, 1)).toBe("2026-01-12");
    expect(addWeeksToWeekStart(MON, -1)).toBe("2025-12-29");
  });

  it("lists seven days, Monday first", () => {
    const days = weekDayKeys(MON);
    expect(days).toHaveLength(7);
    expect(days[0]).toBe(MON);
    expect(days[6]).toBe("2026-01-11");
  });
});

describe("defaultWeekStart", () => {
  it("opens on the PREVIOUS week Monday through Thursday", () => {
    // The current week is still running. Grading it now would grade it from
    // open positions, which is the habit this whole redesign is against.
    expect(defaultWeekStart("2026-01-12")).toBe(MON); // Mon
    expect(defaultWeekStart("2026-01-15")).toBe(MON); // Thu
  });

  it("opens on the CURRENT week from Friday onward", () => {
    expect(defaultWeekStart("2026-01-09")).toBe(MON); // Fri
    expect(defaultWeekStart("2026-01-10")).toBe(MON); // Sat
    expect(defaultWeekStart("2026-01-11")).toBe(MON); // Sun
  });

  it("degrades to empty on an unparseable day", () => {
    expect(defaultWeekStart("garbage")).toBe("");
  });
});

describe("formatWeekRange", () => {
  it("collapses the month and year both ends share", () => {
    expect(formatWeekRange(MON)).toBe("5–11. jan 2026.");
  });

  it("keeps the month when the week spans two", () => {
    expect(formatWeekRange("2026-01-26")).toBe("26. jan–1. feb 2026.");
  });

  it("keeps the year when the week spans two", () => {
    expect(formatWeekRange("2025-12-29")).toBe("29. dec 2025.–4. jan 2026.");
  });

  it("does not shift the date west of Greenwich", () => {
    // The trap this function exists to avoid: `new Date("2026-01-05")` is UTC
    // midnight, which renders as the 4th in every American timezone. These are
    // account-zone day keys and must format from their own digits.
    expect(formatWeekRange(MON).startsWith("5")).toBe(true);
  });
});

describe("isWeekComplete", () => {
  const full = {
    week_grade: 4 as const,
    one_pattern: "Held two losers past the time stop",
    one_change: "Close anything past its time stop on sight",
  };

  it("needs the grade and both singular answers", () => {
    expect(isWeekComplete(full)).toBe(true);
    expect(isWeekComplete({ ...full, week_grade: null })).toBe(false);
    expect(isWeekComplete({ ...full, one_pattern: null })).toBe(false);
    expect(isWeekComplete({ ...full, one_change: null })).toBe(false);
    expect(isWeekComplete(null)).toBe(false);
  });

  it("does not accept whitespace as an answer", () => {
    expect(isWeekComplete({ ...full, one_change: "   " })).toBe(false);
  });
});

describe("emptyWeeklyReview", () => {
  it("carries the week and nothing else", () => {
    const row = emptyWeeklyReview(MON);
    expect(row.week_start).toBe(MON);
    expect(row.week_grade).toBeNull();
    expect(row.one_pattern).toBeNull();
    expect(row.next_week_catalysts).toBeNull();
  });
});
