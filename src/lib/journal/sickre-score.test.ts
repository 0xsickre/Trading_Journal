import { describe, expect, it } from "vitest";
import { CONSISTENCY_SCALE, consistencyScore } from "./risk-metrics";
import {
  FTMO_HEADROOM_WEIGHT,
  MIN_COVERAGE_SHARE,
  MIN_SAMPLE,
  PROCESS_ADHERENCE_WEIGHT,
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
    recoveryFactor: 3.5,
    consistencyScore: 100,
    sample: { trades: 40, decided: 40 },
  };

  it("scores a perfect book at 100 with full weight coverage", () => {
    const r = computeSickreScore(full);
    expect(r.score).toBe(100);
    // 25 + 20 + 15 + 5 + 5: the trade-derived components alone. Process and
    // FTMO headroom are optional and absent here.
    expect(r.coverage).toBe(70);
    expect(r.components.every((c) => c.counted)).toBe(true);
  });

  it("has no win % component to score at all", () => {
    // Removed from the composite, not merely reweighted. Its scale encodes
    // "higher is better", which is false for a book running a 3R target at a
    // deliberate 35–45 % win rate. It stays a KPI tile and a /reports metric.
    const keys = computeSickreScore(full).components.map((c) => c.key);
    expect(keys).not.toContain("winPct");
  });

  it("lists components heaviest first, optional ones in place", () => {
    // The radar takes its corner order from this list, and its whole claim is
    // that the same book draws the same shape every time. A component that
    // jumped to the end when it happened to have data would rotate the polygon
    // on data availability rather than on trading.
    const r = computeSickreScore({
      ...full,
      processAdherencePct: 80,
      ftmoHeadroomPct: 40,
    });
    expect(r.components.map((c) => c.key)).toEqual([
      "process",
      "maxDrawdown",
      "profitFactor",
      "consistency",
      "ftmoHeadroom",
      "avgWinLoss",
      "recovery",
    ]);
    expect(r.components.map((c) => c.weight)).toEqual([30, 25, 20, 15, 10, 5, 5]);
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
    // No drawdown yet → recovery factor is undefined, worth 5 of the 70.
    const r = computeSickreScore({ ...full, recoveryFactor: null });
    expect(r.coverage).toBe(65);
    expect(r.components.find((c) => c.key === "recovery")!.counted).toBe(false);
    // Everything else is perfect, so the score stays 100 rather than dropping
    // just because one input could not be computed.
    expect(r.score).toBe(100);
  });

  it("weights components as the table specifies", () => {
    // Only profit factor is perfect; everything else scores zero.
    const r = computeSickreScore({
      profitFactor: 2.6,
      avgWinLossRatio: null,
      maxDrawdownPctOfPeakPnl: 100,
      recoveryFactor: 0.5,
      consistencyScore: 0,
      sample: { trades: 40, decided: 40 },
    });
    // PF 100*20 + DD 0*25 + consistency 0*15 + recovery 0*5
    // over coverage 65 → 30.77
    expect(r.coverage).toBe(65);
    expect(r.score).toBeCloseTo(2000 / 65, 6);
  });

  it("adds each optional component only when supplied", () => {
    expect(computeSickreScore(full).components).toHaveLength(5);

    const withProcess = computeSickreScore({
      ...full,
      processAdherencePct: 80,
    });
    expect(withProcess.components).toHaveLength(6);
    expect(withProcess.coverage).toBe(100);
    expect(withProcess.score).toBeLessThan(100);

    const withBoth = computeSickreScore({
      ...full,
      processAdherencePct: 80,
      ftmoHeadroomPct: 40,
    });
    expect(withBoth.components).toHaveLength(7);
    expect(withBoth.coverage).toBe(110);
    expect(withBoth.score).toBeLessThan(withProcess.score!);
  });

  it("returns null when nothing can be computed", () => {
    const r = computeSickreScore({
      profitFactor: null,
      avgWinLossRatio: null,
      maxDrawdownPctOfPeakPnl: null,
      recoveryFactor: null,
      consistencyScore: null,
      sample: { trades: 0, decided: 0 },
    });
    expect(r.score).toBeNull();
    expect(r.coverage).toBe(0);
  });
});

describe("FTMO headroom — the component that knows what ends a challenge", () => {
  const base = {
    profitFactor: 2.6,
    avgWinLossRatio: 2.6,
    maxDrawdownPctOfPeakPnl: 0,
    recoveryFactor: 3.5,
    consistencyScore: 100,
    sample: { trades: 40, decided: 40 },
  };
  const headroom = (v: number | null | undefined) =>
    computeSickreScore({ ...base, ftmoHeadroomPct: v }).components.find(
      (c) => c.key === "ftmoHeadroom",
    );

  it("is absent entirely when no account is running a challenge", () => {
    // Not a zero axis on the radar and not a 0 in the list — absent, so the
    // other weights renormalize. A journal on a personal account is not
    // failing at prop-firm risk management; it is not playing that game.
    expect(headroom(null)).toBeUndefined();
    expect(headroom(undefined)).toBeUndefined();
    expect(computeSickreScore(base).maxCoverage).toBe(70);
  });

  it("scores zero when the account touched a limit, and counts it", () => {
    // THE DISTINCTION THE WHOLE MODULE EXISTS FOR, at one more level. Zero
    // headroom is a measurement — the account stood on its floor — and it must
    // drag the composite down, not vanish the way missing data does.
    const c = headroom(0)!;
    expect(c.score).toBe(0);
    expect(c.counted).toBe(true);
    expect(computeSickreScore({ ...base, ftmoHeadroomPct: 0 }).score).toBeLessThan(
      100,
    );
  });

  it("carries the percentage straight through, clamped at both ends", () => {
    expect(headroom(40)!.score).toBe(40);
    expect(headroom(100)!.score).toBe(100);
    expect(headroom(-20)!.score).toBe(0);
    expect(headroom(140)!.score).toBe(100);
  });

  it("is not gated by the trade sample, because its producer carries the evidence", () => {
    // `evaluateFtmo` answers null for a challenge with nothing closed in its
    // window, so there is no "measured zero" here to tell apart from an
    // absence. The challenge window is also not the dashboard's period, and
    // gating it on the dashboard's trade count would answer the wrong question.
    const r = computeSickreScore({
      ...base,
      ftmoHeadroomPct: 60,
      sample: { trades: 6, decided: 6 },
    });
    expect(r.components.find((c) => c.key === "ftmoHeadroom")!.counted).toBe(true);
  });
});

describe("an empty book scores nothing, not something", () => {
  /**
   * Reported from a live account with **zero trades entered**, which read
   * 33/100 with "Max drawdown: 100" on the card.
   *
   * The inputs below are each honest on their own: a book with no trades has
   * drawn down no money and has no variance in an empty set. But
   * `100 - 0 = 100` turned the first of those into a claim of flawless risk
   * management, asserted on no evidence — and the rebalance made that
   * component heavier still, at 25.
   */
  const emptyBook = {
    profitFactor: null, // these three already report themselves as missing
    avgWinLossRatio: null,
    recoveryFactor: null,
    maxDrawdownPctOfPeakPnl: 0, // ...and these two cannot
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

  it("reproduces the reported defect to prove the diagnosis, then removes it", () => {
    // The reported number was 33, on the weights of the day:
    // (100×20 + 0×15 + 0×10 + 0×15) / 60. The rebalance moved the figure — the
    // same inputs now work out to 2500/70 — but NOT the defect, which is that a
    // zero drawdown scores 100 and drags a composite up on an account that has
    // never traded. Feeding the same values with a non-empty sample still
    // produces it; the counts are the only thing that ever stood in the way.
    const asIfTraded = computeSickreScore({
      ...emptyBook,
      processAdherencePct: 0,
      sample: { trades: 12, decided: 12 },
    });
    expect(asIfTraded.score).toBeCloseTo(2500 / 70, 6);
    expect(
      asIfTraded.components.find((c) => c.key === "maxDrawdown")!.score,
    ).toBe(100);

    // The same account with nothing traded now has no score at all. Not 0 —
    // that 0 would have been process adherence alone, at 30 of 100 weights,
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

  it("drops profit factor over decisions but keeps consistency over trades", () => {
    // Different denominators, so different gates. A book of nothing but
    // breakeven scratches has trades to be consistent about, and no decisions
    // to have won or lost.
    const r = computeSickreScore({
      ...emptyBook,
      profitFactor: 2.6,
      consistencyScore: 40,
      sample: { trades: 6, decided: 0 },
    });
    expect(r.components.find((c) => c.key === "profitFactor")!.counted).toBe(
      false,
    );
    expect(r.components.find((c) => c.key === "consistency")!.score).toBe(40);
  });
});

describe("the sample floor — the other half of the same bug", () => {
  /**
   * Closing "no evidence" left "almost no evidence" wide open: ONE winning
   * trade scored **100/100**. Infinite profit factor (no loss to divide by), no
   * drawdown (nothing to fall from) and zero variance (one sample) — three
   * components at their maximum, every one an artifact of n=1 rather than a
   * measurement of anything. (It was four before win % left the composite.)
   */
  const oneWinner = {
    profitFactor: Infinity,
    avgWinLossRatio: null,
    maxDrawdownPctOfPeakPnl: 0,
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
    // Enough trades, but only the process component has data: 30 of 100
    // weights. Reported separately from the sample case because the trader
    // cannot fix it by trading more — there is nothing to count down.
    //
    // Worth re-proving after the rebalance, which nearly doubled that
    // component's weight: 30 of 100 is still under `MIN_COVERAGE_SHARE`, so
    // making process the heaviest component did not buy a book with no trades
    // a composite.
    const r = computeSickreScore({
      profitFactor: null,
      avgWinLossRatio: null,
      maxDrawdownPctOfPeakPnl: null,
      recoveryFactor: null,
      consistencyScore: null,
      processAdherencePct: 90,
      sample: { trades: 50, decided: 50 },
    });
    expect(r.coverage).toBe(30);
    expect(r.score).toBeNull();
    expect(r.confidence).toEqual({
      level: "withheld",
      reason: "coverage",
      tradesShort: 0,
    });
  });

  it("withholds it too when only the two non-trade components have data", () => {
    // The same gate, at the worst case the rebalance created: process 30 plus
    // FTMO headroom 10 is 40 of 110, and both can have values on a book with
    // nothing closed in the dashboard's period.
    const r = computeSickreScore({
      profitFactor: null,
      avgWinLossRatio: null,
      maxDrawdownPctOfPeakPnl: null,
      recoveryFactor: null,
      consistencyScore: null,
      processAdherencePct: 90,
      ftmoHeadroomPct: 90,
      sample: { trades: 50, decided: 50 },
    });
    expect(r.coverage).toBe(40);
    expect(r.maxCoverage).toBe(110);
    expect(r.score).toBeNull();
    expect(r.confidence.level).toBe("withheld");
  });

  it("still shows a score built from most of its weight", () => {
    // A flawless book with no losing trade at all drops avgWinLoss and recovery
    // — 60 of 70 weights — and must still produce a number. The coverage gate
    // is for one component out of seven, not for an incomplete but substantial
    // picture.
    const r = computeSickreScore({
      ...oneWinner,
      sample: { trades: 40, decided: 40 },
    });
    expect(r.coverage).toBe(60);
    expect(r.score).toBe(100);
    expect(r.confidence.level).toBe("ok");
  });
});

describe("infinite profit factor", () => {
  it("scores the top band instead of being dropped as missing data", () => {
    // A book with winners and no losses has an infinite profit factor. Treating
    // that as null dropped a component worth 20 and renormalized, so flawless
    // trading scored BELOW mediocre trading.
    expect(scoreFromBands(Infinity, RATIO_BANDS)).toBe(100);
  });

  it("keeps the component counted, unlike a null input", () => {
    const base = {
      avgWinLossRatio: 2.5,
      maxDrawdownPctOfPeakPnl: 10,
      recoveryFactor: 3,
      consistencyScore: 80,
      sample: { trades: 40, decided: 40 },
    };
    const perfect = computeSickreScore({ ...base, profitFactor: Infinity });
    const noData = computeSickreScore({ ...base, profitFactor: null });

    const pf = perfect.components.find((c) => c.key === "profitFactor")!;
    expect(pf.counted).toBe(true);
    expect(pf.score).toBe(100);
    expect(perfect.coverage).toBe(noData.coverage + 20);
    // The point of the fix: perfection must not score below incomplete data.
    expect(perfect.score!).toBeGreaterThan(noData.score!);
  });

  it("still drops a component that genuinely has no data", () => {
    const r = computeSickreScore({
      profitFactor: null,
      avgWinLossRatio: null,
      maxDrawdownPctOfPeakPnl: null,
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
   * These constants ARE the score. Nothing else in the codebase reads them, so
   * without this block they are exported-but-unused — and worse, changing one
   * silently moves every score the user has ever seen, with no test anywhere
   * going red.
   *
   * Pinned by value rather than hidden, because that is the more useful of the
   * two: a deliberate recalibration now has to edit this file too, which is
   * exactly the moment to think about whether past numbers stay comparable.
   * (They did not survive the rebalance, and that was the point of it — but it
   * was a decision taken here, in the open, not a drift.)
   */
  const perfect = {
    profitFactor: 2.6,
    avgWinLossRatio: 2.6,
    maxDrawdownPctOfPeakPnl: 0,
    recoveryFactor: 3.5,
    consistencyScore: 100,
    sample: { trades: 40, decided: 40 },
  };

  it("holds the rebalanced weights", () => {
    // 25 + 20 + 15 + 5 + 5 = 70 for the trade-derived components, 100 with
    // process, 110 with FTMO headroom too. The card divides by `maxCoverage`,
    // never by a hardcoded 100.
    expect(PROCESS_ADHERENCE_WEIGHT).toBe(30);
    expect(FTMO_HEADROOM_WEIGHT).toBe(10);

    const full = computeSickreScore(perfect);
    expect(full.maxCoverage).toBe(70);
    expect(
      Object.fromEntries(full.components.map((c) => [c.key, c.weight])),
    ).toEqual({
      maxDrawdown: 25,
      profitFactor: 20,
      consistency: 15,
      avgWinLoss: 5,
      recovery: 5,
    });

    expect(
      computeSickreScore({ ...perfect, processAdherencePct: 50 }).maxCoverage,
    ).toBe(70 + PROCESS_ADHERENCE_WEIGHT);
    expect(
      computeSickreScore({
        ...perfect,
        processAdherencePct: 50,
        ftmoHeadroomPct: 50,
      }).maxCoverage,
    ).toBe(70 + PROCESS_ADHERENCE_WEIGHT + FTMO_HEADROOM_WEIGHT);
  });

  it("makes process adherence the heaviest component in the score", () => {
    // Not a detail of the table — the whole argument for the rebalance. It is
    // the only component that does not depend on variance, and at forty trades
    // a year every other one is measured on a sample too thin to trust. The
    // README's thesis is "P&L is the consequence, process is the cause"; the
    // old weights gave the cause 15 of 115.
    const r = computeSickreScore({
      ...perfect,
      processAdherencePct: 50,
      ftmoHeadroomPct: 50,
    });
    const heaviest = Math.max(...r.components.map((c) => c.weight));
    expect(r.components.find((c) => c.key === "process")!.weight).toBe(heaviest);
    // And heavier than profit factor, which used to lead the table.
    expect(PROCESS_ADHERENCE_WEIGHT).toBeGreaterThan(
      r.components.find((c) => c.key === "profitFactor")!.weight,
    );
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

describe("scoreFromBands on a band table with finite edges", () => {
  /**
   * The shipped tables all cap the top band at a single score and floor the
   * bottom one at `-Infinity`, so two arms of the interpolation never run
   * against them. They are still the arms that decide what a caller-supplied
   * table does at its own edges, and both must answer a number rather than
   * `undefined` or `NaN` — a score is rendered straight onto the dashboard.
   */
  const BANDS = [
    { min: 2, scoreMin: 80, scoreMax: 100 },
    { min: 1, scoreMin: 40, scoreMax: 79 },
  ];

  it("awards the top of an open-ended top band rather than interpolating to infinity", () => {
    // There is no band above this one, so the upper edge is infinite and the
    // fraction through the band is meaningless. The best score is the answer.
    expect(scoreFromBands(2, BANDS)).toBe(100);
    expect(scoreFromBands(1000, BANDS)).toBe(100);
  });

  it("floors a value that falls below every band", () => {
    // 0.5 is under the lowest floor. The loop matches nothing, and the answer
    // is the worst score in the table — not null, which would drop the
    // component and quietly raise the composite.
    expect(scoreFromBands(0.5, BANDS)).toBe(40);
  });
});
