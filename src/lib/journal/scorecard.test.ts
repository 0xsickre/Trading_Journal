import { describe, expect, it } from "vitest";
import {
  MIN_SAMPLE,
  RELIABLE_SAMPLE,
  UNDER_WATER_FLOOR_DAYS,
  computeScorecard,
  type ScorecardInputs,
} from "./scorecard";

/**
 * The composite this replaced had one job it could not do: tell the reader
 * whether the number moved because they traded differently or because the data
 * behind it changed. Most of what follows is about the three axes staying out
 * of each other's way, and about the gates that keep an empty book from
 * scoring a hundred.
 */

const rs = (n: number, value = 0.5) => Array.from({ length: n }, () => value);

const input = (over: Partial<ScorecardInputs> = {}): ScorecardInputs => ({
  trackerPct: 80,
  followRatePct: 60,
  maxDrawdownPctOfEquity: 10,
  underWaterDays: 0,
  ftmoHeadroomPct: null,
  decidedRs: rs(10),
  trades: 40,
  ...over,
});

describe("process — the only axis that exists without trades", () => {
  it("blends the tracker and the follow rate, and keeps both parts visible", () => {
    const p = computeScorecard(input()).process;
    // 60/40 toward the tracker: 80 × 0.6 + 60 × 0.4.
    expect(p.score).toBeCloseTo(72, 10);
    expect(p.trackerPct).toBe(80);
    expect(p.followRatePct).toBe(60);
  });

  it("stands on its own on a book with nothing closed", () => {
    // The case the old composite refused to score at all: a tracker history and
    // no trades covered 15 of 115 weights, so the card showed nothing. Process
    // is a statement about behaviour and does not need a closed trade.
    const card = computeScorecard(input({ trades: 0, decidedRs: [], trackerPct: 90, followRatePct: null }));
    expect(card.process.score).toBe(90);
    expect(card.survival.score).toBeNull();
    expect(card.edge.expectancyR).toBeNull();
  });

  it("is null, not zero, when neither half was ever answered", () => {
    const p = computeScorecard(input({ trackerPct: null, followRatePct: null })).process;
    expect(p.score).toBeNull();
  });

  it("keeps a real zero — a day everything was broken is not a missing day", () => {
    expect(computeScorecard(input({ trackerPct: 0, followRatePct: 0 })).process.score).toBe(0);
  });
});

describe("survival", () => {
  it("scores a shallow, recovered book high", () => {
    const s = computeScorecard(input({ maxDrawdownPctOfEquity: 4, underWaterDays: 0 })).survival;
    // 96 for the drawdown, 100 for being at a new peak.
    expect(s.score).toBeCloseTo(98, 10);
    expect(s.counted).toBe(2);
  });

  it("counts the time under water, up to a quarter of a year", () => {
    const half = computeScorecard(
      input({ maxDrawdownPctOfEquity: 0, underWaterDays: UNDER_WATER_FLOOR_DAYS / 2 }),
    ).survival;
    expect(half.score).toBeCloseTo(75, 10);

    // And no further: four months under is not twice as dead as three.
    const past = computeScorecard(
      input({ maxDrawdownPctOfEquity: 0, underWaterDays: UNDER_WATER_FLOOR_DAYS * 2 }),
    ).survival;
    expect(past.score).toBeCloseTo(50, 10);
  });

  it("takes the prop-firm headroom in without a trade gate", () => {
    // The evidence rides with the producer: `evaluateFtmo` answers null for a
    // window with nothing closed, so a figure here is already earned.
    const s = computeScorecard(
      input({ trades: 0, ftmoHeadroomPct: 40, decidedRs: [] }),
    ).survival;
    expect(s.score).toBe(40);
    expect(s.counted).toBe(1);
  });

  it("withholds the two trade-derived parts below the sample floor", () => {
    const s = computeScorecard(
      input({ trades: MIN_SAMPLE - 1, maxDrawdownPctOfEquity: 0, underWaterDays: 0 }),
    ).survival;
    // The bug this prevents: a drawdown of zero scores a perfect hundred, and
    // "no evidence" must never render as "flawless".
    expect(s.score).toBeNull();
    expect(s.drawdownPct).toBeNull();
    expect(s.underWaterDays).toBeNull();
    expect(s.counted).toBe(0);
  });

  it("never leaves the 0–100 band, however bad the book", () => {
    const s = computeScorecard(
      input({ maxDrawdownPctOfEquity: 240, underWaterDays: 400, ftmoHeadroomPct: -5 }),
    ).survival;
    expect(s.score).toBe(0);
    expect(s.counted).toBe(3);
  });
});

describe("edge — a measurement, deliberately not a grade", () => {
  it("states expectancy with its interval and its sample", () => {
    const e = computeScorecard(input({ decidedRs: [2, 2, 2, 2, 2, 2, 2, 2] })).edge;
    expect(e.expectancyR).toBeCloseTo(2, 10);
    expect(e.n).toBe(8);
    // Every draw is the same number, so the interval collapses onto it — and
    // that is a genuine 2R edge, not an undecided one.
    expect(e.interval).not.toBeNull();
    expect(e.inconclusive).toBe(false);
  });

  it("calls a mixed book undecided while the interval holds zero", () => {
    const e = computeScorecard(input({ decidedRs: [3, -1, -1, 2, -1, -1, 3, -1] })).edge;
    expect(e.inconclusive).toBe(true);
  });

  it("says nothing at all below the sample floor", () => {
    const e = computeScorecard(input({ decidedRs: rs(MIN_SAMPLE - 1) })).edge;
    expect(e.expectancyR).toBeNull();
    expect(e.interval).toBeNull();
    // Nothing ruled out is the same sentence to the reader as no evidence.
    expect(e.inconclusive).toBe(true);
    expect(e.n).toBe(MIN_SAMPLE - 1);
  });

  it("is gated on ITS OWN population, not on the closed-trade count", () => {
    // Forty closed trades of which three were decided is not an expectancy.
    const e = computeScorecard(input({ trades: 40, decidedRs: rs(3) })).edge;
    expect(e.expectancyR).toBeNull();
  });
});

describe("provisional", () => {
  it("marks a thin book without withholding its numbers", () => {
    const card = computeScorecard(input({ trades: RELIABLE_SAMPLE - 1 }));
    expect(card.provisional).toBe(true);
    expect(card.survival.score).not.toBeNull();
  });

  it("stops marking one that has settled, and never marks an empty book", () => {
    expect(computeScorecard(input({ trades: RELIABLE_SAMPLE })).provisional).toBe(false);
    expect(computeScorecard(input({ trades: 0 })).provisional).toBe(false);
  });
});
