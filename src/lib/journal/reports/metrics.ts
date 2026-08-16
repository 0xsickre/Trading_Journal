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
import { computeFollowRate, type RuleLookup } from "./playbook-dimensions";

export type MetricContext = {
  pnlBasis: PnlMode;
  range: BreakevenRange;
  /**
   * `currency` je STAJALA ovde i nijedno mesto je nije čitalo.
   *
   * Nalaz Koraka 9. Nijedna od trideset metrika je nije dodirivala, ni engine,
   * ni jedna komponenta — a bila je OBAVEZNA, pa je svaki pozivalac morao da
   * smisli vrednost. `breakdownByField` je smislio `"USD"`, što je čitaocu
   * govorilo da je razlaganje na dashboard-u dolarsko. Nije bilo: funkcija
   * vraća sirove brojeve koje pozivalac formatira u valuti svog naloga.
   *
   * Formatiranje ima svoj kontekst (`units.ts`, `FormatContext.currency`) i
   * njega valuta zaista zanima. Dva konteksta sa istim imenom polja, od kojih
   * jedno ne radi ništa, su tačno onaj oblik greške zbog kojeg Korak 5 postoji.
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
    hint: "Mean daily P&L / its standard deviation, annualized by the number of days actually traded. Needs at least 5 days.",
    higherIsBetter: true,
    compute: (g) => computeRiskRatios(dayPointsOf(g), maxDrawdownOf(g)).sharpe,
  },
  {
    key: "sortino",
    label: "Sortino",
    unit: "ratio",
    hint: "Like Sharpe, but the denominator counts losing days only — upside is not risk. Empty while no day has lost money.",
    higherIsBetter: true,
    compute: (g) => computeRiskRatios(dayPointsOf(g), maxDrawdownOf(g)).sortino,
  },
  {
    key: "calmar",
    label: "Calmar",
    unit: "ratio",
    hint: "Annualized return / max drawdown. The recovery factor divided by how long it took.",
    higherIsBetter: true,
    compute: (g) => computeRiskRatios(dayPointsOf(g), maxDrawdownOf(g)).calmar,
  },
  {
    key: "consistency",
    label: "Consistency",
    unit: "count",
    higherIsBetter: true,
    compute: (g) => consistencyScore(g.map((e) => e.pnl)).score,
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
    key: "breakeven_count",
    label: "Breakeven",
    unit: "count",
    higherIsBetter: false,
    compute: (g, ctx) => statsOf(g, ctx).breakeven,
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
