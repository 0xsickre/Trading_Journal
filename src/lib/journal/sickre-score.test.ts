import { describe, expect, it } from "vitest";
import {
  RATIO_BANDS,
  RECOVERY_BANDS,
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

    // The same account with nothing traded now scores only what it can defend.
    const empty = computeSickreScore({ ...emptyBook, processAdherencePct: 0 });
    expect(empty.score).toBe(0); // process adherence alone, honestly measured
    expect(empty.coverage).toBe(15);
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
