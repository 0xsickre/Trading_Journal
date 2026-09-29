import { describe, expect, it } from "vitest";
import {
  briefResolver,
  defaultFlatBy,
  flatByFor,
  parseSessionBrief,
  redWindowAt,
  planDayEndsAt,
  planTradingDay,
} from "./session-brief";

const row = (over: Record<string, unknown> = {}) => ({
  trading_day: "2026-09-29",
  flat_by: "2026-09-29T20:10:00+00:00",
  day_note: null,
  red_windows: [
    { from: "2026-09-29T12:25:00Z", to: "2026-09-29T12:45:00Z", title: "CPI m/m", impact: "visok" },
  ],
  ranges: { NQ_ts: { pts: 312.4, pts_lo: 210, pts_hi: 450, pct: 1.2 } },
  source_url: "https://example.test/brief/2026-09-29.html",
  ...over,
});

describe("parseSessionBrief", () => {
  it("reads a well-formed row", () => {
    const b = parseSessionBrief(row());
    expect(b).not.toBeNull();
    expect(b?.tradingDay).toBe("2026-09-29");
    expect(b?.flatBy).toBe("2026-09-29T20:10:00.000Z");
    expect(b?.redWindows).toEqual([
      { from: "2026-09-29T12:25:00.000Z", to: "2026-09-29T12:45:00.000Z", title: "CPI m/m", impact: "visok" },
    ]);
    expect(b?.ranges.NQ_ts).toEqual({ pts: 312.4, ptsLo: 210, ptsHi: 450, pct: 1.2, unit: "pts" });
  });

  it("refuses a row without a valid trading day", () => {
    expect(parseSessionBrief(row({ trading_day: "2026-02-30" }))).toBeNull();
    expect(parseSessionBrief(row({ trading_day: null }))).toBeNull();
    expect(parseSessionBrief(null)).toBeNull();
  });

  it("drops a window it cannot read, and keeps the rest", () => {
    const b = parseSessionBrief(
      row({
        red_windows: [
          { from: "nonsense", to: "2026-09-29T12:45:00Z", title: "x" },
          { from: "2026-09-29T14:00:00Z", to: "2026-09-29T13:00:00Z", title: "ends before it starts" },
          { from: "2026-09-29T18:00:00Z", to: "2026-09-29T18:15:00Z", title: "FOMC" },
          "not an object",
        ],
      }),
    );
    expect(b?.redWindows.map((w) => w.title)).toEqual(["FOMC"]);
    expect(b?.droppedWindows).toBe(3);
  });

  it("drops a range without a number, and keeps the unit the brief gave", () => {
    const b = parseSessionBrief(
      row({ ranges: { NQ_ts: { pts: "wide" }, "6E_ts": { pts: 55, pts_lo: 40, pts_hi: 70, pct: 0.4, jedinica: "pipa" } } }),
    );
    expect(Object.keys(b?.ranges ?? {})).toEqual(["6E_ts"]);
    expect(b?.ranges["6E_ts"].unit).toBe("pipa");
  });

  it("reads null flat_by as a closed exchange, not as unknown", () => {
    expect(parseSessionBrief(row({ flat_by: null }))?.flatBy).toBeNull();
  });
});

describe("defaultFlatBy / flatByFor", () => {
  it("is 15:10 Chicago on the Topstep day, in summer and in winter", () => {
    expect(defaultFlatBy("2026-09-29")).toBe("2026-09-29T20:10:00.000Z"); // CDT, UTC-5
    expect(defaultFlatBy("2026-12-15")).toBe("2026-12-15T21:10:00.000Z"); // CST, UTC-6
  });

  it("takes the brief's time when there is one, the default otherwise", () => {
    const early = parseSessionBrief(row({ trading_day: "2026-11-27", flat_by: "2026-11-27T18:00:00Z" }));
    expect(flatByFor("2026-11-27", early)).toEqual({ at: "2026-11-27T18:00:00.000Z", source: "brief" });
    expect(flatByFor("2026-09-30", null)).toEqual({ at: "2026-09-30T20:10:00.000Z", source: "default" });
  });

  it("says closed when the brief says the exchange is closed", () => {
    const xmas = parseSessionBrief(row({ trading_day: "2026-12-25", flat_by: null }));
    expect(flatByFor("2026-12-25", xmas)).toEqual({ at: null, source: "brief" });
  });
});

describe("redWindowAt", () => {
  const windows = parseSessionBrief(row())!.redWindows;

  it("includes both edges", () => {
    expect(redWindowAt("2026-09-29T12:25:00Z", windows)?.title).toBe("CPI m/m");
    expect(redWindowAt("2026-09-29T12:45:00Z", windows)?.title).toBe("CPI m/m");
  });

  it("is null just outside and for an unreadable instant", () => {
    expect(redWindowAt("2026-09-29T12:24:59Z", windows)).toBeNull();
    expect(redWindowAt("2026-09-29T12:45:01Z", windows)).toBeNull();
    expect(redWindowAt("garbage", windows)).toBeNull();
    expect(redWindowAt(null, windows)).toBeNull();
  });
});

describe("briefResolver", () => {
  it("finds the brief by day, and null for a day without one", () => {
    const b = parseSessionBrief(row())!;
    const of = briefResolver([b]);
    expect(of("2026-09-29")).toBe(b);
    expect(of("2026-09-30")).toBeNull();
  });
});

describe("a plan's trading day (F6, M3-A — the same rule as futures-trading prozor_plana)", () => {
  it("is the Topstep day it was written in, until that day's 15:10 CT flat", () => {
    expect(planTradingDay("2026-09-29T13:00:00Z")).toBe("2026-09-29");
    expect(planDayEndsAt("2026-09-29T13:00:00Z")).toBe(Date.parse("2026-09-29T20:10:00Z"));
  });

  it("moves to the next day after the flat, and past the weekend", () => {
    // 16:00 CT, after the flat and before the 17:00 reopen.
    expect(planTradingDay("2026-09-29T21:00:00Z")).toBe("2026-09-30");
    // Friday 16:30 CT and Sunday 18:00 CT both plan Monday.
    expect(planTradingDay("2026-10-02T21:30:00Z")).toBe("2026-10-05");
    expect(planTradingDay("2026-10-04T23:00:00Z")).toBe("2026-10-05");
  });

  it("has no day for an unreadable instant", () => {
    expect(planTradingDay(null)).toBe("");
    expect(Number.isNaN(planDayEndsAt("nope"))).toBe(true);
  });
});
