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
  point_value?: number;
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
  const pointValue = input.point_value ?? 1;
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
    if (!Number.isFinite(qty) || !Number.isFinite(price) || qty <= 0) continue;
    totalFees += e.fee ?? 0;
    totalSwap += e.swap_funding ?? 0;
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

  if (avgEntry != null && exitQty > 0) {
    grossPoints = (exitNotional - avgEntry * exitQty) * dir;
    grossPl = grossPoints * pointValue;
    netPl = grossPl - totalFees - totalSwap;

    const riskPts = plannedRiskPts(
      input.entry_price,
      input.stop_price,
      avgEntry,
    );
    if (riskPts != null && entryQty > 0) {
      const riskDenom = riskPts * entryQty;
      realizedR = grossPoints / riskDenom;
      const riskMoney = riskDenom * pointValue;
      if (riskMoney > 0 && netPl != null) {
        realizedRNet = netPl / riskMoney;
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
    planned_risk_pts: plannedRiskPts(
      input.entry_price,
      input.stop_price,
      avgEntry,
    ),
    realized_r: realizedR,
    realized_r_net: realizedRNet,
  };
}
