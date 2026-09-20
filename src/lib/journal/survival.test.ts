import { describe, expect, it } from "vitest";
import {
  dayReturnsFrom,
  MIN_SAMPLE_DAYS,
  simulateSurvival,
  thresholdsFor,
  type SurvivalInput,
} from "./survival";

/**
 * A simulation cannot be checked against a known answer the way Wilson can, so
 * what is pinned here is everything that would make it dishonest: a different
 * answer for the same book, a probability out of thin air on eight days of
 * history, a floor that gets easier when the trader risks more, and streaks
 * that vanish because days were drawn one at a time.
 */

/** A modest edge: mostly small gains, a few real losses. */
const book = (scale = 1): number[] =>
  Array.from({ length: 60 }, (_, i) => (i % 5 === 0 ? -1.5 : 0.5) * scale);

const run = (over: Partial<SurvivalInput> = {}) =>
  simulateSurvival({
    dayReturns: book(),
    horizonDays: 60,
    blockDays: 1,
    thresholds: { maxLossPct: 10, dailyLossPct: 5, profitTargetPct: 10 },
    iters: 400,
    ...over,
  });

describe("what the simulation refuses to answer", () => {
  it("says nothing at all on a book too short to resample", () => {
    expect(run({ dayReturns: book().slice(0, MIN_SAMPLE_DAYS - 1) })).toBeNull();
    expect(run({ dayReturns: [] })).toBeNull();
  });

  it("refuses a horizon of no days", () => {
    expect(run({ horizonDays: 0 })).toBeNull();
  });

  it("leaves a threshold null rather than reporting 0 % for a rule nobody set", () => {
    const r = run({ thresholds: { maxLossPct: null, dailyLossPct: null, profitTargetPct: null } })!;
    expect(r.pMaxLoss).toBeNull();
    expect(r.pDailyLoss).toBeNull();
    expect(r.pTarget).toBeNull();
    // What it can still answer without any threshold at all.
    expect(r.pNegative).toBeGreaterThanOrEqual(0);
    expect(r.percentiles.p50).toBeTypeOf("number");
  });

  it("carries the sample it drew from, so the card can warn about it", () => {
    const r = run()!;
    expect(r.sampleDays).toBe(60);
    expect(r.iters).toBe(400);
  });
});

describe("the same book always gets the same answer", () => {
  it("replays identically", () => {
    expect(run()).toEqual(run());
  });

  it("but not for a different book", () => {
    expect(run()!.percentiles.p50).not.toBe(run({ dayReturns: book(2) })!.percentiles.p50);
  });
});

describe("the answers move the way reality does", () => {
  it("doubling the size makes the floor twice as easy to hit", () => {
    const normal = run({ dayReturns: book(1) })!;
    const doubled = run({ dayReturns: book(2) })!;
    expect(doubled.pMaxLoss!).toBeGreaterThan(normal.pMaxLoss!);
    expect(doubled.medianWorstDrawdownPct).toBeGreaterThan(normal.medianWorstDrawdownPct);
  });

  it("a losing book ends below where it started far more often than a winning one", () => {
    const winner = run({ dayReturns: Array.from({ length: 40 }, (_, i) => (i % 4 === 0 ? -1 : 1)) })!;
    const loser = run({ dayReturns: Array.from({ length: 40 }, (_, i) => (i % 4 === 0 ? 1 : -1)) })!;
    expect(loser.pNegative).toBeGreaterThan(winner.pNegative);
    expect(loser.percentiles.p50).toBeLessThan(winner.percentiles.p50);
  });

  it("the percentiles are ordered, because they are quantiles of one distribution", () => {
    const p = run()!.percentiles;
    expect(p.p5).toBeLessThanOrEqual(p.p25);
    expect(p.p25).toBeLessThanOrEqual(p.p50);
    expect(p.p50).toBeLessThanOrEqual(p.p75);
    expect(p.p75).toBeLessThanOrEqual(p.p95);
  });

  it("a longer horizon cannot make a floor less likely", () => {
    const short = run({ horizonDays: 20 })!;
    const long = run({ horizonDays: 120 })!;
    expect(long.pMaxLoss!).toBeGreaterThanOrEqual(short.pMaxLoss!);
  });

  it("the daily rule fires only on a day big enough to break it", () => {
    const calm = run({ thresholds: { maxLossPct: null, dailyLossPct: 5, profitTargetPct: null } })!;
    // No day in the book loses 5 %, so no run can breach it.
    expect(calm.pDailyLoss).toBe(0);
    const wild = run({
      dayReturns: [...book(), -6],
      thresholds: { maxLossPct: null, dailyLossPct: 5, profitTargetPct: null },
    })!;
    expect(wild.pDailyLoss!).toBeGreaterThan(0);
  });
});

describe("blocks keep streaks together", () => {
  it("a book whose losses come in runs is more dangerous drawn in blocks", () => {
    // Ten quiet days, then five straight losses — a shape single-day draws
    // break apart and block draws preserve.
    const streaky = [
      ...Array.from({ length: 30 }, () => 0.4),
      ...Array.from({ length: 5 }, () => -3),
      ...Array.from({ length: 25 }, () => 0.4),
    ];
    const iid = simulateSurvival({
      dayReturns: streaky,
      horizonDays: 60,
      blockDays: 1,
      thresholds: { maxLossPct: 10, dailyLossPct: null, profitTargetPct: null },
      iters: 600,
    })!;
    const blocked = simulateSurvival({
      dayReturns: streaky,
      horizonDays: 60,
      blockDays: 5,
      thresholds: { maxLossPct: 10, dailyLossPct: null, profitTargetPct: null },
      iters: 600,
    })!;
    expect(blocked.medianWorstDrawdownPct).toBeGreaterThan(iid.medianWorstDrawdownPct);
  });

  it("a block longer than the history is clamped rather than refused", () => {
    expect(run({ blockDays: 1000 })).not.toBeNull();
    expect(run({ blockDays: 0 })).not.toBeNull();
  });
});

describe("dayReturnsFrom", () => {
  it("expresses each day against the equity it opened with", () => {
    const pnl = new Map([
      ["2026-03-02", 200],
      ["2026-03-03", -150],
    ]);
    const equity = new Map([
      ["2026-03-02", 10_000],
      ["2026-03-03", 10_200],
    ]);
    expect(dayReturnsFrom(pnl, (d) => equity.get(d) ?? null)).toEqual([
      2,
      (-150 / 10_200) * 100,
    ]);
  });

  it("drops a day whose equity is unknown rather than calling it flat", () => {
    const pnl = new Map([
      ["2026-03-02", 200],
      ["2026-03-03", -150],
    ]);
    expect(dayReturnsFrom(pnl, (d) => (d === "2026-03-02" ? 10_000 : null))).toEqual([2]);
  });

  it("returns the days in order, because blocks are consecutive days", () => {
    const pnl = new Map([
      ["2026-03-04", 300],
      ["2026-03-02", 100],
      ["2026-03-03", 200],
    ]);
    expect(dayReturnsFrom(pnl, () => 10_000)).toEqual([1, 2, 3]);
  });
});

describe("thresholdsFor — the same engine, two sources of limits", () => {
  it("takes the challenge's rules when the challenge is on", () => {
    expect(
      thresholdsFor({
        ftmoEnabled: true,
        ftmoMaxLossPct: 10,
        ftmoDailyLossPct: 5,
        ftmoProfitTargetPct: 10,
        ownMaxLossPct: 25,
      }),
    ).toEqual({ maxLossPct: 10, dailyLossPct: 5, profitTargetPct: 10 });
  });

  it("takes the trader's own drawdown when there is no challenge", () => {
    expect(
      thresholdsFor({ ftmoEnabled: false, ftmoMaxLossPct: 10, ownMaxLossPct: 20 }),
    ).toEqual({ maxLossPct: 20, dailyLossPct: null, profitTargetPct: null });
  });

  it("asks nothing of a book with no limit chosen at all", () => {
    expect(thresholdsFor({ ftmoEnabled: false })).toEqual({
      maxLossPct: null,
      dailyLossPct: null,
      profitTargetPct: null,
    });
  });
});
