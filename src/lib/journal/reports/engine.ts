/**
 * The report engine.
 *
 * One function behind every report. Ten "reports" differ only in which
 * dimension they group by, so writing ten of them would be writing the same
 * code ten times — the spec verified this across four of TradeZella's own
 * report pages.
 *
 * Sample size is carried on every row and never hidden. A category with three
 * trades and a 100 % win rate is not a finding, and the only way a reader can
 * know that is if `n` sits next to the number.
 */

import {
  bucketsOf,
  resolveDimension,
  type Dimension,
  type DimensionContext,
} from "./dimensions";
import { applyFilters, EMPTY_FILTER_SET, type FilterSet } from "./filters";
import { getMetric, type MetricContext, type ReportMetric } from "./metrics";
import type { EnrichedTrade } from "../enriched-trade";

/** Below this many trades a group is flagged as statistically thin. */
export const DEFAULT_MIN_SAMPLE = 5;

export type ReportRow = {
  bucket: string;
  /** Trades in this bucket. */
  n: number;
  /** True when `n` is under the threshold — display must show it, not hide it. */
  belowSample: boolean;
  values: Record<string, number | null>;
  trades: EnrichedTrade[];
};

export type ReportResult = {
  dimension: Dimension;
  metrics: ReportMetric[];
  rows: ReportRow[];
  /** Trades left after filtering, before grouping. */
  totalTrades: number;
  /** Trades the dimension had no value for, and therefore excluded. */
  excluded: number;
  /**
   * True when one trade can appear in several rows. Callers MUST surface this:
   * with a tag dimension the rows do not sum to the portfolio total.
   */
  multiValue: boolean;
  minSample: number;
};

export type RunReportInput = {
  trades: EnrichedTrade[];
  dimension: string | Dimension;
  metricKeys?: readonly string[];
  filters?: FilterSet;
  dimensionContext: DimensionContext;
  metricContext: MetricContext;
  minSample?: number;
  /** Metric key to sort rows by, descending. Falls back to the dimension order. */
  sortBy?: string;
};

function toDimension(
  d: string | Dimension,
  ctx: DimensionContext,
): Dimension | undefined {
  return typeof d === "string" ? resolveDimension(d, ctx) : d;
}

export function runReport(input: RunReportInput): ReportResult | null {
  const dimension = toDimension(input.dimension, input.dimensionContext);
  if (!dimension) return null;

  const metrics = (input.metricKeys ?? [])
    .map((k) => getMetric(k))
    .filter((m): m is ReportMetric => m != null);

  const filtered = applyFilters(
    input.trades,
    input.filters ?? EMPTY_FILTER_SET,
    input.dimensionContext,
  );

  const groups = new Map<string, EnrichedTrade[]>();
  let excluded = 0;

  for (const t of filtered) {
    const buckets = bucketsOf(dimension, t, input.dimensionContext);
    if (buckets.length === 0) {
      excluded++;
      continue;
    }
    for (const b of buckets) {
      const arr = groups.get(b) ?? [];
      arr.push(t);
      groups.set(b, arr);
    }
  }

  const minSample = input.minSample ?? DEFAULT_MIN_SAMPLE;

  const rows: ReportRow[] = [...groups.entries()].map(([bucket, trades]) => {
    const values: Record<string, number | null> = {};
    for (const m of metrics)
      values[m.key] = m.compute(trades, input.metricContext, [bucket]);
    return {
      bucket,
      n: trades.length,
      belowSample: trades.length < minSample,
      values,
      trades,
    };
  });

  sortRows(rows, dimension, input.sortBy, metrics);

  return {
    dimension,
    metrics,
    rows,
    totalTrades: filtered.length,
    excluded,
    multiValue: dimension.multiValue === true,
    minSample,
  };
}

function sortRows(
  rows: ReportRow[],
  dimension: Dimension,
  sortBy: string | undefined,
  metrics: ReportMetric[],
): void {
  // A dimension with a declared order is ordinal — sorting it by a metric would
  // destroy the meaning of the sequence (a duration ladder, a grade scale).
  if (dimension.order && !sortBy) {
    const rank = new Map(dimension.order.map((k, i) => [k, i]));
    rows.sort((a, b) => {
      const ra = rank.get(a.bucket) ?? Number.MAX_SAFE_INTEGER;
      const rb = rank.get(b.bucket) ?? Number.MAX_SAFE_INTEGER;
      return ra !== rb ? ra - rb : a.bucket.localeCompare(b.bucket);
    });
    return;
  }

  const key = sortBy ?? metrics[0]?.key;
  if (!key) {
    rows.sort((a, b) => a.bucket.localeCompare(b.bucket));
    return;
  }
  const metric = metrics.find((m) => m.key === key);
  const dir = metric?.higherIsBetter === false ? 1 : -1;
  rows.sort((a, b) => {
    const av = a.values[key];
    const bv = b.values[key];
    // Groups with no computable value sink to the bottom either way.
    if (av == null && bv == null) return a.bucket.localeCompare(b.bucket);
    if (av == null) return 1;
    if (bv == null) return -1;
    return av === bv ? a.bucket.localeCompare(b.bucket) : (av - bv) * dir;
  });
}

export type PerformanceSummary = {
  best: ReportRow | null;
  worst: ReportRow | null;
  mostActive: ReportRow | null;
  highestWinRate: ReportRow | null;
  /** Rows that met the sample threshold — the summary only considers these. */
  qualifying: number;
};

/**
 * Best / worst / most active / highest win rate.
 *
 * Only rows at or above the sample threshold are eligible: naming a
 * three-trade category "best" is exactly the mistake this whole engine is
 * built to avoid.
 */
export function summarizeReport(
  result: ReportResult,
  metricKey = "net_pnl",
): PerformanceSummary {
  const eligible = result.rows.filter((r) => !r.belowSample);
  const empty: PerformanceSummary = {
    best: null,
    worst: null,
    mostActive: null,
    highestWinRate: null,
    qualifying: eligible.length,
  };
  if (eligible.length === 0) return empty;

  const withValue = eligible.filter((r) => r.values[metricKey] != null);
  const byMetric = [...withValue].sort(
    (a, b) => (b.values[metricKey] as number) - (a.values[metricKey] as number),
  );
  const byWinRate = eligible
    .filter((r) => r.values.win_rate != null)
    .sort((a, b) => (b.values.win_rate as number) - (a.values.win_rate as number));

  return {
    best: byMetric[0] ?? null,
    worst: byMetric[byMetric.length - 1] ?? null,
    mostActive: [...eligible].sort((a, b) => b.n - a.n)[0] ?? null,
    highestWinRate: byWinRate[0] ?? null,
    qualifying: eligible.length,
  };
}
