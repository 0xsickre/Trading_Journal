/**
 * Cell background color for the cross-analysis pivot — metric-agnostic.
 *
 * The pivot's cell metric is user-chosen (`METRICS` in `reports-workbench.tsx`)
 * and spans every `MetricUnit`: money/r/pct/points are sign-centered around 0
 * like P&L, ratio (profit factor, Sharpe…) is centered around 1, and count/
 * seconds are pure magnitude with no "bad direction" at all. One color scale
 * cannot assume a single anchor, so the anchor is derived from the unit first.
 */

import type { MetricUnit } from "../units";
import type { PivotResult } from "./pivot";

export type PivotColorMode = "diverging0" | "diverging1" | "sequential";

/** Same split `pnlClass` makes for text, extended with the two units that
 *  don't fit a profit/loss story at all. */
export function pivotColorMode(unit: MetricUnit): PivotColorMode {
  if (unit === "count" || unit === "seconds") return "sequential";
  if (unit === "ratio") return "diverging1";
  return "diverging0";
}

/**
 * Largest deviation from the mode's anchor across the pivot's body cells
 * (`result.cells` — not the row/col/grand totals). Never 0, so a degenerate
 * pivot (every cell equal to its anchor) does not divide by zero.
 */
export function pivotExtent(result: PivotResult): number {
  const mode = pivotColorMode(result.metric.unit);
  const anchor = mode === "diverging1" ? 1 : 0;
  let max = 0;
  for (const cell of result.cells.values()) {
    if (cell.value == null) continue;
    max = Math.max(max, Math.abs(cell.value - anchor));
  }
  return max || 1;
}

/**
 * Background color for one cell, relative to the pivot's own extent.
 *
 * `color-mix(in oklch, ... transparent)` rather than a Tailwind opacity class
 * — the intensity is a runtime float, and Tailwind's JIT only knows classes it
 * can see in source, not ones built from a computed percentage. Same pattern
 * `calendar-heatmap.tsx` already uses for the day-cell heatmap.
 */
export function pivotCellColor(
  value: number | null,
  unit: MetricUnit,
  extent: number,
): string {
  if (value == null) return "transparent";
  const mode = pivotColorMode(unit);
  const anchor = mode === "diverging1" ? 1 : 0;
  const delta = value - anchor;
  if (delta === 0) return "var(--muted)";
  const intensity = Math.min(1, Math.abs(delta) / extent) * 0.75 + 0.25;
  if (mode === "sequential") {
    return `color-mix(in oklch, var(--chart-3) ${intensity * 100}%, transparent)`;
  }
  return delta > 0
    ? `color-mix(in oklch, var(--profit) ${intensity * 100}%, transparent)`
    : `color-mix(in oklch, var(--loss) ${intensity * 100}%, transparent)`;
}
