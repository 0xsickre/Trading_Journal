/**
 * Hold time and duration buckets.
 *
 * `duration_seconds` has been computed by the `tj_position_stats` view since it
 * was created and never read by anything. Every number here comes from it.
 *
 * The buckets are minutes (F5.1, decision L2, 29.09.2026): a Topstep position is
 * flat by 15:10 CT, so every trade lives well under a day, and the question is
 * whether a scalp of a minute and a position held an hour behave differently.
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
  avgMinutes: number | null;
  maxMinutes: number | null;
};

const EMPTY: HoldTimeStats = {
  count: 0,
  avgSeconds: null,
  avgWinnerSeconds: null,
  avgLoserSeconds: null,
  avgBreakevenSeconds: null,
  longestSeconds: null,
  longestTradeId: null,
  avgMinutes: null,
  maxMinutes: null,
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
    avgMinutes: avgSeconds != null ? avgSeconds / 60 : null,
    maxMinutes: longestSeconds != null ? longestSeconds / 60 : null,
  };
}

export const DURATION_BUCKETS = ["<1m", "1–5m", "5–15m", "15–60m", ">60m"] as const;

export type DurationBucket = (typeof DURATION_BUCKETS)[number];

/** Bucket a hold time. Boundaries are inclusive-low, exclusive-high. */
export function durationBucket(
  seconds: number | null | undefined,
): DurationBucket | null {
  if (seconds == null || Number.isNaN(seconds) || seconds < 0) return null;
  const minutes = seconds / 60;
  if (minutes < 1) return "<1m";
  if (minutes < 5) return "1–5m";
  if (minutes < 15) return "5–15m";
  if (minutes < 60) return "15–60m";
  return ">60m";
}
