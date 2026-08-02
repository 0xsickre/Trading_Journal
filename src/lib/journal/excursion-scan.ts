/**
 * MAE / MFE derived from candles instead of typed in by hand.
 *
 * `excursion.ts` turns two PRICES into R and into capture %. This module is the
 * step before it: given the bars a trade lived through, which two prices were
 * they. Deliberately split, and deliberately provider-agnostic — a `Candle`
 * here is four numbers and a timestamp, so OANDA, Dukascopy or a CSV all reduce
 * to the same input and none of them can leak into the arithmetic.
 *
 * Nothing in this file touches the network. That is the point: the part that
 * can be wrong in a subtle, silent way is the part that is pure and tested.
 *
 * ---
 *
 * Two rules decide every number here.
 *
 * **1. A bar counts only if it fits ENTIRELY inside the holding window.**
 *
 * A bar stamped 14:00 on a 1-hour feed covers 14:00–15:00. Enter at 14:30 and
 * that bar's low may be from 14:05 — a price the trade was never exposed to.
 * Counting it would report an adverse excursion that never happened to you,
 * and MAE is the one number a trader reads as "how close was I to being
 * stopped". Overstating it is not a rounding error, it is a false memory.
 *
 * The cost is real and worth stating: a trade shorter than one bar sees no
 * bars at all. The finer the interval, the smaller both the error and the cost
 * — which is why the interval is the caller's decision and is passed in.
 *
 * **2. The fills themselves are observed prices.**
 *
 * The average entry and the average exit provably occurred during the hold, so
 * they join the bar extremes as candidates. This is not a nicety — it is what
 * keeps `capturePct` honest. That figure is `realizedR / mfeR`, and realized R
 * is built off the average exit; if the exit bar were excluded by rule 1 and
 * the exit were the best price of the trade, MFE would land BELOW the realized
 * result and capture would exceed 100% — "I kept more than was available",
 * which is not a thing. Feeding the same average exit into both sides makes the
 * ratio provably ≤ 100%. There is a test pinning exactly that.
 *
 * ---
 *
 * The raw extreme is returned, never clamped to the entry. `excursionFromTrade`
 * already collapses a non-adverse MAE to 0 and counts it as "never went
 * offside"; clamping here too would throw away the actual worst price seen and
 * change nothing downstream.
 */

import { toEpoch } from "./time";

/** One bar. `t` is the bar's OPEN time; it covers [t, t + interval). */
export type Candle = {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
};

export type ExcursionScanInput = {
  candles: readonly Candle[];
  /** Fill window, in the same instants `tj_position_stats` reports. */
  openedAt: string | null;
  closedAt: string | null;
  /** Short positions swap which extreme is adverse. */
  isShort: boolean;
  /** Bar length in milliseconds — the caller chose the interval, so it knows. */
  intervalMs: number;
  /** Average entry fill, when known. Counts as an observed price. */
  entryPrice?: number | null;
  /** Average exit fill, when known. Counts as an observed price. */
  exitPrice?: number | null;
};

export type ExcursionScan = {
  /** Worst price against the position. Null when nothing could be observed. */
  maePrice: number | null;
  /** Best price in favour of the position. */
  mfePrice: number | null;
  /** Bars lying entirely inside the holding window. */
  bars: number;
  /**
   * Bars that overlap the window but hang over one of its edges, and were
   * therefore dropped by rule 1. Reported so a caller can tell "the provider
   * returned nothing" from "everything it returned sat on the boundary" —
   * the second is a signal to re-fetch at a finer interval, the first is not.
   */
  partialBars: number;
  /**
   * Share of the holding window covered by counted bars, 0..1.
   *
   * A quality hint, NOT a correctness measure: a position held over a weekend
   * legitimately scores far below 1 because the market was shut. Read a low
   * number as "ask why", never as "wrong".
   */
  coverage: number;
  /** True when the answer rests on the fills alone, with no bar behind it. */
  fillsOnly: boolean;
};

const EMPTY: ExcursionScan = {
  maePrice: null,
  mfePrice: null,
  bars: 0,
  partialBars: 0,
  coverage: 0,
  fillsOnly: false,
};

const finite = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n);

/**
 * The two extreme prices a trade was exposed to.
 *
 * Returns nulls rather than zeros when nothing can be observed — a missing
 * excursion is missing, and `computeExcursionStats` already reports its own
 * sample size rather than averaging absences as zero.
 */
export function scanExcursion(input: ExcursionScanInput): ExcursionScan {
  const { candles, openedAt, closedAt, isShort, intervalMs } = input;

  const openMs = toEpoch(openedAt);
  const closeMs = toEpoch(closedAt);
  // `toEpoch` answers -Infinity for a missing or unparseable instant. Without a
  // window there is nothing to scan: an open position has no closing edge yet.
  if (!Number.isFinite(openMs) || !Number.isFinite(closeMs)) return EMPTY;
  if (closeMs < openMs) return EMPTY;
  if (!finite(intervalMs) || intervalMs <= 0) return EMPTY;

  let lowest: number | null = null;
  let highest: number | null = null;
  let bars = 0;
  let partialBars = 0;

  for (const c of candles) {
    if (!finite(c.h) || !finite(c.l)) continue;
    const t = toEpoch(c.t);
    if (!Number.isFinite(t)) continue;

    const end = t + intervalMs;
    // Disjoint from the hold entirely — not partial, just irrelevant.
    if (end <= openMs || t >= closeMs) continue;
    if (t < openMs || end > closeMs) {
      partialBars++;
      continue;
    }

    bars++;
    if (lowest == null || c.l < lowest) lowest = c.l;
    if (highest == null || c.h > highest) highest = c.h;
  }

  // Rule 2: the fills are prices the position demonstrably saw.
  for (const fill of [input.entryPrice, input.exitPrice]) {
    if (!finite(fill)) continue;
    if (lowest == null || fill < lowest) lowest = fill;
    if (highest == null || fill > highest) highest = fill;
  }

  if (lowest == null || highest == null) return { ...EMPTY, partialBars };

  const windowMs = closeMs - openMs;
  const coverage =
    windowMs > 0 ? Math.min(1, (bars * intervalMs) / windowMs) : 0;

  return {
    // A long is hurt by low prices and helped by high ones; a short is the
    // mirror. This single swap is the whole of the direction handling.
    maePrice: isShort ? highest : lowest,
    mfePrice: isShort ? lowest : highest,
    bars,
    partialBars,
    coverage,
    fillsOnly: bars === 0,
  };
}

/**
 * Bar length to request for a position held `holdMs`.
 *
 * Rule 1 drops the boundary bars, so the interval has to be small enough that
 * losing two of them still leaves the middle of the trade visible. Roughly:
 * aim for tens of bars across the hold, then round to an interval a provider
 * actually serves.
 *
 * The ladder is capped at one hour rather than continuing to 4h and 1d. A
 * multi-week swing does not need daily bars to find its extreme — hourly bars
 * find the same high, and they keep the two discarded boundary bars from
 * costing two whole days of the trade.
 */
export const CANDLE_INTERVALS_MS = {
  m1: 60_000,
  m5: 300_000,
  m15: 900_000,
  m30: 1_800_000,
  h1: 3_600_000,
} as const;

export type CandleInterval = keyof typeof CANDLE_INTERVALS_MS;

export function suggestInterval(holdMs: number): CandleInterval {
  if (!finite(holdMs) || holdMs <= 0) return "m5";
  const HOUR = 3_600_000;
  if (holdMs <= 2 * HOUR) return "m1";
  if (holdMs <= 12 * HOUR) return "m5";
  if (holdMs <= 3 * 24 * HOUR) return "m15";
  if (holdMs <= 10 * 24 * HOUR) return "m30";
  return "h1";
}
