/**
 * Metric catalogue.
 *
 * Every entry delegates to a function that already exists and is already
 * tested — this file is a registry, not a second implementation. If a metric
 * here ever computes something inline that `analytics.ts` or a Phase 1 module
 * also computes, the two will drift and one of them will be wrong.
 */

import {
  computeExitEfficiencyStats,
  computeSlippageStats,
  computeStats,
  type PnlMode,
  type RealizedTrade,
} from "../analytics";
import { buildBalanceTimeline, computeDrawdown } from "../balance";
import { computeCostStats } from "../costs";
import { computeExcursionStats } from "../excursion";
import { computeHoldTime } from "../hold-time";
import {
  avgWinLossRatio,
  computePlannedRStats,
  consistencyScore,
  recoveryFactor,
} from "../risk-metrics";
import {
  computeDailyDrawdown,
  computeRiskRatios,
  type DayPnlPoint,
} from "../risk-ratios";
import type { BreakevenRange } from "../breakeven";
import type { EnrichedTrade } from "../enriched-trade";
import type { MetricUnit } from "../units";
import { scorable, setupScoreFromTrade } from "../setup-score";
import { computeFollowRate, type RuleLookup } from "./playbook-dimensions";

export type MetricContext = {
  pnlBasis: PnlMode;
  range: BreakevenRange;
  /**
   * `currency` USED TO SIT here and nothing read it.
   *
   * A Step 9 finding. None of the thirty metrics touched it, nor the engine,
   * nor any component — and it was REQUIRED, so every caller had to invent a
   * value. `breakdownByField` invented `"USD"`, which told the reader the
   * dashboard's breakdown was in dollars. It was not: the function returns raw
   * numbers the caller formats in its own account's currency.
   *
   * Formatting has its own context (`units.ts`, `FormatContext.currency`) and
   * that one genuinely cares about currency. Two contexts sharing a field name,
   * one of which does nothing, are exactly the shape of error Step 5 exists for.
   */
  /**
   * Playbook rule answers, when loaded. Rides on the context for the same
   * reason the custom dimensions do: the catalogue is process-wide and this
   * data is per user and per request.
   */
  rules?: RuleLookup;
};

export type ReportMetric = {
  key: string;
  label: string;
  unit: MetricUnit;
  /** Short explanation surfaced as a column tooltip. */
  hint?: string;
  /** Higher is better — drives the "best category" summary and bar colouring. */
  higherIsBetter: boolean;
  /**
   * `scope` is the bucket (or buckets, in a pivot cell) that define this group.
   *
   * Almost every metric ignores it: net P&L over a group of trades is net P&L
   * whatever the group was named. It exists for metrics whose meaning depends
   * on WHICH bucket this is — `follow_rate` on a per-rule report must count
   * answers to THAT rule, not every answer the same trades happen to carry.
   * Passing the buckets keeps that generic: the engine never checks a
   * dimension key.
   */
  compute(
    group: EnrichedTrade[],
    ctx: MetricContext,
    scope?: readonly string[],
  ): number | null;
};

const realized = (group: EnrichedTrade[]): RealizedTrade[] =>
  group.map((e) => e.trade);

/**
 * Negation that cannot produce `-0`.
 *
 * `-0` is a real IEEE value and it survives all the way to the formatter, where
 * a book of perfect fills would read `-0.00R` — a number that looks like a
 * rounding artefact of some small loss rather than what it is, which is no
 * slippage at all.
 */
const negate = (n: number): number => (n === 0 ? 0 : -n);

/** computeStats is the workhorse; memoized per group to avoid recomputation. */
function statsOf(group: EnrichedTrade[], ctx: MetricContext) {
  return computeStats(realized(group), ctx.pnlBasis, ctx.range);
}

/** Peak-to-trough of cumulative P&L inside the group, in money. Negative or 0. */
function maxDrawdownOf(group: EnrichedTrade[]): number {
  return computeDrawdown(
    buildBalanceTimeline(
      0,
      group.map((e) => ({ at: e.closedAt ?? "", pnl: e.pnl })),
    ),
  ).maxMoney;
}

/**
 * Daily P&L points for the risk ratios.
 *
 * `closeDay` is already resolved in the ACCOUNT's zone by `enrichTrades`, so
 * nothing here has to know about timezones — which is the only reason these
 * ratios can live in a registry that has no account on hand.
 */
function dayPointsOf(group: EnrichedTrade[]): DayPnlPoint[] {
  return group.map((e) => ({ day: e.closeDay, at: e.closedAt, pnl: e.pnl }));
}

export const METRICS: ReportMetric[] = [
  {
    key: "net_pnl",
    label: "Net P&L",
    unit: "money",
    higherIsBetter: true,
    compute: (g, ctx) => statsOf(g, ctx).netSum,
  },
  {
    key: "gross_pnl",
    label: "Gross P&L",
    unit: "money",
    higherIsBetter: true,
    compute: (g, ctx) => statsOf(g, ctx).grossSum,
  },
  {
    key: "trade_count",
    label: "Trades",
    unit: "count",
    higherIsBetter: true,
    compute: (g) => g.length,
  },
  {
    key: "win_rate",
    label: "Win %",
    unit: "pct",
    hint: "Breakeven trades stay out of the denominator.",
    higherIsBetter: true,
    compute: (g, ctx) => statsOf(g, ctx).winRate,
  },
  {
    key: "profit_factor",
    label: "Profit factor",
    unit: "ratio",
    // Infinity is kept on purpose and is NOT an error: a group with no losing
    // trade has the best possible profit factor, which is a different statement
    // from `target_attainment`'s null, meaning "no denominator exists at all".
    // `engine.test.ts` pins both halves of that distinction.
    hint: "Gross profit / gross loss. ∞ means the group holds no losing trade at all; empty only when the group has no trades.",
    higherIsBetter: true,
    compute: (g, ctx) => statsOf(g, ctx).profitFactor,
  },
  {
    key: "expectancy",
    label: "Expectancy",
    unit: "r",
    higherIsBetter: true,
    compute: (g, ctx) => statsOf(g, ctx).expectancy,
  },
  {
    key: "avg_r",
    label: "Avg R",
    unit: "r",
    higherIsBetter: true,
    compute: (g, ctx) => statsOf(g, ctx).avgR,
  },
  {
    key: "total_r",
    label: "Total R",
    unit: "r",
    higherIsBetter: true,
    compute: (g, ctx) => statsOf(g, ctx).totalR,
  },
  {
    key: "avg_win",
    label: "Avg win",
    unit: "r",
    higherIsBetter: true,
    compute: (g, ctx) => statsOf(g, ctx).avgWinR,
  },
  {
    key: "avg_loss",
    label: "Avg loss",
    unit: "r",
    higherIsBetter: true,
    compute: (g, ctx) => statsOf(g, ctx).avgLossR,
  },
  {
    key: "avg_win_loss",
    label: "Avg win/loss",
    unit: "ratio",
    higherIsBetter: true,
    // Money, not R — matching how the composite score's band table is fed.
    compute: (g, ctx) => {
      const s = statsOf(g, ctx);
      return avgWinLossRatio(s.avgWinMoney, s.avgLossMoney);
    },
  },
  {
    key: "best",
    label: "Best",
    unit: "money",
    higherIsBetter: true,
    compute: (g, ctx) => statsOf(g, ctx).best,
  },
  {
    key: "worst",
    label: "Worst",
    unit: "money",
    higherIsBetter: true,
    compute: (g, ctx) => statsOf(g, ctx).worst,
  },
  {
    key: "max_drawdown",
    label: "Max drawdown",
    unit: "money",
    hint: "Fall of cumulative P&L within the group.",
    higherIsBetter: true,
    compute: (g) => maxDrawdownOf(g),
  },
  {
    key: "avg_daily_dd",
    label: "Avg daily DD",
    unit: "money",
    hint: "Average drop within a day, measured from that day's high. A day with no drop enters as 0.",
    higherIsBetter: true,
    compute: (g) => computeDailyDrawdown(dayPointsOf(g)).avgMoney,
  },
  {
    key: "recovery_factor",
    label: "Recovery factor",
    unit: "ratio",
    hint: "Net profit / max drawdown. Empty when there is no drawdown.",
    higherIsBetter: true,
    compute: (g, ctx) =>
      recoveryFactor(statsOf(g, ctx).netSum, maxDrawdownOf(g)),
  },
  {
    key: "sharpe",
    label: "Sharpe",
    unit: "ratio",
    hint: "Mean daily P&L / its standard deviation, annualized by the number of days actually traded (not a fixed 252) — right for a book that doesn't trade every session, but not directly comparable to a Sharpe ratio quoted elsewhere assuming daily activity. Needs at least 5 days.",
    higherIsBetter: true,
    compute: (g) => computeRiskRatios(dayPointsOf(g), maxDrawdownOf(g)).sharpe,
  },
  {
    key: "sortino",
    label: "Sortino",
    unit: "ratio",
    hint: "Like Sharpe, but only losing days count toward the downside — the denominator still divides by every day, so a book that rarely loses isn't rewarded twice. Empty while no day has lost money.",
    higherIsBetter: true,
    compute: (g) => computeRiskRatios(dayPointsOf(g), maxDrawdownOf(g)).sortino,
  },
  {
    key: "calmar",
    label: "Calmar",
    unit: "ratio",
    hint: "Annualized return / max drawdown. The recovery factor divided by how long it took. Annualized the same measured-from-data way as Sharpe, so it isn't directly comparable to a Calmar ratio from a platform that assumes daily trading.",
    higherIsBetter: true,
    compute: (g) => computeRiskRatios(dayPointsOf(g), maxDrawdownOf(g)).calmar,
  },
  {
    key: "consistency",
    label: "Consistency",
    unit: "count",
    higherIsBetter: true,
    compute: (g) => {
      /*
       * `count === 0` IS THE ONLY CASE THAT GETS A NULL, AND THE DISTINCTION IS
       * THE WHOLE POINT.
       *
       * `consistencyScore` answers `score: 0` for two very different books: one
       * with no trades, and one that is losing money ("a losing book has no
       * consistency to speak of"). The second is a verdict on real trades and
       * belongs on screen as a zero. The first is no evidence at all, and
       * publishing it put a confident `0` next to five honest dashes on an
       * empty account — the same defect `sickre-score.ts` was rewritten to fix
       * one layer up, surviving down here because this registry read `.score`
       * and ignored the `count` sitting beside it.
       */
      const c = consistencyScore(g.map((e) => e.pnl));
      return c.count > 0 ? c.score : null;
    },
  },
  {
    key: "avg_hold",
    label: "Avg hold",
    unit: "seconds",
    higherIsBetter: false,
    compute: (g, ctx) => computeHoldTime(realized(g), ctx.range).avgSeconds,
  },
  {
    key: "total_fees",
    label: "Commissions",
    unit: "money",
    higherIsBetter: false,
    compute: (g) => computeCostStats(realized(g)).totalFees,
  },
  {
    key: "total_swap",
    label: "Swap",
    unit: "money",
    higherIsBetter: false,
    compute: (g) => computeCostStats(realized(g)).totalSwap,
  },
  {
    key: "cost_pct_of_gross",
    label: "Cost % of gross",
    unit: "pct",
    hint: "The denominator is the winners' gross profit.",
    higherIsBetter: false,
    compute: (g) => computeCostStats(realized(g)).costPctOfGross,
  },
  {
    key: "avg_planned_r",
    label: "Avg planned R",
    unit: "r",
    higherIsBetter: true,
    compute: (g) => computePlannedRStats(realized(g)).avgPlannedR,
  },
  {
    key: "delta_r",
    label: "Planned vs realized R",
    unit: "r",
    hint: "How much of the planned reward was actually taken.",
    higherIsBetter: true,
    compute: (g) => computePlannedRStats(realized(g)).deltaR,
  },
  {
    key: "avg_mae_r",
    label: "Avg MAE u R",
    unit: "r",
    hint: "How deep trades went against the position.",
    higherIsBetter: false,
    compute: (g) => computeExcursionStats(g.map((e) => ({ row: e.trade.row }))).avgMaeR,
  },
  {
    key: "target_attainment",
    label: "Target attainment",
    unit: "pct",
    hint: "Realized R as a % of the planned reward.",
    higherIsBetter: true,
    compute: (g) => {
      const s = computeExitEfficiencyStats(realized(g));
      return s.count > 0 ? s.avgPct : null;
    },
  },
  {
    key: "winner_target_attainment",
    label: "Winner target attainment",
    unit: "pct",
    hint: "Winning trades only — how much of the plan was taken before exiting early.",
    higherIsBetter: true,
    compute: (g) => {
      const s = computeExitEfficiencyStats(realized(g));
      return s.winnerCount > 0 ? s.avgWinnerPct : null;
    },
  },
  {
    /*
     * SIGN IS FLIPPED ON PURPOSE, AND MATCHES THE TILE IT REPLACES.
     *
     * `computeSlippageStats` reports adverse slippage as a POSITIVE number —
     * bigger is worse. Every consumer so far has negated it before display
     * (`fmtR(-slippageStats.avgAdverseR)` on the dashboard), so a fill worse
     * than planned reads as `-0.05R`: money lost to slippage, in the same
     * direction as every other loss on the page. Publishing the raw sign here
     * would give the reports engine a metric where `higherIsBetter: false` and
     * make the same quantity point two ways in one app.
     */
    key: "avg_entry_slip",
    label: "Avg entry slip",
    unit: "r",
    hint: "Planned entry vs average fill, in R against the planned stop. Negative means the fill was worse than planned.",
    higherIsBetter: true,
    compute: (g) => {
      const s = computeSlippageStats(realized(g));
      // `count === 0` answers `avgAdverseR: 0`, which is "nothing measured"
      // wearing the face of "filled exactly at plan".
      return s.count > 0 ? negate(s.avgAdverseR) : null;
    },
  },
  {
    key: "total_slip_r",
    label: "Total slip R",
    unit: "r",
    hint: "Every R given up to entry slippage in the period, added together.",
    higherIsBetter: true,
    compute: (g) => {
      const s = computeSlippageStats(realized(g));
      return s.count > 0 ? negate(s.totalAdverseR) : null;
    },
  },
  {
    key: "breakeven_count",
    label: "Breakeven",
    unit: "count",
    higherIsBetter: false,
    compute: (g, ctx) => statsOf(g, ctx).breakeven,
  },
  {
    key: "setup_score",
    label: "Setup score",
    unit: "pct",
    hint:
      "Share of the playbook's SETUP CRITERIA that were met, averaged over the " +
      "trades that have a complete checklist. A trade with any criterion left " +
      "unanswered has no score and counts in neither half.",
    higherIsBetter: true,
    // Null rather than 0 when no playbook data is loaded, and null again when
    // no trade in the group carries a full checklist: a zero here would read as
    // "every setup failed every criterion", which is a finding, not a gap.
    compute: (group, ctx) => {
      if (!ctx.rules) return null;
      let sum = 0;
      let n = 0;
      for (const t of group) {
        const s = setupScoreFromTrade(scorable(t), ctx.rules);
        if (s == null) continue;
        sum += s.pct;
        n++;
      }
      return n === 0 ? null : sum / n;
    },
  },
  {
    key: "follow_rate",
    label: "Follow rate",
    unit: "pct",
    hint: "Share of answered rules that were followed. Unanswered counts in neither the numerator nor the denominator.",
    higherIsBetter: true,
    // Null rather than 0 when no playbook data is loaded: a zero here would read
    // as "no rule was ever followed", which is a finding, not a missing input.
    compute: (group, ctx, scope) =>
      ctx.rules ? computeFollowRate(group, ctx.rules, scope) : null,
  },
];

const metricByKey = new Map(METRICS.map((m) => [m.key, m]));

export function getMetric(key: string): ReportMetric | undefined {
  return metricByKey.get(key);
}

/** Columns every summary table shows by default. */
export const DEFAULT_METRIC_KEYS = [
  "net_pnl",
  "trade_count",
  "win_rate",
  "profit_factor",
  "expectancy",
  "avg_r",
] as const;
