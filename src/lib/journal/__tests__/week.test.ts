import { describe, it, expect } from "vitest";
import { addDays, planningWeekStart, weekStart } from "@/lib/journal/week";

describe("weekStart", () => {
  it("maps a mid-week date back to its Monday", () => {
    // 2026-06-27 is a Saturday -> Monday is 2026-06-22.
    expect(weekStart("2026-06-27")).toBe("2026-06-22");
  });

  it("returns the same date when input is already Monday", () => {
    // 2026-06-22 is a Monday.
    expect(weekStart("2026-06-22")).toBe("2026-06-22");
  });

  it("maps Sunday to the preceding Monday (ISO week)", () => {
    // 2026-06-28 is a Sunday -> still 2026-06-22 week.
    expect(weekStart("2026-06-28")).toBe("2026-06-22");
    // The next day (Monday) starts a new week.
    expect(weekStart("2026-06-29")).toBe("2026-06-29");
  });

  it("handles a week that crosses a year boundary", () => {
    // 2027-01-01 is a Friday -> Monday is 2026-12-28.
    expect(weekStart("2027-01-01")).toBe("2026-12-28");
  });

  it("is locale/timezone independent (pure UTC)", () => {
    // Date right at a DST-style boundary still resolves by UTC day math.
    expect(weekStart("2026-03-29")).toBe("2026-03-23"); // Sun -> prev Mon
    expect(weekStart("2026-03-30")).toBe("2026-03-30"); // Mon
  });

  it("returns empty string for malformed input", () => {
    expect(weekStart("")).toBe("");
    expect(weekStart("2026-6-1")).toBe("");
    expect(weekStart("not-a-date")).toBe("");
  });
});

describe("addDays", () => {
  it("adds days across month boundaries", () => {
    expect(addDays("2026-06-29", 7)).toBe("2026-07-06");
  });

  it("returns empty string for malformed input", () => {
    expect(addDays("", 7)).toBe("");
  });
});

describe("planningWeekStart", () => {
  it("returns next Monday on Saturday", () => {
    expect(planningWeekStart("2026-06-27")).toBe("2026-06-29");
  });

  it("returns next Monday on Sunday", () => {
    expect(planningWeekStart("2026-06-28")).toBe("2026-06-29");
  });

  it("returns current Monday on weekdays", () => {
    expect(planningWeekStart("2026-06-25")).toBe("2026-06-22"); // Wed
    expect(planningWeekStart("2026-06-29")).toBe("2026-06-29"); // Mon
    expect(planningWeekStart("2026-07-03")).toBe("2026-06-29"); // Fri
  });

  it("handles year boundary on weekend", () => {
    // 2026-12-26 is a Saturday -> next Monday is 2026-12-28 (not 2027).
    expect(planningWeekStart("2026-12-26")).toBe("2026-12-28");
    // 2027-01-02 is a Saturday -> next Monday is 2027-01-04.
    expect(planningWeekStart("2027-01-02")).toBe("2027-01-04");
  });
});
