import type { BiasValue } from "./types";

export type PriceExcursionInput = {
  prevWeekClose: number | null;
  periodHigh: number | null;
  periodLow: number | null;
  periodClose: number | null;
  finalBias: BiasValue;
};

export type PriceExcursionResult = {
  /** Max move in favor of final bias (signed). */
  mfe: number | null;
  /** Max adverse move against final bias (signed, typically negative). */
  mae: number | null;
  /** Realized move at period close vs reference (signed). */
  closeMove: number | null;
  /** High − low when both exist. */
  range: number | null;
};

/** MFE / MAE / close move from OHLC anchor + final bias direction. */
export function computePriceExcursion(
  input: PriceExcursionInput,
): PriceExcursionResult | null {
  const { prevWeekClose: ref, periodHigh: high, periodLow: low, periodClose: close, finalBias } =
    input;
  if (ref == null || !Number.isFinite(ref)) return null;

  const result: PriceExcursionResult = {
    mfe: null,
    mae: null,
    closeMove: null,
    range: null,
  };

  if (high != null && low != null) result.range = high - low;

  if (finalBias === "bullish") {
    if (high != null) result.mfe = high - ref;
    if (low != null) result.mae = low - ref;
    if (close != null) result.closeMove = close - ref;
  } else if (finalBias === "bearish") {
    if (low != null) result.mfe = ref - low;
    if (high != null) result.mae = ref - high;
    if (close != null) result.closeMove = ref - close;
  } else if (close != null) {
    result.closeMove = close - ref;
  }

  return result;
}

/** Convert a price delta to tick units (pips/points). */
export function priceToUnits(move: number, tickSize: number | null | undefined): number {
  if (!tickSize || tickSize <= 0) return move;
  return move / tickSize;
}

export function formatPriceMove(
  move: number | null | undefined,
  tickSize: number | null | undefined,
): string {
  if (move == null || !Number.isFinite(move)) return "—";
  if (tickSize && tickSize > 0) {
    const units = move / tickSize;
    const sign = units >= 0 ? "+" : "";
    return `${sign}${units.toFixed(1)} pips`;
  }
  const sign = move >= 0 ? "+" : "";
  return `${sign}${move.toFixed(5)}`;
}
