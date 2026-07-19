import type { TradeRow } from "./types";

export type SlippageInput = {
  direction: string | null;
  plannedEntry: number | null;
  avgEntry: number | null;
  stopPrice: number | null;
  entryQty?: number | null;
  pointValue?: number;
};

export type SlippageResult = {
  adversePts: number;
  slippageR: number | null;
  slippageMoney: number | null;
  favorable: boolean;
};

function tradeDirection(dir: string | null): 1 | -1 {
  return String(dir ?? "")
    .toLowerCase()
    .startsWith("short")
    ? -1
    : 1;
}

/** Entry slippage: planned vs avg fill. Positive adversePts = worse fill (cost). */
export function computeEntrySlippage(input: SlippageInput): SlippageResult | null {
  const { plannedEntry, avgEntry, stopPrice, direction, entryQty, pointValue = 1 } =
    input;

  if (
    plannedEntry == null ||
    avgEntry == null ||
    Number.isNaN(plannedEntry) ||
    Number.isNaN(avgEntry)
  ) {
    return null;
  }

  const dir = tradeDirection(direction);
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
  if (entryQty != null && entryQty > 0) {
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
  const pointValue = row.stats?.point_value ?? 1;

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
