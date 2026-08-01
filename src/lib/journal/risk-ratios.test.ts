import { describe, expect, it } from "vitest";
import {
  CALENDAR_DAYS_PER_YEAR,
  MIN_RATIO_DAYS,
  computeDailyDrawdown,
  computeRiskRatios,
  dailyTotals,
  groupByDay,
  type DayPnlPoint,
} from "./risk-ratios";
import { recoveryFactor } from "./risk-metrics";

const p = (day: string, pnl: number, at?: string): DayPnlPoint => ({
  day,
  at: at ?? `${day}T15:00:00.000Z`,
  pnl,
});

/** Five consecutive days: +100, −50, +200, −100, +150. Net +300. */
const FIVE_DAYS: DayPnlPoint[] = [
  p("2026-01-01", 100),
  p("2026-01-02", -50),
  p("2026-01-03", 200),
  p("2026-01-04", -100),
  p("2026-01-05", 150),
];

describe("grouping", () => {
  it("orders days chronologically whatever order the trades arrive in", () => {
    const g = groupByDay([p("2026-03-05", 10), p("2026-01-09", 20)]);
    expect([...g.keys()]).toEqual(["2026-01-09", "2026-03-05"]);
  });

  it("orders trades WITHIN a day by close time", () => {
    // This ordering decides where the intraday peak sits, so it decides the
    // daily drawdown. A query that returns trades by id would otherwise change
    // the number.
    const g = groupByDay([
      p("2026-01-01", 50, "2026-01-01T18:00:00.000Z"),
      p("2026-01-01", -20, "2026-01-01T14:00:00.000Z"),
    ]);
    expect(g.get("2026-01-01")).toEqual([-20, 50]);
  });

  it("sums a day rather than listing it", () => {
    const totals = dailyTotals([
      p("2026-01-01", 50),
      p("2026-01-01", -20),
      p("2026-01-02", 5),
    ]);
    expect(totals).toEqual([
      { day: "2026-01-01", pnl: 30 },
      { day: "2026-01-02", pnl: 5 },
    ]);
  });

  it("ignores a point with no day key", () => {
    expect(groupByDay([{ day: "", at: null, pnl: 10 }]).size).toBe(0);
  });
});

describe("computeRiskRatios", () => {
  it("refuses to produce a ratio from too few days", () => {
    const short = FIVE_DAYS.slice(0, MIN_RATIO_DAYS - 1);
    const r = computeRiskRatios(short, -100);
    expect(r.days).toBe(MIN_RATIO_DAYS - 1);
    // The count and the span are still reported — a caller needs to be able to
    // say "4 days" rather than "no data".
    expect(r.spanDays).toBe(4);
    expect(r.sharpe).toBeNull();
    expect(r.sortino).toBeNull();
    expect(r.calmar).toBeNull();
    expect(r.stdevDaily).toBeNull();
  });

  it("computes the daily moments before annualizing anything", () => {
    const r = computeRiskRatios(FIVE_DAYS, -100);
    expect(r.days).toBe(5);
    expect(r.meanDaily).toBe(60);
    // Population variance of (100,−50,200,−100,150) around 60 is 13 400.
    expect(r.stdevDaily).toBeCloseTo(Math.sqrt(13_400), 9);
    // Downside RMS over ALL five days: sqrt((50² + 100²) / 5) = 50.
    expect(r.downsideDeviation).toBe(50);
  });

  it("measures the annualization factor instead of assuming 252", () => {
    // Five days inside one week: the book traded every day, so a year of this
    // pace is 365 such days.
    const dense = computeRiskRatios(FIVE_DAYS, -100);
    expect(dense.spanDays).toBe(5);
    expect(dense.periodsPerYear).toBeCloseTo(CALENDAR_DAYS_PER_YEAR, 9);

    // The same five days spread across a whole year: five trading days a year,
    // and the ratio must be scaled by sqrt(5), not sqrt(365). Assuming a fixed
    // constant would inflate this book by a factor of eight.
    const sparse = computeRiskRatios(
      [
        p("2026-01-01", 100),
        p("2026-04-01", -50),
        p("2026-07-01", 200),
        p("2026-10-01", -100),
        p("2026-12-31", 150),
      ],
      -100,
    );
    expect(sparse.spanDays).toBe(365);
    expect(sparse.periodsPerYear).toBeCloseTo(5, 9);
    expect(sparse.sharpe! * Math.sqrt(73)).toBeCloseTo(dense.sharpe!, 6);
  });

  it("annualizes mean / stdev into Sharpe", () => {
    const r = computeRiskRatios(FIVE_DAYS, -100);
    expect(r.sharpe).toBeCloseTo(
      (60 / Math.sqrt(13_400)) * Math.sqrt(365),
      9,
    );
    expect(r.sharpe).toBeCloseTo(9.9, 1);
  });

  it("scores Sortino above Sharpe when the losses are the smaller half of the noise", () => {
    // The whole point of Sortino: upside volatility is not risk. This book's
    // big moves are wins, so punishing it for total deviation understates it.
    const r = computeRiskRatios(FIVE_DAYS, -100);
    expect(r.sortino).toBeCloseTo((60 / 50) * Math.sqrt(365), 9);
    expect(r.sortino!).toBeGreaterThan(r.sharpe!);
  });

  it("leaves Sortino empty when no day lost money", () => {
    // Null, not Infinity — the same call profitFactor makes with no losing
    // trade. An infinity here would sort to the top of every report.
    const r = computeRiskRatios(
      [
        p("2026-01-01", 10),
        p("2026-01-02", 20),
        p("2026-01-03", 30),
        p("2026-01-04", 40),
        p("2026-01-05", 50),
      ],
      0,
    );
    expect(r.downsideDeviation).toBe(0);
    expect(r.sortino).toBeNull();
    expect(r.sharpe).not.toBeNull();
  });

  it("leaves Sharpe empty when every day is identical", () => {
    const flat = ["01", "02", "03", "04", "05"].map((d) =>
      p(`2026-01-${d}`, 25),
    );
    const r = computeRiskRatios(flat, 0);
    expect(r.stdevDaily).toBe(0);
    expect(r.sharpe).toBeNull();
  });

  it("is the recovery factor put on an annual footing", () => {
    // Calmar and recovery factor share a numerator and a denominator; the only
    // difference is that Calmar divides by how long the profit took. Pinned as
    // an identity so the two can never drift apart.
    const r = computeRiskRatios(FIVE_DAYS, -100);
    const recovery = recoveryFactor(300, -100)!;
    expect(recovery).toBe(3);
    expect(r.calmar).toBeCloseTo(recovery * (365 / 5), 9);
    expect(r.calmar).toBeCloseTo(219, 9);
  });

  it("penalises the same profit earned more slowly", () => {
    const fast = computeRiskRatios(FIVE_DAYS, -100);
    const slow = computeRiskRatios(
      [
        p("2026-01-01", 100),
        p("2026-04-01", -50),
        p("2026-07-01", 200),
        p("2026-10-01", -100),
        p("2026-12-31", 150),
      ],
      -100,
    );
    // Identical trades, identical drawdown, identical recovery factor — and
    // Calmar still separates them, which is the reason to have it.
    expect(slow.calmar!).toBeLessThan(fast.calmar!);
    expect(slow.calmar).toBeCloseTo(3 * (365 / 365), 9);
  });

  it("leaves Calmar empty while the curve has never fallen", () => {
    expect(computeRiskRatios(FIVE_DAYS, 0).calmar).toBeNull();
  });

  it("returns zeros rather than throwing on an empty book", () => {
    const r = computeRiskRatios([], -100);
    expect(r.days).toBe(0);
    expect(r.spanDays).toBe(0);
    expect(r.sharpe).toBeNull();
  });
});

describe("computeDailyDrawdown", () => {
  it("measures each day from its own high-water mark", () => {
    const r = computeDailyDrawdown([
      // Up 100, then gives back 60, then recovers 20 → deepest drop 60.
      p("2026-01-01", 100, "2026-01-01T10:00:00.000Z"),
      p("2026-01-01", -60, "2026-01-01T12:00:00.000Z"),
      p("2026-01-01", 20, "2026-01-01T14:00:00.000Z"),
    ]);
    expect(r.avgMoney).toBe(-60);
    expect(r.worstDay).toBe("2026-01-01");
  });

  it("counts the first losing trade of the day as drawdown", () => {
    // The day opens at its own peak, so a loss out of the gate is a real daily
    // drawdown even though the account-wide curve may still be at an all-time
    // high. This is the rule a prop-firm daily loss limit enforces.
    const r = computeDailyDrawdown([
      p("2026-01-01", -30, "2026-01-01T10:00:00.000Z"),
      p("2026-01-01", 50, "2026-01-01T12:00:00.000Z"),
    ]);
    expect(r.avgMoney).toBe(-30);
  });

  it("keeps a clean day in the denominator", () => {
    // Averaging over losing days only would answer a different, much uglier
    // question. A day that never went underwater is a 0, not an absence.
    const r = computeDailyDrawdown([
      p("2026-01-01", 100, "2026-01-01T10:00:00.000Z"),
      p("2026-01-01", -60, "2026-01-01T12:00:00.000Z"),
      p("2026-01-02", -30, "2026-01-02T10:00:00.000Z"),
      p("2026-01-03", 10, "2026-01-03T10:00:00.000Z"),
      p("2026-01-03", 20, "2026-01-03T11:00:00.000Z"),
    ]);
    expect(r.days).toBe(3);
    expect(r.avgMoney).toBeCloseTo((-60 + -30 + 0) / 3, 9);
    expect(r.worstMoney).toBe(-60);
    expect(r.worstDay).toBe("2026-01-01");
  });

  it("does not carry the peak from one day into the next", () => {
    // Day two ends 500 below day one's high. Carried across, that would read as
    // a −500 daily drawdown; day-local, it is −50.
    const r = computeDailyDrawdown([
      p("2026-01-01", 500, "2026-01-01T10:00:00.000Z"),
      p("2026-01-02", -50, "2026-01-02T10:00:00.000Z"),
    ]);
    expect(r.worstMoney).toBe(-50);
  });

  it("gives the same answer whatever order the trades arrive in", () => {
    const ordered = computeDailyDrawdown([
      p("2026-01-01", 100, "2026-01-01T10:00:00.000Z"),
      p("2026-01-01", -60, "2026-01-01T12:00:00.000Z"),
    ]);
    const shuffled = computeDailyDrawdown([
      p("2026-01-01", -60, "2026-01-01T12:00:00.000Z"),
      p("2026-01-01", 100, "2026-01-01T10:00:00.000Z"),
    ]);
    expect(shuffled).toEqual(ordered);
  });

  it("returns zeros rather than throwing on an empty book", () => {
    expect(computeDailyDrawdown([])).toEqual({
      days: 0,
      avgMoney: 0,
      worstMoney: 0,
      worstDay: null,
    });
  });
});
