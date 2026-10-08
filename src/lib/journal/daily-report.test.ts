import { describe, expect, it, vi } from "vitest";
import {
  emptyDailyReport,
  isFriday,
  nextReportDate,
  prevReportDate,
} from "./daily-report";
import { todayIn } from "./time";

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
    expect(row.no_trade_day).toBe(false);
  });
});

describe("todayIn — a plain zone", () => {
  it("answers the account's calendar day, not UTC's", () => {
    // 01:30 UTC is still the previous evening in New York and already mid-morning
    // in Tokyo. Every day key in this app — the report date, the tracker heatmap,
    // the prop-firm daily limit — is the ACCOUNT's day, so reading `new Date()` and
    // slicing the ISO string would file a late-evening report under tomorrow.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-07-30T01:30:00Z"));
      expect(todayIn("UTC")).toBe("2026-07-30");
      expect(todayIn("America/New_York")).toBe("2026-07-29");
      expect(todayIn("Asia/Tokyo")).toBe("2026-07-30");
    } finally {
      vi.useRealTimers();
    }
  });
});
