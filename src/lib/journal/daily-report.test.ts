import { describe, expect, it } from "vitest";
import {
  emptyDailyReport,
  isFriday,
  isReportComplete,
  nextReportDate,
  prevReportDate,
} from "./daily-report";
import { daysOnActiveGoal } from "./focus-goal";

const goal = {
  id: "g1",
  user_id: "u1",
  goal_text: "No trades below mental 5",
  started_at: "2026-07-20",
  is_active: true,
  ended_at: null,
  created_at: "2026-07-20T00:00:00Z",
  updated_at: "2026-07-20T00:00:00Z",
};

describe("isReportComplete", () => {
  it("requires grade, rule_broken, and active goal", () => {
    expect(
      isReportComplete({ day_grade: "B", rule_broken: false }, goal),
    ).toBe(true);
    expect(
      isReportComplete({ day_grade: "B", rule_broken: false }, null),
    ).toBe(false);
    expect(
      isReportComplete({ day_grade: null, rule_broken: false }, goal),
    ).toBe(false);
    expect(
      isReportComplete({ day_grade: "A", rule_broken: null }, goal),
    ).toBe(false);
    expect(isReportComplete(null, goal)).toBe(false);
  });
});

describe("date helpers", () => {
  it("shifts report dates", () => {
    expect(prevReportDate("2026-07-22")).toBe("2026-07-21");
    expect(nextReportDate("2026-07-22")).toBe("2026-07-23");
  });

  it("detects Friday", () => {
    expect(isFriday("2026-07-24")).toBe(true); // Fri
    expect(isFriday("2026-07-22")).toBe(false); // Wed
  });
});

describe("emptyDailyReport", () => {
  it("defaults booleans and nulls", () => {
    const row = emptyDailyReport("2026-07-22");
    expect(row.report_date).toBe("2026-07-22");
    expect(row.day_grade).toBeNull();
    expect(row.impulse_fomo).toBe(false);
    expect(row.no_trade_day).toBe(false);
    expect(row.rule_broken).toBeNull();
  });
});

describe("daysOnActiveGoal", () => {
  it("is 1-based on start day", () => {
    expect(daysOnActiveGoal(goal, "2026-07-20")).toBe(1);
    expect(daysOnActiveGoal(goal, "2026-07-22")).toBe(3);
  });
});
