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
  /**
   * `metric` or `metric:asc` / `metric:desc`. Without a direction the metric's
   * better end comes first. Without a sort at all, an ordered dimension keeps
   * its own order and the rest sort by the first metric.
   */
  sortBy?: string;
};

/** `net_pnl:asc` → `{ key, dir }`; a missing or unknown direction is null. */
export function parseSort(raw: string | undefined | null): { key: string; dir: "asc" | "desc" | null } | null {
  if (!raw) return null;
  const [key, dir] = raw.split(":");
  if (!key) return null;
  return { key, dir: dir === "asc" || dir === "desc" ? dir : null };
}

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
    // Once per bucket. A tag stored twice on one trade (`["FOMO", "FOMO"]`), or
    // two rules sharing their wording, put the same trade in the same row twice
    // and doubled its n and its money there.
    for (const b of new Set(buckets)) {
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
  const sort = parseSort(sortBy);
  // A sort on a metric this report does not compute is no sort at all — it
  // used to fall through to an alphabetical order nobody asked for.
  const requested = sort && metrics.some((m) => m.key === sort.key) ? sort : null;

  // A dimension with a declared order is ordinal — sorting it by a metric would
  // destroy the meaning of the sequence (a duration ladder, a grade scale).
  if (dimension.order && !requested) {
    const rank = new Map(dimension.order.map((k, i) => [k, i]));
    rows.sort((a, b) => {
      const ra = rank.get(a.bucket) ?? Number.MAX_SAFE_INTEGER;
      const rb = rank.get(b.bucket) ?? Number.MAX_SAFE_INTEGER;
      return ra !== rb ? ra - rb : a.bucket.localeCompare(b.bucket);
    });
    return;
  }
  // Months: their own order, oldest first.
  if (dimension.natural && !requested) {
    rows.sort((a, b) => a.bucket.localeCompare(b.bucket));
    return;
  }

  const key = requested?.key ?? metrics[0]?.key;
  if (!key) {
    rows.sort((a, b) => a.bucket.localeCompare(b.bucket));
    return;
  }
  const metric = metrics.find((m) => m.key === key);
  const betterFirst = metric?.higherIsBetter === false ? "asc" : "desc";
  const dir = (requested?.dir ?? betterFirst) === "asc" ? 1 : -1;
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
 *
 * "Best" follows the metric's OWN direction. Sorting descending unconditionally
 * made the summary name the highest-fee instrument as best on `total_fees`, and
 * the slowest book as best on `avg_hold` — six catalogue metrics declare
 * `higherIsBetter: false`, and the metric here is whichever one the user picked.
 * `sortRows` above already reads the flag; this now reads the same one.
 */
export function summarizeReport(
  result: ReportResult,
  metricKey = "net_pnl",
): PerformanceSummary {
  const eligible = result.rows.filter((r) => !r.belowSample);
  // The result's own metric list first — a pivot or a caller-built metric may
  // not be in the global catalogue — then the catalogue as a fallback.
  const metric =
    result.metrics.find((m) => m.key === metricKey) ?? getMetric(metricKey);
  const dir = metric?.higherIsBetter === false ? 1 : -1;
  const empty: PerformanceSummary = {
    best: null,
    worst: null,
    mostActive: null,
    highestWinRate: null,
    qualifying: eligible.length,
  };
  if (eligible.length === 0) return empty;

  const withValue = eligible.filter((r) => r.values[metricKey] != null);
  // Best first, worst last, whichever way "better" runs for this metric.
  //
  // The equality guard is not decoration. `profit_factor` answers Infinity for a
  // bucket with no losing trade — deliberately, see its entry in `metrics.ts` —
  // and `Infinity - Infinity` is `NaN`. A comparator that returns NaN leaves the
  // sort in an unspecified order, so with two flawless buckets `best` and
  // `worst` were both arbitrary. The row sort above has always had this guard;
  // this one did not, and the two used different orders for the same data.
  const byMetric = [...withValue].sort((a, b) => {
    const av = a.values[metricKey] as number;
    const bv = b.values[metricKey] as number;
    return av === bv ? a.bucket.localeCompare(b.bucket) : (av - bv) * dir;
  });
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
