import { describe, expect, it, vi } from "vitest";
import {
  emptyDailyReport,
  gateLateText,
  gateWrittenAt,
  hasState,
  opportunitiesOf,
  opportunityText,
  sleepHoursBucket,
  sleepQualityBucket,
  stateText,
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
    expect(row.no_trade_day).toBe(false);
    expect(row.sleep_quality_pct).toBeNull();
    expect(row.work_shift).toBeNull();
    expect(row.tomorrow_change).toBeNull();
    expect(row.opportunities).toEqual([]);
    // The retired 1–5 rating is no longer part of what the form writes (G-2).
    expect("mental_temp" in row).toBe(false);
  });
});

describe("the state before the session (phase G, G-2)", () => {
  it("is written when any one of the four is", () => {
    expect(hasState(null)).toBe(false);
    expect(hasState({ sleep_quality_pct: null, sleep_hours: null, work_shift: null, with_child: null })).toBe(false);
    expect(hasState({ with_child: false })).toBe(true);
    expect(hasState({ sleep_hours: 0 })).toBe(true);
  });

  it("reads as one line, in the order the form asks", () => {
    expect(
      stateText({ sleep_quality_pct: 80, sleep_hours: 6.5, work_shift: "prva", with_child: true }),
    ).toBe("san 80 % · 6.5 h · prva smena · sa detetom");
    expect(stateText({ work_shift: "slobodan", with_child: false })).toBe("slobodan · bez deteta");
    // numeric(3,1) arrives from PostgREST as a string.
    expect(stateText({ sleep_hours: "7.0" as unknown as number })).toBe("7 h");
    expect(stateText({})).toBeNull();
  });

  it("dates the gate by the state, falling back to the retired rating on an old day", () => {
    expect(gateWrittenAt({ sleep_quality_pct: 70, state_at: "S", mental_temp: 4, mental_temp_at: "M" })).toBe("S");
    expect(gateWrittenAt({ mental_temp: 4, mental_temp_at: "M" })).toBe("M");
    expect(gateWrittenAt({ mental_temp: null, mental_temp_at: null })).toBeNull();
    expect(gateWrittenAt(null)).toBeNull();
  });

  it("bands sleep into three buckets, unknown out", () => {
    expect([59, 60, 79, 80, 100].map(sleepQualityBucket)).toEqual(["< 60 %", "60–79 %", "60–79 %", "80 %+", "80 %+"]);
    expect(sleepQualityBucket(null)).toBeNull();
    expect(sleepQualityBucket(101)).toBeNull();
    expect([5.9, 6, 6.9, 7, "8.5"].map((h) => sleepHoursBucket(h))).toEqual([
      "< 6 h",
      "6–6.9 h",
      "6–6.9 h",
      "7 h +",
      "7 h +",
    ]);
    expect(sleepHoursBucket(null)).toBeNull();
  });
});

describe("the day's opportunities (phase G, G-1)", () => {
  it("keeps only notes, at most three, flags as booleans", () => {
    expect(
      opportunitiesOf([
        { note: "  NY sweep PDL  ", in_playbook: true, could_take: true, easiest: true },
        { note: "" },
        "junk",
        null,
        { note: "London FVG", in_playbook: "yes" },
        { note: "c" },
        { note: "d" },
      ]),
    ).toEqual([
      { note: "NY sweep PDL", in_playbook: true, could_take: true, easiest: true },
      { note: "London FVG", in_playbook: false, could_take: false, easiest: false },
      { note: "c", in_playbook: false, could_take: false, easiest: false },
    ]);
    expect(opportunitiesOf(null)).toEqual([]);
    expect(opportunitiesOf({})).toEqual([]);
  });

  it("reads as a line with its marks", () => {
    expect(opportunityText({ note: "NY sweep", in_playbook: true, could_take: false, easiest: true })).toBe(
      "NY sweep (u playbook-u, nisam mogao, najlakša)",
    );
    expect(opportunityText({ note: "x", in_playbook: false, could_take: true, easiest: false })).toBe(
      "x (van playbook-a, mogao sam)",
    );
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

describe("the pre-session gate written after the first entry (phase Y)", () => {
  // 13.10.2026: first entry 09:24 Belgrade, the rating written 14.10. 11:15.
  it("says when it was written and when the first entry was, in Belgrade time", () => {
    expect(gateLateText("2026-10-14T09:15:54Z", "2026-10-13T07:24:39Z")).toBe(
      "upisano 14.10. 11:15, posle prvog ulaza (09:24)",
    );
  });

  it("is silent when the rating came before the first entry", () => {
    expect(gateLateText("2026-10-13T06:50:00Z", "2026-10-13T07:24:39Z")).toBeNull();
  });

  it("is silent without a trade, without a rating time, or with an unreadable one", () => {
    expect(gateLateText("2026-10-14T09:15:54Z", null)).toBeNull();
    expect(gateLateText(null, "2026-10-13T07:24:39Z")).toBeNull();
    expect(gateLateText("garbage", "2026-10-13T07:24:39Z")).toBeNull();
  });
});
