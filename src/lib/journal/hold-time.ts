/**
 * Hold time and duration buckets.
 *
 * `duration_seconds` has been computed by the `tj_position_stats` view since it
 * was created and never read by anything. Every number here comes from it.
 *
 * TradeZella's duration buckets are a day-trading artefact (minutes and hours).
 * These are scaled for swing: the question is whether a position that lived a
 * fortnight still earned its keep after swap.
 */

import type { RealizedTrade } from "./analytics";
import { classifyOutcome, EXACT_ZERO_RANGE, type BreakevenRange } from "./breakeven";

export type HoldTimeStats = {
  /** Trades that have both an open and a close timestamp. */
  count: number;
  avgSeconds: number | null;
  avgWinnerSeconds: number | null;
  avgLoserSeconds: number | null;
  /** "Scratch" in TradeZella's vocabulary. */
  avgBreakevenSeconds: number | null;
  longestSeconds: number | null;
  longestTradeId: string | null;
  avgDays: number | null;
  maxDays: number | null;
};

const EMPTY: HoldTimeStats = {
  count: 0,
  avgSeconds: null,
  avgWinnerSeconds: null,
  avgLoserSeconds: null,
  avgBreakevenSeconds: null,
  longestSeconds: null,
  longestTradeId: null,
  avgDays: null,
  maxDays: null,
};

const mean = (xs: number[]): number | null =>
  xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

export function computeHoldTime(
  trades: RealizedTrade[],
  range: BreakevenRange = EXACT_ZERO_RANGE,
  pnlOf: (t: RealizedTrade) => number = (t) => t.net,
): HoldTimeStats {
  const all: number[] = [];
  const winners: number[] = [];
  const losers: number[] = [];
  const breakeven: number[] = [];
  let longestSeconds: number | null = null;
  let longestTradeId: string | null = null;

  for (const t of trades) {
    const secs = t.row.stats?.duration_seconds;
    if (secs == null || Number.isNaN(secs) || secs < 0) continue;

    all.push(secs);
    if (longestSeconds == null || secs > longestSeconds) {
      longestSeconds = secs;
      longestTradeId = t.id;
    }

    const outcome = classifyOutcome(pnlOf(t), range);
    if (outcome === "win") winners.push(secs);
    else if (outcome === "loss") losers.push(secs);
    else breakeven.push(secs);
  }

  if (all.length === 0) return EMPTY;

  const avgSeconds = mean(all);
  return {
    count: all.length,
    avgSeconds,
    avgWinnerSeconds: mean(winners),
    avgLoserSeconds: mean(losers),
    avgBreakevenSeconds: mean(breakeven),
    longestSeconds,
    longestTradeId,
    avgDays: avgSeconds != null ? avgSeconds / 86_400 : null,
    maxDays: longestSeconds != null ? longestSeconds / 86_400 : null,
  };
}

export const DURATION_BUCKETS = [
  "<1d",
  "1–3d",
  "3–7d",
  "1–2w",
  ">2w",
] as const;

export type DurationBucket = (typeof DURATION_BUCKETS)[number];

/** Bucket a hold time. Boundaries are inclusive-low, exclusive-high. */
export function durationBucket(
  seconds: number | null | undefined,
): DurationBucket | null {
  if (seconds == null || Number.isNaN(seconds) || seconds < 0) return null;
  const days = seconds / 86_400;
  if (days < 1) return "<1d";
  if (days < 3) return "1–3d";
  if (days < 7) return "3–7d";
  if (days < 14) return "1–2w";
  return ">2w";
}

/** Bucket label for a trade, for use as a report dimension. */
export function durationBucketOfTrade(
  t: RealizedTrade,
): DurationBucket | null {
  return durationBucket(t.row.stats?.duration_seconds ?? null);
}
