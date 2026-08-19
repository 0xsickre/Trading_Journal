import { describe, expect, it } from "vitest";
import { buildMonthDayList, monthDays } from "./month-day-list";
import type { DailyReportListRow } from "./daily-report-queries";
import type { PeriodRow } from "./period-stats";

const row = (key: string, net = 100): PeriodRow => ({ key, net, trades: 1 } as PeriodRow);

const journal = (
  report_date: string,
  over: Partial<DailyReportListRow> = {},
): DailyReportListRow => ({
  report_date,
  mental_temp: 6,
  no_trade_day: false,
  impulse_fomo: false,
  impulse_fear: false,
  impulse_greed: false,
  impulse_fear_wrong: false,
  locked: false,
  hasNote: false,
  ...over,
});

const build = (
  rows: PeriodRow[] = [],
  reports: DailyReportListRow[] = [],
  compliance: [string, number | null][] = [],
) =>
  buildMonthDayList(
    "2026-04",
    new Map(rows.map((r) => [r.key, r])),
    reports,
    new Map(compliance),
  );

describe("monthDays — the month itself, not the grid around it", () => {
  it("runs first to last with no padding from neighbouring months", () => {
    const d = monthDays("2026-04");
    expect(d).toHaveLength(30);
    expect(d[0]).toBe("2026-04-01");
    expect(d[29]).toBe("2026-04-30");
  });

  it("gets February right in a leap year and a common one", () => {
    expect(monthDays("2024-02")).toHaveLength(29);
    expect(monthDays("2026-02")).toHaveLength(28);
  });

  it("answers empty for a key that is not a month", () => {
    expect(monthDays("nonsense")).toEqual([]);
    expect(monthDays("2026-13")).toEqual([]);
  });
});

describe("buildMonthDayList", () => {
  it("keeps a day that traded", () => {
    expect(build([row("2026-04-07")]).map((e) => e.day)).toEqual(["2026-04-07"]);
  });

  it("keeps a day that was written up but not traded", () => {
    // The whole reason the list exists: discipline is measured on flat days
    // too, and the grid shows those as empty squares.
    const out = build([], [journal("2026-04-08")]);
    expect(out.map((e) => e.day)).toEqual(["2026-04-08"]);
    expect(out[0].row).toBeNull();
    expect(out[0].journal).not.toBeNull();
  });

  it("DROPS A DAY WITH NEITHER, which is what makes this a list", () => {
    // A month is thirty rows and a trader uses maybe twelve. Keeping the empty
    // ones buries the used ones — and the grid already answers "which squares
    // are blank" better than a list can.
    expect(build([row("2026-04-07")])).toHaveLength(1);
  });

  it("DOES NOT KEEP A DAY ON COMPLIANCE ALONE", () => {
    // Rules score weekends and holidays too. A row reading only "0 % on a
    // Sunday you never opened the platform" is noise wearing a number.
    expect(build([], [], [["2026-04-12", 0]])).toEqual([]);
  });

  it("carries compliance onto a day that earned its place otherwise", () => {
    const out = build([row("2026-04-07")], [], [["2026-04-07", 80]]);
    expect(out[0].compliancePct).toBe(80);
  });

  it("orders newest first", () => {
    const out = build([row("2026-04-02"), row("2026-04-20"), row("2026-04-09")]);
    expect(out.map((e) => e.day)).toEqual([
      "2026-04-20",
      "2026-04-09",
      "2026-04-02",
    ]);
  });

  it("ignores days outside the month it was asked for", () => {
    const out = build(
      [row("2026-03-31"), row("2026-04-01"), row("2026-05-01")],
      [journal("2026-05-02")],
    );
    expect(out.map((e) => e.day)).toEqual(["2026-04-01"]);
  });

  it("keeps money and journal separate rather than merging them", () => {
    // Each source is independently absent, and a zero standing in for a missing
    // one would be a claim nobody made.
    const out = build([row("2026-04-07", -250)], [journal("2026-04-07", { mental_temp: 3 })]);
    expect(out[0].row?.net).toBe(-250);
    expect(out[0].journal?.mental_temp).toBe(3);
    expect(out[0].compliancePct).toBeNull();
  });
});
