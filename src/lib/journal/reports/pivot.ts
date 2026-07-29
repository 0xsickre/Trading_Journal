/**
 * Cross-analysis: one dimension down, another across.
 *
 * This is the component that answers the question the whole journal exists for
 * — "does an A-setup with the macro bias beat one against it, and on what
 * sample" — because a single-dimension table can never separate the two.
 *
 * Every cell carries its own `n`. A pivot splits an already-small book into a
 * grid, so most cells are thin by construction; the rule is that a thin cell is
 * **marked, not hidden**. Hiding it invites the reader to assume the blank was
 * zero, and showing it unmarked invites them to trust a 100 % win rate drawn
 * from two trades.
 */

import {
  bucketsOf,
  resolveDimension,
  type Dimension,
  type DimensionContext,
} from "./dimensions";
import { applyFilters, EMPTY_FILTER_SET, type FilterSet } from "./filters";
import { getMetric, type MetricContext, type ReportMetric } from "./metrics";
import { DEFAULT_MIN_SAMPLE } from "./engine";
import type { EnrichedTrade } from "../enriched-trade";

export type PivotCell = {
  row: string;
  col: string;
  n: number;
  belowSample: boolean;
  value: number | null;
};

export type PivotResult = {
  rowDimension: Dimension;
  colDimension: Dimension;
  metric: ReportMetric;
  rowKeys: string[];
  colKeys: string[];
  /** Absent entry means no trades fell in that intersection. */
  cells: Map<string, PivotCell>;
  rowTotals: Map<string, PivotCell>;
  colTotals: Map<string, PivotCell>;
  grandTotal: PivotCell;
  minSample: number;
  /** True when either dimension can place one trade in several buckets. */
  multiValue: boolean;
};

/**
 * Cell key.
 *
 * JSON encoding rather than a delimiter, because bucket labels legitimately
 * contain spaces, dashes and ellipses — "2R … 3R" and "4–5 (ispod proseka)"
 * are real labels, and any printable delimiter would eventually split one in
 * the wrong place. Nothing ever parses this back: row and col are carried on
 * the cell itself.
 */
export const cellKey = (row: string, col: string) => JSON.stringify([row, col]);

export type RunPivotInput = {
  trades: EnrichedTrade[];
  rowDimension: string | Dimension;
  colDimension: string | Dimension;
  metricKey: string;
  filters?: FilterSet;
  dimensionContext: DimensionContext;
  metricContext: MetricContext;
  minSample?: number;
};

const resolve = (d: string | Dimension, ctx: DimensionContext) =>
  typeof d === "string" ? resolveDimension(d, ctx) : d;

export function runPivot(input: RunPivotInput): PivotResult | null {
  const rowDimension = resolve(input.rowDimension, input.dimensionContext);
  const colDimension = resolve(input.colDimension, input.dimensionContext);
  const metric = getMetric(input.metricKey);
  if (!rowDimension || !colDimension || !metric) return null;

  const filtered = applyFilters(
    input.trades,
    input.filters ?? EMPTY_FILTER_SET,
    input.dimensionContext,
  );

  const cellGroups = new Map<
    string,
    { row: string; col: string; trades: EnrichedTrade[] }
  >();
  const rowGroups = new Map<string, EnrichedTrade[]>();
  const colGroups = new Map<string, EnrichedTrade[]>();
  const all: EnrichedTrade[] = [];

  for (const t of filtered) {
    const rowBuckets = bucketsOf(rowDimension, t, input.dimensionContext);
    const colBuckets = bucketsOf(colDimension, t, input.dimensionContext);
    // A trade missing EITHER dimension cannot be placed in the grid at all.
    if (rowBuckets.length === 0 || colBuckets.length === 0) continue;

    all.push(t);

    for (const r of rowBuckets) {
      const rg = rowGroups.get(r) ?? [];
      rg.push(t);
      rowGroups.set(r, rg);

      for (const c of colBuckets) {
        const k = cellKey(r, c);
        const entry = cellGroups.get(k) ?? { row: r, col: c, trades: [] };
        entry.trades.push(t);
        cellGroups.set(k, entry);
      }
    }

    for (const c of colBuckets) {
      const cg = colGroups.get(c) ?? [];
      cg.push(t);
      colGroups.set(c, cg);
    }
  }

  const minSample = input.minSample ?? DEFAULT_MIN_SAMPLE;
  const mk = (row: string, col: string, group: EnrichedTrade[]): PivotCell => ({
    row,
    col,
    n: group.length,
    belowSample: group.length < minSample,
    value: metric.compute(group, input.metricContext),
  });

  const cells = new Map<string, PivotCell>();
  for (const [k, entry] of cellGroups) {
    cells.set(k, mk(entry.row, entry.col, entry.trades));
  }

  const rowTotals = new Map<string, PivotCell>();
  for (const [row, group] of rowGroups) rowTotals.set(row, mk(row, "", group));

  const colTotals = new Map<string, PivotCell>();
  for (const [col, group] of colGroups) colTotals.set(col, mk("", col, group));

  return {
    rowDimension,
    colDimension,
    metric,
    rowKeys: orderKeys([...rowGroups.keys()], rowDimension, rowTotals),
    colKeys: orderKeys([...colGroups.keys()], colDimension, colTotals),
    cells,
    rowTotals,
    colTotals,
    grandTotal: mk("", "", all),
    minSample,
    multiValue:
      rowDimension.multiValue === true || colDimension.multiValue === true,
  };
}

/** Declared order wins; otherwise busiest first, so the grid reads top-left. */
function orderKeys(
  keys: string[],
  dimension: Dimension,
  totals: Map<string, PivotCell>,
): string[] {
  if (dimension.order) {
    const rank = new Map(dimension.order.map((k, i) => [k, i]));
    return [...keys].sort((a, b) => {
      const ra = rank.get(a) ?? Number.MAX_SAFE_INTEGER;
      const rb = rank.get(b) ?? Number.MAX_SAFE_INTEGER;
      return ra !== rb ? ra - rb : a.localeCompare(b);
    });
  }
  return [...keys].sort((a, b) => {
    const na = totals.get(a)?.n ?? 0;
    const nb = totals.get(b)?.n ?? 0;
    return na !== nb ? nb - na : a.localeCompare(b);
  });
}

export function getCell(
  result: PivotResult,
  row: string,
  col: string,
): PivotCell | undefined {
  return result.cells.get(cellKey(row, col));
}
