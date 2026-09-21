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
import { containsNeutral, type Interval } from "../uncertainty";

/**
 * Below this many trades a group cannot be RANKED.
 *
 * It used to dim the row as well, and that was the whole defence: a filter
 * hides, it does not explain. The table now carries an interval per figure,
 * which says how unsure the number is instead of how few trades made it — and
 * this constant is left holding the one job an interval cannot do, which is to
 * keep a three-trade bucket off the "best category" card.
 */
export const DEFAULT_MIN_SAMPLE = 5;

export type ReportRow = {
  bucket: string;
  /** Trades in this bucket. */
  n: number;
  /** True when `n` is under the ranking threshold — display must show it, not hide it. */
  belowSample: boolean;
  values: Record<string, number | null>;
  /**
   * How sure each value is, for the metrics that carry an interval.
   *
   * Keyed like `values`, and missing (not null) for a metric with no interval
   * at all — the difference between "this figure has no uncertainty to state"
   * and "it has one and there was not enough data to state it".
   */
  intervals: Record<string, Interval | null>;
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
    const intervals: Record<string, Interval | null> = {};
    for (const m of metrics) {
      values[m.key] = m.compute(trades, input.metricContext, [bucket]);
      // Resampling is the expensive half of this loop, so it runs only for the
      // metrics that declare it — three of thirty-eight.
      if (m.interval) intervals[m.key] = m.interval(trades, input.metricContext);
    }
    return {
      bucket,
      n: trades.length,
      belowSample: trades.length < minSample,
      values,
      intervals,
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

/**
 * Order the rows in place.
 *
 * Exported so a caller can re-sort a report it already has instead of running
 * the engine again. `/reports` re-ran everything — every metric, every row,
 * every bootstrap — on a click of a column header, because the sort lived
 * inside the same memo as the computation.
 */
export function sortRows(
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
  /**
   * Ranked by the CONSERVATIVE end of the interval when there is one.
   *
   * A bucket of three trades that all won has a 100 % win rate and an
   * expectancy no honest reader would bet on; ranked on the point estimate it
   * is crowned "best" over a bucket of eighty at 60 %. Its lower bound is
   * terrible, and that is the number that answers "which of these do I
   * actually know is good". The cell still shows the point estimate; only the
   * ranking is sceptical.
   *
   * For a metric where lower is better the same logic runs off the upper
   * bound — the worst the figure might really be.
   */
  const rankValue = (r: ReportRow): number => {
    const point = r.values[metricKey] as number;
    const i = r.intervals?.[metricKey];
    if (!i) return point;
    const bound = dir === -1 ? i.lo : i.hi;
    return Number.isFinite(bound) ? bound : point;
  };
  const byMetric = [...withValue].sort((a, b) => {
    const av = rankValue(a);
    const bv = rankValue(b);
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

// --- Compare mode: two books, side by side ---------------------------------

/** One bucket as both books saw it. */
export type CompareRow = {
  bucket: string;
  /** Null when this bucket exists only in the other set — never a zero row. */
  a: ReportRow | null;
  b: ReportRow | null;
  /** B − A per metric. Null when either side has no value to subtract. */
  deltas: Record<string, number | null>;
  /** How sure each gap is, for the metrics that can say. */
  deltaIntervals: Record<string, Interval | null>;
  /** Trades this bucket holds in BOTH sets — see `sharedTrades`. */
  shared: number;
};

export type CompareResult = {
  dimension: Dimension;
  metrics: ReportMetric[];
  rows: CompareRow[];
  a: ReportResult;
  b: ReportResult;
  /**
   * Trades the two filter sets have in common, over the whole report.
   *
   * The warning that cannot be left off: "Grade A" against "all trades" is not
   * two independent samples, and every interval below assumes it is. A reader
   * comparing a subset with its own superset is reading a difference between a
   * thing and itself.
   */
  sharedTrades: number;
  minSample: number;
};

/**
 * Join two reports on the bucket, keeping every bucket either one has.
 *
 * A full outer join, and the missing side is NULL rather than an empty row: a
 * category that only one book traded has no figure of zero, it has no figure.
 *
 * Both reports must have been run with the same dimension, the same metrics
 * and the same basis — the workbench shares those controls between the two
 * filter sets precisely so this holds. The difference of two numbers computed
 * on different bases is not a difference of anything.
 */
export function compareReports(
  a: ReportResult,
  b: ReportResult,
  metricContext: MetricContext,
): CompareResult {
  const byBucketB = new Map(b.rows.map((r) => [r.bucket, r]));
  const buckets = [...a.rows.map((r) => r.bucket)];
  for (const r of b.rows) if (!buckets.includes(r.bucket)) buckets.push(r.bucket);

  const idsOf = (rows: readonly ReportRow[]): Set<string> =>
    new Set(rows.flatMap((r) => r.trades.map((t) => t.trade.id)));
  const sharedIds = idsOf(a.rows);
  let sharedTrades = 0;
  for (const id of idsOf(b.rows)) if (sharedIds.has(id)) sharedTrades++;

  const rows: CompareRow[] = buckets.map((bucket) => {
    const ra = a.rows.find((r) => r.bucket === bucket) ?? null;
    const rb = byBucketB.get(bucket) ?? null;

    const deltas: Record<string, number | null> = {};
    const deltaIntervals: Record<string, Interval | null> = {};
    for (const m of a.metrics) {
      const va = ra?.values[m.key] ?? null;
      const vb = rb?.values[m.key] ?? null;
      // `Infinity − Infinity` is NaN, and a NaN rendered as a number is a lie
      // with a minus sign in front of it. Two flawless buckets have no gap
      // anyone can state.
      const d = va == null || vb == null ? null : vb - va;
      deltas[m.key] = d == null || Number.isNaN(d) ? null : d;
      deltaIntervals[m.key] =
        m.difference && ra && rb ? m.difference(ra.trades, rb.trades, metricContext) : null;
    }

    const inA = ra ? new Set(ra.trades.map((t) => t.trade.id)) : new Set<string>();
    const shared = rb ? rb.trades.filter((t) => inA.has(t.trade.id)).length : 0;

    return { bucket, a: ra, b: rb, deltas, deltaIntervals, shared };
  });

  return {
    dimension: a.dimension,
    metrics: a.metrics,
    rows,
    a,
    b,
    sharedTrades,
    minSample: a.minSample,
  };
}

/**
 * Order compare rows, by the same rules a single report uses.
 *
 * Sorted ONCE over the joined rows rather than twice before the join: two
 * independently sorted lists zipped together would put a bucket's A row beside
 * another bucket's B row for every bucket the two sets do not share.
 *
 * The sort reads set A, because A is the book the reader started from. A bucket
 * A never traded sinks, the same way a row with no value does.
 */
export function sortCompareRows(
  rows: CompareRow[],
  dimension: Dimension,
  sortBy: string | undefined,
  metrics: ReportMetric[],
): void {
  const placeholder = (bucket: string): ReportRow => ({
    bucket,
    n: 0,
    belowSample: true,
    values: {},
    intervals: {},
    trades: [],
  });
  const proxies = rows.map((r) => r.a ?? placeholder(r.bucket));
  sortRows(proxies, dimension, sortBy, metrics);
  const order = new Map(proxies.map((r, i) => [r.bucket, i]));
  rows.sort((x, y) => (order.get(x.bucket) ?? 0) - (order.get(y.bucket) ?? 0));
}

/**
 * Whether a figure is still indistinguishable from no effect.
 *
 * The display rule for a cell: an expectancy whose interval spans zero, a win
 * rate whose interval spans 50, a profit factor whose interval spans 1. Not a
 * judgement about the trade — a statement that this sample cannot tell the
 * reader which side of neutral the truth is on.
 */
export function isInconclusive(row: ReportRow, metric: ReportMetric): boolean {
  if (metric.neutral == null) return false;
  return containsNeutral(row.intervals?.[metric.key] ?? null, metric.neutral);
}

/**
 * The same question for a GAP, where neutral is always zero.
 *
 * Not the metric's own neutral: a win rate is neutral at 50 and a profit factor
 * at 1, but a DIFFERENCE of either is neutral at no difference. Reading
 * `metric.neutral` here would have marked every win-rate gap under 50 points
 * as conclusive.
 */
export function isDeltaInconclusive(row: CompareRow, metric: ReportMetric): boolean {
  return containsNeutral(row.deltaIntervals[metric.key] ?? null, 0);
}
