import { describe, expect, it } from "vitest";
import { CONSISTENCY_SCALE, consistencyScore } from "./risk-metrics";
import {
  MIN_COVERAGE_SHARE,
  MIN_SAMPLE,
  PROCESS_ADHERENCE_WEIGHT,
  WIN_PCT_TOP_THRESHOLD,
  RATIO_BANDS,
  RECOVERY_BANDS,
  RELIABLE_SAMPLE,
  computeSickreScore,
  scoreFromBands,
} from "./sickre-score";

describe("scoreFromBands", () => {
  it("caps at 100 above the top band", () => {
    expect(scoreFromBands(2.6, RATIO_BANDS)).toBe(100);
    expect(scoreFromBands(5, RATIO_BANDS)).toBe(100);
  });

  it("floors at 20 below the bottom ratio band", () => {
    expect(scoreFromBands(1.79, RATIO_BANDS)).toBe(20);
    expect(scoreFromBands(0.4, RATIO_BANDS)).toBe(20);
  });

  it("interpolates linearly inside a band", () => {
    // 2.40–2.59 maps to 90–99; the band's floor scores its minimum.
    expect(scoreFromBands(2.4, RATIO_BANDS)).toBeCloseTo(90, 6);
    // Halfway between 2.40 and 2.60 → halfway between 90 and 99.
    expect(scoreFromBands(2.5, RATIO_BANDS)).toBeCloseTo(94.5, 6);
  });

  it("scores recovery factor on its own table", () => {
    expect(scoreFromBands(3.5, RECOVERY_BANDS)).toBe(100);
    expect(scoreFromBands(0.9, RECOVERY_BANDS)).toBe(0);
    expect(scoreFromBands(2.0, RECOVERY_BANDS)).toBeCloseTo(50, 6);
  });

  it("returns null for missing input", () => {
    expect(scoreFromBands(null, RATIO_BANDS)).toBeNull();
  });
});

describe("computeSickreScore", () => {
  const full = {
    profitFactor: 2.6,
    avgWinLossRatio: 2.6,
    maxDrawdownPctOfPeakPnl: 0,
    winPct: 60,
    recoveryFactor: 3.5,
    consistencyScore: 100,
    sample: { trades: 40, decided: 40 },
  };

  it("scores a perfect book at 100 with full weight coverage", () => {
    const r = computeSickreScore(full);
    expect(r.score).toBe(100);
    expect(r.coverage).toBe(100);
    expect(r.components.every((c) => c.counted)).toBe(true);
  });

  it("uses the documented win % threshold", () => {
    // The spec's worked example: 25 % → 41.67.
    const r = computeSickreScore({ ...full, winPct: 25 });
    const win = r.components.find((c) => c.key === "winPct")!;
    expect(win.score).toBeCloseTo(41.67, 2);
  });

  it("subtracts drawdown percent from 100", () => {
    const r = computeSickreScore({ ...full, maxDrawdownPctOfPeakPnl: 30 });
    const dd = r.components.find((c) => c.key === "maxDrawdown")!;
    expect(dd.score).toBe(70);
  });

  it("clamps an extreme drawdown at zero instead of going negative", () => {
    const r = computeSickreScore({ ...full, maxDrawdownPctOfPeakPnl: 250 });
    expect(r.components.find((c) => c.key === "maxDrawdown")!.score).toBe(0);
  });

  it("drops a component with no data and renormalizes the rest", () => {
    // No drawdown yet → recovery factor is undefined, worth 10 of the 100.
    const r = computeSickreScore({ ...full, recoveryFactor: null });
    expect(r.coverage).toBe(90);
    expect(r.components.find((c) => c.key === "recovery")!.counted).toBe(false);
    // Everything else is perfect, so the score stays 100 rather than dropping
    // to 90 just because one input could not be computed.
    expect(r.score).toBe(100);
  });

  it("weights components as the spec specifies", () => {
    // Only profit factor is perfect; everything else scores zero.
    const r = computeSickreScore({
      profitFactor: 2.6,
      avgWinLossRatio: null,
      maxDrawdownPctOfPeakPnl: 100,
      winPct: 0,
      recoveryFactor: 0.5,
      consistencyScore: 0,
      sample: { trades: 40, decided: 40 },
    });
    // PF 100*25 + DD 0*20 + win 0*15 + recovery 0*10 + consistency 0*10
    // over coverage 80 → 31.25
    expect(r.coverage).toBe(80);
    expect(r.score).toBeCloseTo(31.25, 6);
  });

  it("adds the process component only when supplied", () => {
    expect(computeSickreScore(full).components).toHaveLength(6);
    const withProcess = computeSickreScore({
      ...full,
      processAdherencePct: 80,
    });
    expect(withProcess.components).toHaveLength(7);
    expect(withProcess.coverage).toBe(115);
    expect(withProcess.score).toBeLessThan(100);
  });

  it("returns null when nothing can be computed", () => {
    const r = computeSickreScore({
      profitFactor: null,
      avgWinLossRatio: null,
      maxDrawdownPctOfPeakPnl: null,
      winPct: null,
      recoveryFactor: null,
      consistencyScore: null,
      sample: { trades: 0, decided: 0 },
    });
    expect(r.score).toBeNull();
    expect(r.coverage).toBe(0);
  });
});

describe("an empty book scores nothing, not something", () => {
  /**
   * Reported from a live account with **zero trades entered**, which read
   * 33/100 with "Max drawdown: 100" on the card.
   *
   * The three inputs below are each honest on their own: a book with no trades
   * has drawn down no money, won none of no decisions, and has no variance in
   * an empty set. But `100 - 0 = 100` turned the first of those into a claim of
   * flawless risk management, and it carried weight 20 against a coverage of 60
   * — a third of the composite, asserted on no evidence.
   */
  const emptyBook = {
    profitFactor: null, // these three already report themselves as missing
    avgWinLossRatio: null,
    recoveryFactor: null,
    maxDrawdownPctOfPeakPnl: 0, // ...and these three cannot
    winPct: 0,
    consistencyScore: 0,
    sample: { trades: 0, decided: 0 },
  };

  it("counts no component and has no score at all", () => {
    const r = computeSickreScore(emptyBook);
    expect(r.score).toBeNull();
    expect(r.coverage).toBe(0);
    expect(r.components.some((c) => c.counted)).toBe(false);
  });

  it("does not score a drawdown of zero as perfect risk management", () => {
    // The headline symptom. Before the sample gate this was `score: 100`,
    // `counted: true`, and it alone produced the reported 33.
    const dd = computeSickreScore(emptyBook).components.find(
      (c) => c.key === "maxDrawdown",
    )!;
    expect(dd.value).toBeNull();
    expect(dd.score).toBeNull();
    expect(dd.counted).toBe(false);
  });

  it("reproduces the reported 33 to prove the diagnosis, then removes it", () => {
    // With the process component supplied — the account had tracker rules and
    // unanswered days, so it genuinely scored 0 — the old arithmetic was
    // (100×20 + 0×15 + 0×10 + 0×15) / 60 = 33.33, over 60 of 115 weights = 52 %.
    // Both numbers on the screenshot. Feeding the same values with a non-empty
    // sample still produces it; the counts are the only thing that changed.
    const asIfTraded = computeSickreScore({
      ...emptyBook,
      processAdherencePct: 0,
      sample: { trades: 12, decided: 12 },
    });
    expect(asIfTraded.score).toBeCloseTo(33.33, 1);
    expect(asIfTraded.coverage / asIfTraded.maxCoverage).toBeCloseTo(0.52, 2);

    // The same account with nothing traded now has no score at all. Not 0 —
    // that 0 would have been process adherence alone, at 15 of 115 weights,
    // presented under the heading of a seven-component composite.
    const empty = computeSickreScore({ ...emptyBook, processAdherencePct: 0 });
    expect(empty.score).toBeNull();
    expect(empty.confidence).toEqual({
      level: "withheld",
      reason: "sample",
      tradesShort: 5,
    });
  });

  it("keeps a REAL zero drawdown at 100 once there are trades behind it", () => {
    // The gate must not swallow the good case: a trader whose cumulative P&L
    // has never dipped below its peak has earned that 100.
    const r = computeSickreScore({
      ...emptyBook,
      maxDrawdownPctOfPeakPnl: 0,
      sample: { trades: 8, decided: 8 },
    });
    const dd = r.components.find((c) => c.key === "maxDrawdown")!;
    expect(dd.score).toBe(100);
    expect(dd.counted).toBe(true);
  });

  it("drops win % over decisions but keeps consistency over trades", () => {
    // Different denominators, so different gates. A book of nothing but
    // breakeven scratches has trades to be consistent about, and no decisions
    // to have won or lost.
    const r = computeSickreScore({
      ...emptyBook,
      consistencyScore: 40,
      sample: { trades: 6, decided: 0 },
    });
    expect(r.components.find((c) => c.key === "winPct")!.counted).toBe(false);
    expect(r.components.find((c) => c.key === "consistency")!.score).toBe(40);
  });
});

describe("the sample floor — the other half of the same bug", () => {
  /**
   * Closing "no evidence" left "almost no evidence" wide open: ONE winning
   * trade scored **100/100**. Infinite profit factor (no loss to divide by), no
   * drawdown (nothing to fall from), a 100 % win rate (1 of 1) and zero
   * variance (one sample) — four components at their maximum, every one an
   * artifact of n=1 rather than a measurement of anything.
   */
  const oneWinner = {
    profitFactor: Infinity,
    avgWinLossRatio: null,
    maxDrawdownPctOfPeakPnl: 0,
    winPct: 100,
    recoveryFactor: null,
    consistencyScore: 100,
    sample: { trades: 1, decided: 1 },
  };

  it("no longer scores a single winning trade at 100", () => {
    const r = computeSickreScore(oneWinner);
    expect(r.score).toBeNull();
    expect(r.confidence).toEqual({
      level: "withheld",
      reason: "sample",
      tradesShort: 4,
    });
    expect(r.components.every((c) => !c.counted)).toBe(true);
  });

  it("counts down so the card can say how far off the score is", () => {
    for (const [trades, short] of [[0, 5], [1, 4], [3, 2], [4, 1]] as const) {
      const r = computeSickreScore({ ...oneWinner, sample: { trades, decided: trades } });
      expect(r.confidence, `trades=${trades}`).toEqual({
        level: "withheld",
        reason: "sample",
        tradesShort: short,
      });
    }
  });

  it("opens up exactly at the floor the rest of the codebase uses", () => {
    // MIN_SAMPLE is DEFAULT_MIN_SAMPLE and MIN_RATIO_DAYS — one number, one
    // place to change it. If someone lowers it, this fails and says so.
    expect(MIN_SAMPLE).toBe(5);
    const r = computeSickreScore({
      ...oneWinner,
      sample: { trades: MIN_SAMPLE, decided: MIN_SAMPLE },
    });
    expect(r.score).toBe(100);
    expect(r.confidence.level).toBe("provisional");
  });

  it("gates on the denominator each statistic was built from", () => {
    // Eight trades, all breakeven scratches: a path to measure, no decisions to
    // have won. Gating both on one count would answer one of them wrongly.
    const r = computeSickreScore({
      ...oneWinner,
      consistencyScore: 40,
      sample: { trades: 8, decided: 0 },
    });
    const counted = (k: string) => r.components.find((c) => c.key === k)!.counted;
    expect(counted("maxDrawdown")).toBe(true);
    expect(counted("consistency")).toBe(true);
    expect(counted("winPct")).toBe(false);
    expect(counted("profitFactor")).toBe(false);
    expect(counted("avgWinLoss")).toBe(false);
  });

  it("stops calling the score provisional once the sample is real", () => {
    const thin = computeSickreScore({
      ...oneWinner,
      sample: { trades: RELIABLE_SAMPLE - 1, decided: RELIABLE_SAMPLE - 1 },
    });
    const solid = computeSickreScore({
      ...oneWinner,
      sample: { trades: RELIABLE_SAMPLE, decided: RELIABLE_SAMPLE },
    });
    expect(thin.confidence).toEqual({ level: "provisional", trades: 29 });
    expect(solid.confidence).toEqual({ level: "ok", trades: 30 });
    // Same inputs, same number — the tier describes the evidence, never the
    // arithmetic. A score that changed with its own confidence label would be
    // two different scores sharing a name.
    expect(thin.score).toBe(solid.score);
  });

  it("withholds a composite that is really just one component", () => {
    // Enough trades, but only the process component has data: 15 of 115
    // weights. Reported separately from the sample case because the trader
    // cannot fix it by trading more — there is nothing to count down.
    const r = computeSickreScore({
      profitFactor: null,
      avgWinLossRatio: null,
      maxDrawdownPctOfPeakPnl: null,
      winPct: null,
      recoveryFactor: null,
      consistencyScore: null,
      processAdherencePct: 90,
      sample: { trades: 50, decided: 50 },
    });
    expect(r.coverage).toBe(15);
    expect(r.score).toBeNull();
    expect(r.confidence).toEqual({
      level: "withheld",
      reason: "coverage",
      tradesShort: 0,
    });
  });

  it("still shows a score built from most of its weight", () => {
    // A flawless book with no losing trade at all drops avgWinLoss and recovery
    // — 70 of 100 weights — and must still produce a number. The coverage gate
    // is for one component out of seven, not for an incomplete but substantial
    // picture.
    const r = computeSickreScore({
      ...oneWinner,
      sample: { trades: 40, decided: 40 },
    });
    expect(r.coverage).toBe(70);
    expect(r.score).toBe(100);
    expect(r.confidence.level).toBe("ok");
  });
});

describe("infinite profit factor", () => {
  it("scores the top band instead of being dropped as missing data", () => {
    // A book with winners and no losses has an infinite profit factor. Treating
    // that as null dropped the heaviest component (weight 25) and renormalized,
    // so flawless trading scored BELOW mediocre trading.
    expect(scoreFromBands(Infinity, RATIO_BANDS)).toBe(100);
  });

  it("keeps the component counted, unlike a null input", () => {
    const base = {
      avgWinLossRatio: 2.5,
      maxDrawdownPctOfPeakPnl: 10,
      winPct: 60,
      recoveryFactor: 3,
      consistencyScore: 80,
      sample: { trades: 40, decided: 40 },
    };
    const perfect = computeSickreScore({ ...base, profitFactor: Infinity });
    const noData = computeSickreScore({ ...base, profitFactor: null });

    const pf = perfect.components.find((c) => c.key === "profitFactor")!;
    expect(pf.counted).toBe(true);
    expect(pf.score).toBe(100);
    expect(perfect.coverage).toBe(noData.coverage + 25);
    // The point of the fix: perfection must not score below incomplete data.
    expect(perfect.score!).toBeGreaterThan(noData.score!);
  });

  it("still drops a component that genuinely has no data", () => {
    const r = computeSickreScore({
      profitFactor: null,
      avgWinLossRatio: null,
      maxDrawdownPctOfPeakPnl: null,
      winPct: null,
      recoveryFactor: null,
      consistencyScore: null,
      sample: { trades: 0, decided: 0 },
    });
    expect(r.score).toBeNull();
    expect(r.coverage).toBe(0);
  });
});

describe("the calibration knobs, pinned", () => {
  /**
   * These four constants ARE the score. Nothing else in the codebase reads
   * them, so without this block they are exported-but-unused — and worse,
   * changing one silently moves every score the user has ever seen, with no
   * test anywhere going red.
   *
   * Pinned by value rather than hidden, because that is the more useful of the
   * two: a deliberate recalibration now has to edit this file too, which is
   * exactly the moment to think about whether past numbers stay comparable.
   */
  it("holds the weights the spec transcribed", () => {
    // 25 + 20 + 20 + 15 + 10 + 10 = 100 before the seventh component,
    // 115 with it. The card divides by `maxCoverage`, not by a hardcoded 100.
    expect(PROCESS_ADHERENCE_WEIGHT).toBe(15);
    const full = computeSickreScore({
      profitFactor: 2.6,
      avgWinLossRatio: 2.6,
      maxDrawdownPctOfPeakPnl: 0,
      winPct: 60,
      recoveryFactor: 3.5,
      consistencyScore: 100,
      sample: { trades: 40, decided: 40 },
    });
    expect(full.maxCoverage).toBe(100);
    expect(
      computeSickreScore({
        profitFactor: 2.6,
        avgWinLossRatio: 2.6,
        maxDrawdownPctOfPeakPnl: 0,
        winPct: 60,
        recoveryFactor: 3.5,
        consistencyScore: 100,
        processAdherencePct: 50,
        sample: { trades: 40, decided: 40 },
      }).maxCoverage,
    ).toBe(100 + PROCESS_ADHERENCE_WEIGHT);
  });

  it("tops out win % at the documented 60", () => {
    // A 60 % win rate scores 100 and anything above it is capped, not
    // extrapolated. Moving this moves the win component for every trader.
    expect(WIN_PCT_TOP_THRESHOLD).toBe(60);
  });

  it("requires half the weight before calling something a composite", () => {
    expect(MIN_COVERAGE_SHARE).toBe(0.5);
  });

  it("scales consistency so cv = 5 exactly zeroes the score", () => {
    // score = 100 − cv × CONSISTENCY_SCALE, where cv = stdev / |mean|. At
    // scale 20, a coefficient of variation of 5 — a standard deviation five
    // times the average trade — lands exactly on 0. (The spec's literal
    // stdev/total reading was tried first and dropped: it shrinks as the
    // sample grows even when nothing about the volatility changed — see
    // `CONSISTENCY_SCALE`'s doc comment in risk-metrics.ts.)
    expect(CONSISTENCY_SCALE).toBe(20);
    const r = consistencyScore([60, -40]); // mean 10, stdev 50, cv 5
    expect(r.cv).toBeCloseTo(5, 10);
    expect(r.score).toBe(0);
  });
});
