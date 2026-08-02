/**
 * MAE / MFE expressed in R.
 *
 * This math previously existed only inside the trade form, which meant no
 * aggregate could use it. It lives here so per-trade display and portfolio
 * statistics read from one implementation.
 *
 * MAE and MFE are entered by hand from the chart, so both are optional on any
 * given trade. Aggregates must report their sample size rather than treating a
 * missing excursion as zero.
 */

import type { TradeRow } from "./types";
import { numberFieldValue as num } from "./field-values";
import { plannedRiskPts, tradeDirectionMultiplier } from "./position-stats";

export type Excursion = {
  /** Adverse excursion in R, positive = how far offside it went. */
  maeR: number | null;
  /** Favourable excursion in R, positive = how far onside it went. */
  mfeR: number | null;
  /** realized R / MFE R — how much of the best available move was kept. */
  capturePct: number | null;
};

/**
 * Excursion in R, on the journal's R convention.
 *
 * That convention deliberately pairs two different price references, and this
 * is the place it most looks like a mistake, so: **price movement is measured
 * from the ACTUAL average fill, while one R is the PLANNED risk distance**
 * (plan entry to stop, falling back to the fill when no plan entry was
 * recorded). R therefore reads as "multiples of the risk I set out to take",
 * measured over the move I actually got.
 *
 * `realized_r` in `tj_position_stats` is built the same way — its numerator
 * `gross_points` comes off `avg_entry`, its denominator off
 * `COALESCE(entry_price, avg_entry)`. Aligning MAE/MFE to a single reference
 * would therefore NOT make this more consistent; it would put `mfeR` on a
 * different basis from `realizedR` and quietly corrupt `capturePct`, which
 * divides one by the other. Change both or neither.
 */
export function excursionFromTrade(row: TradeRow): Excursion {
  const empty: Excursion = { maeR: null, mfeR: null, capturePct: null };

  const avgEntry = row.stats?.avg_entry ?? null;
  const riskPts = plannedRiskPts(
    num(row, "entry_price"),
    num(row, "stop_price"),
    avgEntry,
  );
  if (avgEntry == null || riskPts == null || !(riskPts > 0)) return empty;

  const dir = tradeDirectionMultiplier((row.direction as string) ?? null);
  const maePrice = num(row, "max_drawdown_price");
  const mfePrice = num(row, "max_profit_price");

  let maeR: number | null = null;
  let mfeR: number | null = null;

  if (maePrice != null) {
    const pts = dir === 1 ? avgEntry - maePrice : maePrice - avgEntry;
    // A non-adverse "adverse" excursion means the trade never went offside.
    if (pts > 0) maeR = pts / riskPts;
    else maeR = 0;
  }
  if (mfePrice != null) {
    const pts = dir === 1 ? mfePrice - avgEntry : avgEntry - mfePrice;
    if (pts > 0) mfeR = pts / riskPts;
    else mfeR = 0;
  }

  const realizedR = row.stats?.realized_r ?? null;
  const capturePct =
    realizedR != null && mfeR != null && mfeR > 0
      ? (realizedR / mfeR) * 100
      : null;

  return { maeR, mfeR, capturePct };
}

export type ExcursionStats = {
  /** Trades carrying an MAE price. */
  maeCount: number;
  avgMaeR: number | null;
  worstMaeR: number | null;
  /** Trades that never went offside at all. */
  noDrawdownCount: number;
  mfeCount: number;
  avgMfeR: number | null;
};

export function computeExcursionStats(
  rows: { row: TradeRow }[],
): ExcursionStats {
  let maeCount = 0;
  let maeSum = 0;
  let worstMaeR: number | null = null;
  let noDrawdownCount = 0;
  let mfeCount = 0;
  let mfeSum = 0;

  for (const t of rows) {
    const e = excursionFromTrade(t.row);
    if (e.maeR != null) {
      maeCount++;
      maeSum += e.maeR;
      if (worstMaeR == null || e.maeR > worstMaeR) worstMaeR = e.maeR;
      if (e.maeR === 0) noDrawdownCount++;
    }
    if (e.mfeR != null) {
      mfeCount++;
      mfeSum += e.mfeR;
    }
  }

  return {
    maeCount,
    avgMaeR: maeCount > 0 ? maeSum / maeCount : null,
    worstMaeR,
    noDrawdownCount,
    mfeCount,
    avgMfeR: mfeCount > 0 ? mfeSum / mfeCount : null,
  };
}
