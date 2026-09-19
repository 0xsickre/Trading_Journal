import { describe, expect, it, vi } from "vitest";
import {
  emptyDailyReport,
  isDayComplete,
  isFriday,
  nextReportDate,
  prevReportDate,
  todayInTz,
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

describe("isDayComplete", () => {
  it("is complete when every open position was judged", () => {
    expect(isDayComplete({ openCount: 2, judgedCount: 2 }, goal)).toBe(true);
    expect(isDayComplete({ openCount: 2, judgedCount: 1 }, goal)).toBe(false);
  });

  it("is complete with nothing open — there is nothing to answer", () => {
    expect(isDayComplete({ openCount: 0, judgedCount: 0 }, goal)).toBe(true);
  });

  it("is never complete without an active focus goal", () => {
    // The day is measured against the goal. With no goal set, "complete" has
    // nothing to be complete against.
    expect(isDayComplete({ openCount: 0, judgedCount: 0 }, null)).toBe(false);
    expect(isDayComplete({ openCount: 2, judgedCount: 2 }, null)).toBe(false);
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
    expect(row.mental_temp).toBeNull();
    expect(row.macro_note).toBeNull();
    expect(row.impulse_fomo).toBe(false);
    expect(row.no_trade_day).toBe(false);
  });
});

describe("daysOnActiveGoal", () => {
  it("is 1-based on start day", () => {
    expect(daysOnActiveGoal(goal, "2026-07-20")).toBe(1);
    expect(daysOnActiveGoal(goal, "2026-07-22")).toBe(3);
  });

  it("counts trading days only — a weekend adds nothing", () => {
    // Started Monday 20 July 2026. Friday is day 5; Saturday and Sunday stay
    // at 5; the next Monday is day 6.
    expect(daysOnActiveGoal(goal, "2026-07-24")).toBe(5);
    expect(daysOnActiveGoal(goal, "2026-07-26")).toBe(5);
    expect(daysOnActiveGoal(goal, "2026-07-27")).toBe(6);
  });

  it("reads at least 1 for a goal set on a weekend", () => {
    expect(daysOnActiveGoal({ started_at: "2026-07-25T10:00:00Z" }, "2026-07-25")).toBe(1);
  });
});

describe("todayInTz", () => {
  it("answers the account's calendar day, not UTC's", () => {
    // 01:30 UTC is still the previous evening in New York and already mid-morning
    // in Tokyo. Every day key in this app — the report date, the tracker heatmap,
    // the FTMO daily limit — is the ACCOUNT's day, so reading `new Date()` and
    // slicing the ISO string would file a late-evening report under tomorrow.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-07-30T01:30:00Z"));
      expect(todayInTz("UTC")).toBe("2026-07-30");
      expect(todayInTz("America/New_York")).toBe("2026-07-29");
      expect(todayInTz("Asia/Tokyo")).toBe("2026-07-30");
    } finally {
      vi.useRealTimers();
    }
  });
});
