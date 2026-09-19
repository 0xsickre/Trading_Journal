/**
 * MAE/MFE from a third-party candle feed, for trades whose fills were recorded
 * somewhere else.
 *
 * Two facts make this harder than "take the low and the high between entry and
 * exit", and each would put a confidently wrong price on the trade:
 *
 * 1. THE FEED IS NOT THE BROKER. Dukascopy's copper runs three or four cents
 *    above OANDA's; gold and the Nasdaq differ by cents or points. A raw feed
 *    extreme next to a broker fill is two prices from two markets. So the
 *    difference — the BASIS — is measured from the trade itself, and every feed
 *    price is shifted by it before it is compared with anything.
 *
 * 2. THE FILL TIME IS OFTEN A BAR, NOT A MINUTE. TradingView exports the open
 *    of the bar a fill happened in: a limit on a 4-hour chart reads "09:00"
 *    whether it filled at 09:01 or 12:58. Scanning from 09:00 would count
 *    minutes before the position existed.
 *
 * Both are answered by one observation: a fill is a price the market actually
 * printed, inside its bar. For each fill, the basis must be one that puts the
 * fill price inside the range the feed traded during that bar. Intersecting
 * those ranges across every fill gives the basis the trade allows.
 *
 * WHICH basis from that range: the one CLOSEST TO ZERO. Two brokers quote the
 * same market, so absent evidence of a difference there is none; when the fills
 * prove a difference, the smallest one they prove is taken. The midpoint was
 * tried first and is wrong in exactly the common case: a 4-hour bar is wide, the
 * range it allows is wide, and its midpoint put a $1.50 difference on a trade
 * whose feed matched the broker to the cent. The chosen basis sits at a known
 * distance from the far end of the range, and that distance travels with it as
 * the uncertainty.
 *
 * An EMPTY intersection means no single basis makes the fills consistent with
 * the market — almost always a timezone error in the fill times (that is how
 * a chart on New York time imported as Belgrade time was caught). It is
 * refused, never guessed through: an extreme computed six hours from the trade
 * is a number from a different trade.
 *
 * With the basis known, each fill's minute is the first minute of its bar that
 * traded the (shifted) fill price, and the excursion is scanned between the
 * entry minute and the last exit minute — full minutes only, with the fills
 * themselves counting as observed prices, so the answer never reaches past what
 * the position could have seen.
 */

import type { FeedCandle } from "./dukascopy";

const MINUTE = 60_000;

/** Bar lengths a fill time can have been snapped to, longest first. */
const BARS = [4 * 60, 60, 30, 15, 5, 1].map((m) => m * MINUTE);

export type FeedFill = { side: "entry" | "exit"; price: number; at: number };

/**
 * The bar the fill times were snapped to.
 *
 * The longest standard bar that divides every gap between fills. Fills stamped
 * 09:00 and 17:00 the next day are 32 hours apart — a 4-hour grid. Fills typed
 * as 13:47 and 16:03 share nothing coarser than a minute, so the minute is
 * their bar. A coincidence can only make the bar LONGER than it was, which
 * widens the windows below and costs precision, never correctness.
 */
export function inferBarMs(times: readonly number[]): number {
  const sorted = [...times].sort((a, b) => a - b);
  const gaps = sorted.slice(1).map((t, i) => t - sorted[i]).filter((g) => g > 0);
  if (gaps.length === 0) return MINUTE;
  for (const bar of BARS) {
    if (gaps.every((g) => g % bar === 0)) return bar;
  }
  return MINUTE;
}

function candlesIn(candles: readonly FeedCandle[], from: number, to: number) {
  return candles.filter((c) => c.t >= from && c.t < to);
}

export type FeedExcursion =
  | {
      ok: true;
      maePrice: number;
      mfePrice: number;
      /** Broker price minus feed price, as measured from the fills. */
      basis: number;
      /** How far the basis could be from the one used; 0 when assumed equal. */
      basisUncertainty: number;
      barMs: number;
      /** The minutes the scan ran between. */
      from: number;
      to: number;
      /** Full minutes counted. */
      minutes: number;
    }
  | { ok: false; reason: string };

/**
 * How much of the excursion the basis may leave uncertain before the answer is
 * refused. A quarter: beyond it, which minute was the worst depends more on the
 * assumed difference between two feeds than on what the market did.
 */
const MAX_UNCERTAINTY_SHARE = 0.25;

export function excursionFromFeed(input: {
  fills: readonly FeedFill[];
  isShort: boolean;
  candles: readonly FeedCandle[];
  /** Largest believable broker-vs-feed difference; see `DUKASCOPY_INSTRUMENTS`. */
  maxBasis?: number;
}): FeedExcursion {
  const { fills, isShort, candles } = input;
  const entries = fills.filter((f) => f.side === "entry");
  const exits = fills.filter((f) => f.side === "exit");
  if (entries.length === 0 || exits.length === 0) {
    return { ok: false, reason: "the trade is not closed" };
  }

  const barMs = inferBarMs(fills.map((f) => f.at));

  // The basis each fill allows: fill − d must lie within what the feed traded
  // during that fill's bar, so d ∈ [fill − high, fill − low].
  let lo = Number.NEGATIVE_INFINITY;
  let hi = Number.POSITIVE_INFINITY;
  for (const f of fills) {
    const bar = candlesIn(candles, f.at, f.at + barMs);
    if (bar.length === 0) {
      return { ok: false, reason: `no market data in the bar of the ${f.side} at ${new Date(f.at).toISOString()}` };
    }
    const barLow = Math.min(...bar.map((c) => c.l));
    const barHigh = Math.max(...bar.map((c) => c.h));
    lo = Math.max(lo, f.price - barHigh);
    hi = Math.min(hi, f.price - barLow);
  }
  if (lo > hi) {
    return {
      ok: false,
      reason:
        "the fills do not match the market at those times — check the timezone the trade was recorded in",
    };
  }
  // Zero when zero is consistent with every fill; otherwise the nearer end.
  const basis = Math.min(Math.max(0, lo), hi);
  // Zero basis on a consistent trade is an assumption, not a measurement, and
  // is reported as such (uncertainty 0 means "assumed equal"). A measured basis
  // can be anywhere up to the far end of the range.
  const basisUncertainty = basis === 0 ? 0 : Math.max(basis - lo, hi - basis);

  // A wide bar allows a wide range of differences, and a wrong timezone can
  // land inside it: the same gold trade read six hours early still "fit" the
  // market at a $3.13 difference. No two gold quotes differ by $3, so that is a
  // wrong time, not a difference between brokers.
  if (input.maxBasis != null && Math.abs(basis) > input.maxBasis) {
    return {
      ok: false,
      reason: `the fills sit ${Math.abs(basis).toFixed(5).replace(/0+$/, "").replace(/\.$/, "")} away from the market at those times — more than two brokers differ; check the timezone the trade was recorded in`,
    };
  }

  /** The first minute of the fill's bar that traded its (shifted) price. */
  const minuteOf = (f: FeedFill): number => {
    const target = f.price - basis;
    const bar = candlesIn(candles, f.at, f.at + barMs);
    const touched = bar.find((c) => c.l <= target && target <= c.h);
    if (touched) return touched.t;
    // The basis can fall in a gap between two minutes that each straddle it;
    // the nearest minute is then the honest answer.
    let best = bar[0];
    let bestDist = Number.POSITIVE_INFINITY;
    for (const c of bar) {
      const dist = target < c.l ? c.l - target : target - c.h;
      if (dist < bestDist) {
        best = c;
        bestDist = dist;
      }
    }
    return best.t;
  };

  const from = Math.min(...entries.map(minuteOf));
  const to = Math.max(...exits.map(minuteOf));

  // Full minutes strictly between the entry minute and the exit minute. The
  // entry and exit minutes themselves also traded prices the position never
  // held; the fills stand in for them.
  let low = Math.min(...fills.map((f) => f.price));
  let high = Math.max(...fills.map((f) => f.price));
  let minutes = 0;
  for (const c of candles) {
    if (c.t <= from || c.t >= to) continue;
    minutes++;
    low = Math.min(low, c.l + basis);
    high = Math.max(high, c.h + basis);
  }

  if (basisUncertainty > MAX_UNCERTAINTY_SHARE * (high - low)) {
    return {
      ok: false,
      reason:
        "the feed differs from the broker by an amount the fills cannot pin down — the extremes would be more guess than measurement",
    };
  }

  return {
    ok: true,
    maePrice: isShort ? high : low,
    mfePrice: isShort ? low : high,
    basis,
    basisUncertainty,
    barMs,
    from,
    to,
    minutes,
  };
}
