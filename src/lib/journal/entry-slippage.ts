import { tradeDirectionMultiplier } from "./position-stats";
import type { TradeRow } from "./types";

export type SlippageInput = {
  direction: string | null;
  plannedEntry: number | null;
  avgEntry: number | null;
  stopPrice: number | null;
  entryQty?: number | null;
  /**
   * Null / absent means the trade has no contract spec, and `slippageMoney`
   * comes back null rather than being priced in raw points. `slippageR` is a
   * ratio in price space and is unaffected.
   */
  pointValue?: number | null;
};

export type SlippageResult = {
  adversePts: number;
  slippageR: number | null;
  slippageMoney: number | null;
  favorable: boolean;
};

/** Entry slippage: planned vs avg fill. Positive adversePts = worse fill (cost). */
export function computeEntrySlippage(input: SlippageInput): SlippageResult | null {
  const { plannedEntry, avgEntry, stopPrice, direction, entryQty, pointValue = null } =
    input;

  if (
    plannedEntry == null ||
    avgEntry == null ||
    Number.isNaN(plannedEntry) ||
    Number.isNaN(avgEntry)
  ) {
    return null;
  }

  const dir = tradeDirectionMultiplier(direction);
  const adversePts =
    dir === 1 ? avgEntry - plannedEntry : plannedEntry - avgEntry;

  let slippageR: number | null = null;
  if (stopPrice != null && !Number.isNaN(stopPrice)) {
    const plannedRisk = Math.abs(plannedEntry - stopPrice);
    if (plannedRisk > 0) {
      slippageR = adversePts / plannedRisk;
    }
  }

  let slippageMoney: number | null = null;
  if (entryQty != null && entryQty > 0 && pointValue != null) {
    slippageMoney = adversePts * pointValue * entryQty;
  }

  return {
    adversePts,
    slippageR,
    slippageMoney,
    favorable: adversePts < 0,
  };
}

export function slippageFromTrade(row: TradeRow): SlippageResult | null {
  const plannedEntry =
    typeof row.entry_price === "number" ? row.entry_price : null;
  const stopPrice =
    typeof row.stop_price === "number" ? row.stop_price : null;
  const direction = typeof row.direction === "string" ? row.direction : null;
  const avgEntry = row.stats?.avg_entry ?? null;
  const entryQty = row.stats?.entry_qty ?? null;
  // No `?? 1`: the view reports a null point value for a trade it cannot price,
  // and turning that into a 1 here would quote a dollar slippage figure for a
  // trade whose P&L the database itself refused to state.
  const pointValue = row.stats?.point_value ?? null;

  return computeEntrySlippage({
    direction,
    plannedEntry,
    avgEntry,
    stopPrice,
    entryQty,
    pointValue,
  });
}

/** Display slippage R with sign inverted for adverse (cost shows as negative R). */
export function fmtSlippageR(slippageR: number | null | undefined): string {
  if (slippageR == null || Number.isNaN(slippageR)) return "—";
  const display = -slippageR;
  return `${display > 0 ? "+" : ""}${display.toFixed(2)}R`;
}

export function fmtSlippagePts(adversePts: number): string {
  const sign = adversePts >= 0 ? "+" : "";
  return `${sign}${adversePts.toFixed(4)} pts`;
}
