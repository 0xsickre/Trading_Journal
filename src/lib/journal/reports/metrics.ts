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
  currency: string;
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
    label: "Trejdova",
    unit: "count",
    higherIsBetter: true,
    compute: (g) => g.length,
  },
  {
    key: "win_rate",
    label: "Win %",
    unit: "pct",
    hint: "Breakeven trejdovi su van imenioca.",
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
    hint: "Bruto profit / bruto gubitak. ∞ znači da u grupi nema nijednog gubitka; prazno samo kad grupa nema trejdova.",
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
    label: "Najbolji",
    unit: "money",
    higherIsBetter: true,
    compute: (g, ctx) => statsOf(g, ctx).best,
  },
  {
    key: "worst",
    label: "Najgori",
    unit: "money",
    higherIsBetter: true,
    compute: (g, ctx) => statsOf(g, ctx).worst,
  },
  {
    key: "max_drawdown",
    label: "Max drawdown",
    unit: "money",
    hint: "Pad kumulativnog P&L-a unutar grupe.",
    higherIsBetter: true,
    compute: (g) => maxDrawdownOf(g),
  },
  {
    key: "avg_daily_dd",
    label: "Avg daily DD",
    unit: "money",
    hint: "Prosečan pad unutar dana, mereno od dnevnog vrha. Dan bez pada ulazi kao 0.",
    higherIsBetter: true,
    compute: (g) => computeDailyDrawdown(dayPointsOf(g)).avgMoney,
  },
  {
    key: "recovery_factor",
    label: "Recovery factor",
    unit: "ratio",
    hint: "Neto profit / max drawdown. Prazno kad drawdown-a nema.",
    higherIsBetter: true,
    compute: (g, ctx) =>
      recoveryFactor(statsOf(g, ctx).netSum, maxDrawdownOf(g)),
  },
  {
    key: "sharpe",
    label: "Sharpe",
    unit: "ratio",
    hint: "Prosečan dnevni P&L / njegova standardna devijacija, godišnje skalirano brojem dana kojima si stvarno trgovao. Traži bar 5 dana.",
    higherIsBetter: true,
    compute: (g) => computeRiskRatios(dayPointsOf(g), maxDrawdownOf(g)).sharpe,
  },
  {
    key: "sortino",
    label: "Sortino",
    unit: "ratio",
    hint: "Kao Sharpe, ali imenilac broji samo gubitaške dane — rast nije rizik. Prazno kad nijedan dan nije bio u minusu.",
    higherIsBetter: true,
    compute: (g) => computeRiskRatios(dayPointsOf(g), maxDrawdownOf(g)).sortino,
  },
  {
    key: "calmar",
    label: "Calmar",
    unit: "ratio",
    hint: "Godišnji prinos / max drawdown. Recovery factor podeljen vremenom koje mu je trebalo.",
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
    label: "Komisije",
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
    label: "Trošak % bruto",
    unit: "pct",
    hint: "Imenilac je bruto profit dobitnika.",
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
    hint: "Koliko planiranog reward-a je stvarno uzeto.",
    higherIsBetter: true,
    compute: (g) => computePlannedRStats(realized(g)).deltaR,
  },
  {
    key: "avg_mae_r",
    label: "Avg MAE u R",
    unit: "r",
    hint: "Koliko duboko su trejdovi išli protiv pozicije.",
    higherIsBetter: false,
    compute: (g) => computeExcursionStats(g.map((e) => ({ row: e.trade.row }))).avgMaeR,
  },
  {
    key: "target_attainment",
    label: "Target attainment",
    unit: "pct",
    hint: "Realizovani R kao % planiranog reward-a.",
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
    hint: "Udeo odgovorenih pravila koja su ispoštovana. Neodgovoreno se ne broji ni u brojilac ni u imenilac.",
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
