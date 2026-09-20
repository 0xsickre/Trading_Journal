import { describe, expect, it } from "vitest";
import { METRICS, getMetric, type MetricContext } from "./reports/metrics";
import { runReport } from "./reports/engine";
import { dimCtx, enrich, mkTrade, metricCtx, type TradeSpec } from "./reports/test-helpers";
import { computeRiskRatios, computeDailyDrawdown, MIN_RATIO_DAYS } from "./risk-ratios";
import { computeStats } from "./analytics";
import { EXACT_ZERO_RANGE } from "./breakeven";
import {
  computeSickreScore,
  FTMO_HEADROOM_WEIGHT,
  PROCESS_ADHERENCE_WEIGHT,
  RATIO_BANDS,
  RECOVERY_BANDS,
} from "./sickre-score";

/**
 * FORMULAS AGAINST THE SPEC, NOT AGAINST THEMSELVES.
 *
 * `book.fixture.test.ts` proves the code agrees with paper arithmetic for one
 * book. This file asks a different question: does the code do what `README.md`
 * §Metrics CLAIMS it does. The difference matters — a formula can be internally
 * consistent and still not be the one that was promised, and then it is the
 * documentation lying to the user.
 *
 * Every assertion below quotes the README sentence it locks down. Change a
 * formula and the test fails, forcing the README to change too — or the other
 * way round.
 *
 * The second half of the file is systematic: EVERY metric in the registry
 * through EVERY degenerate shape a book can take. Round 3 sorted eight findings
 * into "a `0` impersonating *no data*", each one found by hand. This is the net
 * that catches the whole class at once.
 */

/** One trade per day, with the given net result. */
function dailyBook(pnls: number[], startDay = 2): TradeSpec[] {
  return pnls.map((net, i) => {
    const d = String(startDay + i).padStart(2, "0");
    return {
      id: `d${i}`,
      net,
      // 18:00Z lands on the same calendar day in every zone west of UTC+6, so
      // the choice of timezone moves no trade between days.
      openedAt: `2026-03-${d}T14:00:00Z`,
      closedAt: `2026-03-${d}T18:00:00Z`,
      r: net / 100,
    };
  });
}

const ctx: MetricContext = { ...metricCtx, range: EXACT_ZERO_RANGE };

// ---------------------------------------------------------------------------
// THE RATIOS — the one part of the spec no test used to assert
// ---------------------------------------------------------------------------

describe("Sharpe, Sortino and Calmar — README §Risk", () => {
  /**
   * Five days, worked out on paper:
   *
   *   day      P&L    cumulative   peak    fall
   *   03-02   +100        100       100     0
   *   03-03    -50         50       100   -50
   *   03-04   +200        250       250     0
   *   03-05    -50        200       250   -50
   *   03-06   +100        300       300     0
   *
   *   total              = 300
   *   mean daily         = 300 / 5 = 60
   *   deviations         = 40, −110, 140, −110, 40
   *   Σ of squares       = 1600 + 12100 + 19600 + 12100 + 1600 = 47,000
   *   σ (population)     = √(47,000 / 5) = √9,400
   *   downside Σ         = 0 + 2500 + 0 + 2500 + 0 = 5,000
   *   downside deviation = √(5,000 / 5) = √1,000
   *   day span           = 03-02 … 03-06 = 5 calendar days
   *   periodsPerYear     = 5 × 365 / 5 = 365
   *   max drawdown       = 50  (two falls of −50, none deeper)
   *   annualised return  = 300 × (365 / 5) = 21,900
   */
  const PNLS = [100, -50, 200, -50, 100];
  const book = enrich(dailyBook(PNLS));
  const points = book.map((e) => ({ day: e.closeDay, at: e.closedAt, pnl: e.pnl }));
  const ratios = computeRiskRatios(points, 50);

  it("measures periodsPerYear from the data instead of assuming 252", () => {
    // README: "periodsPerYear = (trading days × 365) / calendar days spanned —
    // derived from the data instead of hardcoded at 252."
    expect(ratios.days).toBe(5);
    expect(ratios.spanDays).toBe(5);
    expect(ratios.periodsPerYear).toBeCloseTo(365, 10);
    expect(ratios.periodsPerYear).not.toBeCloseTo(252, 0);
  });

  it("Sharpe is mean daily P&L / σ, annualised by the square root", () => {
    // README: "mean daily P&L / σ × √periodsPerYear"
    expect(ratios.meanDaily).toBeCloseTo(60, 10);
    expect(ratios.stdevDaily).toBeCloseTo(Math.sqrt(9400), 10);
    expect(ratios.sharpe).toBeCloseTo((60 / Math.sqrt(9400)) * Math.sqrt(365), 10);
  });

  it("Sortino keeps the numerator but uses downside deviation only", () => {
    // README: "the numerator only looks at falls below zero — the denominator
    // still counts every day, not just losing ones."
    //
    // Note the exact meaning: the SQUARES are taken from losing days only, but
    // divided by the TOTAL number of days. Dividing by the count of losing days
    // would reward a book for losing rarely twice over — once in the mean, and
    // again in the denominator.
    expect(ratios.downsideDeviation).toBeCloseTo(Math.sqrt(1000), 10);
    expect(ratios.sortino).toBeCloseTo((60 / Math.sqrt(1000)) * Math.sqrt(365), 10);
    // Sortino must be LARGER than Sharpe here: same numerator, smaller
    // denominator.
    expect(ratios.sortino!).toBeGreaterThan(ratios.sharpe!);
  });

  it("Calmar is the annualised return divided by drawdown", () => {
    // README: "annualised return / max drawdown"
    expect(ratios.calmar).toBeCloseTo((300 * (365 / 5)) / 50, 10);
  });

  it("Sortino is null when no day was negative — growth is not risk", () => {
    // README: "`null` when no day was negative — growth is not risk."
    const winners = enrich(dailyBook([10, 20, 30, 40, 50]));
    const r = computeRiskRatios(
      winners.map((e) => ({ day: e.closeDay, at: e.closedAt, pnl: e.pnl })),
      0,
    );
    expect(r.downsideDeviation).toBe(0);
    expect(r.sortino).toBeNull();
    // Sharpe survives: the days still differ from one another.
    expect(r.sharpe).not.toBeNull();
    // Calmar does not: with no drawdown there is nothing to divide by.
    expect(r.calmar).toBeNull();
  });

  it("all three ratios are null below MIN_RATIO_DAYS", () => {
    // README: "All three ratios return `null` below `MIN_RATIO_DAYS` (5)."
    expect(MIN_RATIO_DAYS).toBe(5);
    const four = enrich(dailyBook([100, -50, 200, -50]));
    const r = computeRiskRatios(
      four.map((e) => ({ day: e.closeDay, at: e.closedAt, pnl: e.pnl })),
      50,
    );
    expect(r.days).toBe(4);
    expect(r.sharpe).toBeNull();
    expect(r.sortino).toBeNull();
    expect(r.calmar).toBeNull();
  });

  it("σ = 0 gives a null Sharpe instead of dividing by zero", () => {
    // Five identical days: no dispersion, so no ratio either.
    const flat = enrich(dailyBook([25, 25, 25, 25, 25]));
    const r = computeRiskRatios(
      flat.map((e) => ({ day: e.closeDay, at: e.closedAt, pnl: e.pnl })),
      0,
    );
    expect(r.stdevDaily).toBe(0);
    expect(r.sharpe).toBeNull();
  });
});

describe("Avg daily DD — README §Risk", () => {
  it("a day with no fall enters the denominator as 0", () => {
    // README: "Average intraday fall from that day's high. A day with no fall
    // enters as 0."
    //
    // On paper, one trade per day: the day starts at a peak of 0, so a losing
    // day falls by its full amount and a winning day does not fall at all.
    //
    //   +100 → 0 ; −50 → −50 ; +200 → 0 ; −50 → −50 ; +100 → 0
    //   sum = −100 ; over 5 days = −20
    const book = enrich(dailyBook([100, -50, 200, -50, 100]));
    const dd = computeDailyDrawdown(
      book.map((e) => ({ day: e.closeDay, at: e.closedAt, pnl: e.pnl })),
    );
    expect(dd.days).toBe(5);
    expect(dd.avgMoney).toBeCloseTo(-20, 10);
    expect(dd.worstMoney).toBeCloseTo(-50, 10);

    // An average over losing days ONLY would be −50 — a different number and a
    // different question. This asserts the denominator really holds all five.
    expect(dd.avgMoney).not.toBeCloseTo(-50, 10);
  });
});

// ---------------------------------------------------------------------------
// README CONTRACTS THAT ARE EASY TO LOSE
// ---------------------------------------------------------------------------

describe("Profit factor and expectancy — README §Money and counting", () => {
  it("profit factor is Infinity with no loss, null with nothing to divide", () => {
    // README: "`Infinity` when there is no loss — a real maximum, not missing
    // data. `null` only when there is nothing to divide."
    const allWin = computeStats(dailyBook([10, 20, 30]).map(mkTrade), "net", EXACT_ZERO_RANGE);
    expect(allWin.profitFactor).toBe(Infinity);

    const empty = computeStats([], "net", EXACT_ZERO_RANGE);
    expect(empty.profitFactor).toBeNull();

    // All breakeven: there are trades, but neither profit nor loss to divide.
    const flat = computeStats(dailyBook([0, 0, 0]).map(mkTrade), "net", EXACT_ZERO_RANGE);
    expect(flat.profitFactor).toBeNull();
  });

  it("breakeven trades are out of the win rate's denominator", () => {
    // README: "**Breakeven trades are out of the denominator**"
    //
    // Two wins, one loss, three breakeven → 2/3 = 66.7 %, not 2/6 = 33.3 %.
    const s = computeStats(
      dailyBook([100, 100, -100, 0, 0, 0]).map(mkTrade),
      "net",
      EXACT_ZERO_RANGE,
    );
    expect(s.wins).toBe(2);
    expect(s.losses).toBe(1);
    expect(s.breakeven).toBe(3);
    expect(s.winRate).toBeCloseTo((2 / 3) * 100, 10);
    expect(s.winRate).not.toBeCloseTo((2 / 6) * 100, 10);
  });

  it("expectancy is computed over the R population only", () => {
    // README: "Computed over the R population only — only a trade with a stop
    // has an R."
    //
    // Two trades with an R, four without. Expectancy may see only the first
    // two, so it must stay the same once the other four are added.
    const withR: TradeSpec[] = [
      { id: "a", net: 200, r: 2, closedAt: "2026-03-02T18:00:00Z" },
      { id: "b", net: -100, r: -1, closedAt: "2026-03-03T18:00:00Z" },
    ];
    const withoutR: TradeSpec[] = [
      { id: "c", net: 500, r: null, closedAt: "2026-03-04T18:00:00Z" },
      { id: "d", net: -500, r: null, closedAt: "2026-03-05T18:00:00Z" },
      { id: "e", net: 700, r: null, closedAt: "2026-03-06T18:00:00Z" },
      { id: "f", net: -700, r: null, closedAt: "2026-03-09T18:00:00Z" },
    ];
    const only = computeStats(withR.map(mkTrade), "net", EXACT_ZERO_RANGE);
    const mixed = computeStats([...withR, ...withoutR].map(mkTrade), "net", EXACT_ZERO_RANGE);

    // On paper: the R population is 1 win (2R) and 1 loss (−1R).
    // rWinRate = 1/2 ; expectancy = 0.5 × 2 + 0.5 × (−1) = 0.5
    expect(only.expectancy).toBeCloseTo(0.5, 10);
    expect(mixed.expectancy).toBeCloseTo(0.5, 10);

    // Control that those four really entered the book, just not expectancy.
    expect(mixed.count).toBe(6);
    expect(only.count).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// THE SYSTEMATIC HALF — every metric through every degenerate shape
// ---------------------------------------------------------------------------

/**
 * The shapes a book can take. The same set `book.fixture.test.ts` uses for a
 * handful of figures, here against ALL of the metrics at once.
 */
const SHAPES: Record<string, TradeSpec[]> = {
  empty: [],
  "one trade": dailyBook([100]).slice(0, 1),
  "all winners": dailyBook([100, 200, 300, 50, 150]),
  "all losers": dailyBook([-100, -200, -300, -50, -150]),
  "all breakeven": dailyBook([0, 0, 0, 0, 0]),
  "no R population": dailyBook([100, -50, 200]).map((t) => ({ ...t, r: null })),
  "one day, several trades": [
    { id: "s1", net: 100, closedAt: "2026-03-02T15:00:00Z", r: 1 },
    { id: "s2", net: -50, closedAt: "2026-03-02T16:00:00Z", r: -0.5 },
    { id: "s3", net: 25, closedAt: "2026-03-02T17:00:00Z", r: 0.25 },
  ],
};

describe("every metric through every shape of book", () => {
  it("the registry holds thirty-eight metrics and no duplicate key", () => {
    // The count is hardcoded on purpose: the loop below runs EVERY metric
    // through every shape, so a metric added without thought quietly gains
    // twenty-one new assertions and no attention. This line is that attention —
    // it fails when the registry changes and asks someone to confirm the change
    // was deliberate.
    //
    // 30 → 33 when `winner_target_attainment`, `avg_entry_slip` and
    // `total_slip_r` arrived from the dashboard, where they had stopped being
    // displayed. 33 → 34 with `setup_score`, when the setup grade stopped being
    // a typed letter and became the share of playbook criteria met. 34 → 38
    // with the four risk-taken metrics, when `equity_at_entry` made the risk a
    // trade actually carried measurable for the first time.
    expect(METRICS).toHaveLength(38);
    expect(new Set(METRICS.map((m) => m.key)).size).toBe(38);
  });

  for (const [shapeName, specs] of Object.entries(SHAPES)) {
    const group = enrich(specs);

    for (const metric of METRICS) {
      it(`${metric.key} · ${shapeName}`, () => {
        const value = metric.compute(group, ctx, undefined);

        // NaN propagates through every sum and formats as "NaN" on screen. No
        // metric may produce one, on any shape.
        if (typeof value === "number") {
          expect(Number.isNaN(value), `${metric.key} returned NaN`).toBe(false);
        }

        // The permitted shapes are a number (Infinity included) and null.
        // `undefined` would mean a branch was forgotten, not that there is no
        // answer.
        expect(
          value === null || typeof value === "number",
          `${metric.key} returned ${typeof value}`,
        ).toBe(true);
      });
    }
  }
});

/**
 * ZERO VERSUS NULL — where the line is actually drawn.
 *
 * The first version of this file asserted that EVERY metric must return `null`
 * on an empty book. It failed on ten metrics, and checking showed the assertion
 * was wrong, not the code.
 *
 * `computeStats` deliberately returns 0 for `winRate`, `avgR`, `best`, `worst`
 * and the other aggregates over an empty population, and carries `count`,
 * `wins`, `losses` and `expectancySample` alongside them so the caller knows
 * how big the sample is. The decision to "show —" belongs to the PRESENTATION
 * layer; that is exactly what fixes `W1` and `W2` did in `dashboard.tsx` and
 * `metrics-panel.tsx`. Turning the library into nulls would dismantle that fix
 * and move the decision somewhere that does not know the context.
 *
 * For reports the question is unreachable anyway: `runReport` builds groups out
 * of trades (`arr.push(t)`), so a group with zero trades cannot exist. The test
 * below asserts that outright — because that unreachability is precisely what
 * makes the zeros harmless.
 *
 * What remains a real assertion here is the narrower set: metrics the README
 * PROMISES as `null`, and which as 0 would state something untrue.
 */
describe("zero versus null", () => {
  it("a report cannot produce an empty group", () => {
    const result = runReport({
      trades: enrich(SHAPES["all winners"]),
      dimension: "direction",
      metricKeys: METRICS.map((m) => m.key),
      dimensionContext: dimCtx(),
      metricContext: ctx,
      minSample: 1,
    });
    const rows = result!.rows;
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.n, "a group with no trades must not exist").toBeGreaterThan(0);
    }
  });

  it("metrics promised as null do not return 0 when the population is absent", () => {
    // Each of these would state something untrue as a 0: "profit factor 0"
    // means the book does not make money, "Sharpe 0" that there is no return,
    // "target attainment 0 %" that no target was ever reached. Missing data is
    // not a finding.
    const promisedNull = [
      "profit_factor",
      "recovery_factor",
      "sharpe",
      "sortino",
      "calmar",
      "avg_hold",
      "cost_pct_of_gross",
      "avg_win_loss",
      "avg_planned_r",
      "delta_r",
      "avg_mae_r",
      "target_attainment",
      "follow_rate",
    ];
    const empty = enrich([]);
    for (const key of promisedNull) {
      const m = getMetric(key)!;
      expect(m, `${key} is not in the registry`).toBeDefined();
      expect(
        m.compute(empty, ctx, undefined),
        `${key} must be null with no population`,
      ).toBeNull();
    }
  });

  it("sums are honestly 0 over an empty set", () => {
    // The other side of the same line: zero trades DID earn zero and pay zero
    // in commissions. Here a null would be the wrong answer.
    const empty = enrich([]);
    for (const key of ["net_pnl", "gross_pnl", "total_r", "total_fees", "total_swap", "trade_count"]) {
      expect(getMetric(key)!.compute(empty, ctx, undefined), key).toBe(0);
    }
  });
});

describe("getMetric", () => {
  it("finds every key in the registry and refuses an unknown one", () => {
    for (const m of METRICS) expect(getMetric(m.key)).toBe(m);
    expect(getMetric("no_such_metric")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// SICKRE SCORE — the tables and weights exactly as the README states them
// ---------------------------------------------------------------------------

describe("Sickre Score — README §Sickre Score", () => {
  it("the weights are exactly the ones in the README's table", () => {
    // README: "Process adherence 30 | Max drawdown 25 | Profit factor 20 |
    // Consistency 15 | FTMO headroom 10 | Avg win/loss 5 | Recovery factor 5".
    //
    // A weight is the one number in the score that no other test would catch:
    // an error here moves EVERY score, and no individual component would report
    // anything. So it is read from what the score actually returns, not from
    // the constant.
    const full = computeSickreScore({
      profitFactor: 3,
      avgWinLossRatio: 3,
      maxDrawdownPctOfPeakPnl: 0,
      recoveryFactor: 5,
      consistencyScore: 100,
      processAdherencePct: 100,
      ftmoHeadroomPct: 100,
      sample: { trades: 100, decided: 100 },
    });
    const w = Object.fromEntries(full.components.map((c) => [c.key, c.weight]));
    expect(w).toEqual({
      process: PROCESS_ADHERENCE_WEIGHT,
      maxDrawdown: 25,
      profitFactor: 20,
      consistency: 15,
      ftmoHeadroom: FTMO_HEADROOM_WEIGHT,
      avgWinLoss: 5,
      recovery: 5,
    });
    expect(PROCESS_ADHERENCE_WEIGHT).toBe(30);
    expect(FTMO_HEADROOM_WEIGHT).toBe(10);

    // README: "The trade-derived components total 70; with process it is 100,
    // with both optional ones 110." The optional ones are added on top of the
    // base and the score renormalizes by coverage.
    expect(25 + 20 + 15 + 5 + 5).toBe(70);
    expect(full.maxCoverage).toBe(110);
  });

  it("win % no longer exists as a component of the score", () => {
    // README: "Win % is out of the score entirely, not merely reweighted… Win
    // rate stays as a KPI tile on the dashboard and as a /reports metric."
    const keys = computeSickreScore({
      profitFactor: 3,
      avgWinLossRatio: 3,
      maxDrawdownPctOfPeakPnl: 0,
      recoveryFactor: 5,
      consistencyScore: 100,
      sample: { trades: 100, decided: 100 },
    }).components.map((c) => c.key);
    expect(keys).not.toContain("winPct");
  });

  it("process adherence is the heaviest component in the composite", () => {
    // README: "Process adherence is the heaviest component, at 30. It is the
    // only one that does not depend on variance." The claim from the prose,
    // checked against the numbers.
    const r = computeSickreScore({
      profitFactor: 3,
      avgWinLossRatio: 3,
      maxDrawdownPctOfPeakPnl: 0,
      recoveryFactor: 5,
      consistencyScore: 100,
      processAdherencePct: 100,
      ftmoHeadroomPct: 100,
      sample: { trades: 100, decided: 100 },
    });
    expect(PROCESS_ADHERENCE_WEIGHT).toBe(
      Math.max(...r.components.map((c) => c.weight)),
    );
  });

  it("the ratio table starts at 1.8 and ends at 2.6, as the README says", () => {
    // README: "Band table, 1.8 → 2.6 maps to 20 → 100"
    const floors = RATIO_BANDS.map((b) => b.min).filter((m) => Number.isFinite(m));
    expect(Math.min(...floors)).toBe(1.8);
    expect(Math.max(...floors)).toBe(2.6);
    // Below the lowest floor it drops to 20, not to 0 — 20 is a floor, not an
    // absence.
    expect(RATIO_BANDS.at(-1)!.scoreMin).toBe(20);
    expect(RATIO_BANDS[0].scoreMax).toBe(100);
  });

  it("the recovery table runs from 1.0 to 3.5", () => {
    // README: "Its own table, 1.0 → 3.5"
    const floors = RECOVERY_BANDS.map((b) => b.min).filter((m) => Number.isFinite(m));
    expect(Math.min(...floors)).toBe(1.0);
    expect(Math.max(...floors)).toBe(3.5);
    // A recovery below 1.0 IS zero: a book that has not made back its drawdown
    // has not recovered. Unlike the ratio table, zero here is not missing data.
    expect(RECOVERY_BANDS.at(-1)!.scoreMax).toBe(0);
  });

  it("FTMO headroom is 100 minus the closest approach, and absent with no challenge", () => {
    // README: "`100 − closest approach to a limit`, in %"… "When no account
    // runs FTMO mode the component is absent — not 100."
    const at = (ftmoHeadroomPct: number | null) =>
      computeSickreScore({
        profitFactor: 2, avgWinLossRatio: 2, maxDrawdownPctOfPeakPnl: 10,
        recoveryFactor: 2, consistencyScore: 50, ftmoHeadroomPct,
        sample: { trades: 100, decided: 100 },
      }).components.find((c) => c.key === "ftmoHeadroom");

    expect(at(90)!.score).toBeCloseTo(90, 6);
    // Zero is a measurement — the account stood on its limit — and must count.
    expect(at(0)!.score).toBe(0);
    expect(at(0)!.counted).toBe(true);
    // With no challenge there is no axis and no row, so the rest renormalize.
    expect(at(null)).toBeUndefined();
  });

  it("max drawdown is 100 minus the percentage, on the peak-P&L base", () => {
    // README: "`100 − maxPctOfPeakPnl`", and explicitly: that base is NEVER
    // displayed, it exists only to keep the score comparable with TradeZella's.
    const at = (pct: number | null) =>
      computeSickreScore({
        profitFactor: 2, avgWinLossRatio: 2, maxDrawdownPctOfPeakPnl: pct,
        recoveryFactor: 2, consistencyScore: 50,
        sample: { trades: 100, decided: 100 },
      }).components.find((c) => c.key === "maxDrawdown");

    expect(at(40)!.score).toBeCloseTo(60, 6);
    expect(at(0)!.score).toBeCloseTo(100, 6);
    // `null` means "the curve never fell from a peak above zero" — the
    // component is then NOT counted, instead of 100 − 0 grading an empty
    // account as flawless. That is finding S1, and this is its guard.
    expect(at(null)!.counted).toBe(false);
  });
});
