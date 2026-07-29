/** Shared P/L + R math — must stay in sync with `tj_position_stats` SQL view. */

export type ExecutionFill = {
  side: "entry" | "exit";
  price: number;
  qty: number;
  fee?: number;
  swap_funding?: number;
};

export type PositionStatsInput = {
  direction: string | null;
  entry_price: number | null;
  stop_price: number | null;
  /**
   * Contract point value. Null / absent means the trade cannot be priced, and
   * every money column comes back null — matching the view, which dropped its
   * `COALESCE(point_value, 1)` for exactly this reason. Pricing an unknown
   * instrument at 1 renders a 500-point ES win as $500.
   */
  point_value?: number | null;
  executions: ExecutionFill[];
};

export type ComputedPositionStats = {
  entry_qty: number;
  exit_qty: number;
  avg_entry: number | null;
  avg_exit: number | null;
  total_fees: number;
  total_swap: number;
  gross_points: number | null;
  gross_pl: number | null;
  net_pl: number | null;
  planned_risk_pts: number | null;
  realized_r: number | null;
  realized_r_net: number | null;
};

export function tradeDirectionMultiplier(direction: string | null): 1 | -1 {
  return String(direction ?? "")
    .toLowerCase()
    .startsWith("short")
    ? -1
    : 1;
}

/** Planned stop distance (points); prefers plan entry, falls back to avg fill. */
export function plannedRiskPts(
  plannedEntry: number | null,
  stopPrice: number | null,
  avgEntry: number | null,
): number | null {
  if (stopPrice == null || Number.isNaN(stopPrice)) return null;
  const entryRef =
    plannedEntry != null && !Number.isNaN(plannedEntry) ? plannedEntry : avgEntry;
  if (entryRef == null || Number.isNaN(entryRef)) return null;
  const risk = Math.abs(entryRef - stopPrice);
  return risk > 0 ? risk : null;
}

export function computePositionStats(
  input: PositionStatsInput,
): ComputedPositionStats {
  const pointValue = input.point_value ?? null;
  const dir = tradeDirectionMultiplier(input.direction);

  let entryQty = 0;
  let exitQty = 0;
  let entryNotional = 0;
  let exitNotional = 0;
  let totalFees = 0;
  let totalSwap = 0;

  for (const e of input.executions) {
    const qty = e.qty;
    const price = e.price;
    // Costs accrue before the quantity guard, matching the SQL view's
    // `sum(COALESCE(e.fee, 0))` over EVERY row of the position. Skipping the
    // fee along with the row made this function's net P&L disagree with the
    // stored figure for any fee-only or malformed fill — in a module whose
    // first line promises the two stay in sync.
    totalFees += e.fee ?? 0;
    totalSwap += e.swap_funding ?? 0;
    if (!Number.isFinite(qty) || !Number.isFinite(price) || qty <= 0) continue;
    if (e.side === "entry") {
      entryQty += qty;
      entryNotional += price * qty;
    } else {
      exitQty += qty;
      exitNotional += price * qty;
    }
  }

  const avgEntry = entryQty > 0 ? entryNotional / entryQty : null;
  const avgExit = exitQty > 0 ? exitNotional / exitQty : null;

  let grossPoints: number | null = null;
  let grossPl: number | null = null;
  let netPl: number | null = null;
  let realizedR: number | null = null;
  let realizedRNet: number | null = null;

  // Computed once and reused below — this used to be evaluated a second time
  // in the return object, so the two could drift apart under any future edit.
  const riskPts = plannedRiskPts(input.entry_price, input.stop_price, avgEntry);

  if (avgEntry != null && exitQty > 0) {
    grossPoints = (exitNotional - avgEntry * exitQty) * dir;
    // Money is null without a point value; points and R are price-space
    // quantities and survive one, exactly as the SQL view has them.
    if (pointValue != null) {
      grossPl = grossPoints * pointValue;
      netPl = grossPl - totalFees - totalSwap;
    }

    if (riskPts != null && entryQty > 0) {
      const riskDenom = riskPts * entryQty;
      realizedR = grossPoints / riskDenom;
      if (pointValue != null) {
        const riskMoney = riskDenom * pointValue;
        if (riskMoney > 0 && netPl != null) {
          realizedRNet = netPl / riskMoney;
        }
      }
    }
  }

  return {
    entry_qty: entryQty,
    exit_qty: exitQty,
    avg_entry: avgEntry,
    avg_exit: avgExit,
    total_fees: totalFees,
    total_swap: totalSwap,
    gross_points: grossPoints,
    gross_pl: grossPl,
    net_pl: netPl,
    planned_risk_pts: riskPts,
    realized_r: realizedR,
    realized_r_net: realizedRNet,
  };
}
