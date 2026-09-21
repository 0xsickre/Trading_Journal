/**
 * Recovery factor, consistency, planned R — report metrics, and until Phase E
 * also components of the composite score that no longer exists
 * inputs, plus the planned-vs-realized comparison the spec calls for.
 */

import type { RealizedTrade } from "./analytics";
import { plannedRewardFromTrade } from "./exit-efficiency";

/** Net profit divided by the worst drawdown. Higher is better. */
export function recoveryFactor(
  netProfit: number,
  maxDrawdownMoney: number,
): number | null {
  const dd = Math.abs(maxDrawdownMoney);
  // No drawdown means the ratio is undefined, not infinite. A curve that never
  // fell has nothing to recover from and should not score as if it did.
  if (!(dd > 0)) return null;
  return netProfit / dd;
}

/**
 * Scaling applied to the coefficient of variation before subtracting it from
 * 100.
 *
 * The source spec's literal wording — stdev / TOTAL profit — was tried first
 * and dropped: total = mean × count, so that ratio shrinks as more periods
 * accumulate even when the underlying volatility is unchanged. A book that
 * trades the same pattern for a year would "become more consistent" purely by
 * outliving its own sample size. `cv` (stdev / |mean|) does not carry that
 * bias — it answers "how big is the spread relative to the typical trade",
 * independent of how many trades there have been. This constant is the single
 * place to recalibrate once there is enough live data to judge — the call
 * sites never need to change.
 */
export const CONSISTENCY_SCALE = 20;

export type ConsistencyResult = {
  count: number;
  mean: number | null;
  stdev: number | null;
  total: number;
  /** stdev / total profit, per the spec's literal wording. Not used by the
   * score (see `CONSISTENCY_SCALE`) — carried so the spec's original reading
   * can still be inspected without recomputing anything. */
  raw: number | null;
  /**
   * stdev / mean — the coefficient of variation. Drives `score`: unlike `raw`,
   * it does not shrink just because the sample got longer.
   */
  cv: number | null;
  /** 100 − cv × CONSISTENCY_SCALE, clamped to 0..100. */
  score: number;
};

/**
 * Consistency of per-trade profit.
 *
 * The spec defines this as "standard deviation of profit / total profit", then
 * flags in its own margin that the unit is unclear and reads like a coefficient
 * of variation. Both readings are computed; the score is built from `cv`, not
 * the spec's literal `raw`, because `raw` scales with sample size rather than
 * with actual consistency (see `CONSISTENCY_SCALE`).
 */
export function consistencyScore(profits: number[]): ConsistencyResult {
  const count = profits.length;
  if (count === 0) {
    return {
      count: 0,
      mean: null,
      stdev: null,
      total: 0,
      raw: null,
      cv: null,
      score: 0,
    };
  }

  const total = profits.reduce((a, b) => a + b, 0);
  const mean = total / count;

  // Population standard deviation: this is the whole set of trades in scope,
  // not a sample drawn from a larger population.
  const variance =
    profits.reduce((acc, p) => acc + (p - mean) ** 2, 0) / count;
  const stdev = Math.sqrt(variance);
  const cv = mean !== 0 ? stdev / Math.abs(mean) : null;

  // A losing book has no consistency to speak of.
  if (mean < 0 || total <= 0) {
    return { count, mean, stdev, total, raw: null, cv, score: 0 };
  }

  const raw = stdev / total;
  const score = Math.max(
    0,
    Math.min(100, 100 - (cv ?? 0) * CONSISTENCY_SCALE),
  );
  return { count, mean, stdev, total, raw, cv, score };
}

export type PlannedRStats = {
  /** Trades carrying a usable planned reward. */
  count: number;
  avgPlannedR: number | null;
  /** Realized R averaged over the SAME trades, so the two are comparable. */
  avgRealizedR: number | null;
  /** avgRealizedR − avgPlannedR: how much of the plan is actually collected. */
  deltaR: number | null;
};

/**
 * Average planned vs realized R.
 *
 * Both averages are taken over the same subset — trades that have a planned
 * reward AND a realized R. Averaging planned R over one set and realized R over
 * a larger one would produce a difference that means nothing.
 */
export function computePlannedRStats(
  trades: RealizedTrade[],
): PlannedRStats {
  let count = 0;
  let plannedSum = 0;
  let realizedSum = 0;

  for (const t of trades) {
    const planned = plannedRewardFromTrade(t.row);
    const realized = t.r;
    if (planned == null || !(planned > 0) || realized == null) continue;
    count++;
    plannedSum += planned;
    realizedSum += realized;
  }

  if (count === 0) {
    return { count: 0, avgPlannedR: null, avgRealizedR: null, deltaR: null };
  }
  const avgPlannedR = plannedSum / count;
  const avgRealizedR = realizedSum / count;
  return {
    count,
    avgPlannedR,
    avgRealizedR,
    deltaR: avgRealizedR - avgPlannedR,
  };
}

/** Average win divided by average loss, both as positive magnitudes. */
export function avgWinLossRatio(
  avgWin: number,
  avgLoss: number,
): number | null {
  const loss = Math.abs(avgLoss);
  if (!(loss > 0) || !(avgWin > 0)) return null;
  return avgWin / loss;
}
