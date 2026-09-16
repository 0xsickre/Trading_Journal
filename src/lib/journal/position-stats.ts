/** Shared P/L + R math — must stay in sync with `tj_position_stats` SQL view. */

import { isShortDirection } from "./plan-calculations";

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
  /**
   * Quote currency → account currency, recorded when the trade was written.
   *
   * 1 when the currencies match. NULL means the rate is unknown, and then money
   * is null by the same rule as for `point_value`: a USDJPY trade valued at a
   * rate of 1 would add a hundred thousand yen to dollars and print it with a
   * `$`.
   *
   * Recorded, not computed at read time — otherwise today's rate would move
   * last year's P&L every time the page opened.
   */
  fx_rate?: number | null;
  /**
   * A gross result entered DIRECTLY, in the account's currency.
   *
   * When present it bypasses `gross_points × point_value × fx_rate` entirely —
   * it needs neither the contract spec nor a rate. That is what it is for:
   * manual entry and a broker's CSV both carry a number the platform already
   * converted at the rate in force at execution, and that rate can be neither
   * recovered nor reproduced.
   *
   * `realized_r` is still computed FROM PRICES when this is set. Money and R
   * are two different questions and this field answers only the first.
   */
  gross_pnl_override?: number | null;
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

/** Direction sign: −1 for a short, +1 otherwise. The predicate lives in `plan-calculations.ts`. */
export function tradeDirectionMultiplier(direction: string | null): 1 | -1 {
  return isShortDirection(direction) ? -1 : 1;
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
  const fxRate = input.fx_rate ?? null;
  const override = input.gross_pnl_override ?? null;
  const hasOverride = override != null && Number.isFinite(override);
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
    // Money is null without a point value OR without a rate; points and R are
    // price-space quantities and survive both, exactly as the SQL view has them.
    //
    // Commissions and swap are NOT multiplied by the rate: brokers book them in
    // the deposit currency, and the defaults they are filled from sit on the
    // account. Hence `gross × rate − costs`, not `(gross − costs) × rate`.
    if (hasOverride) {
      grossPl = override;
      netPl = grossPl - totalFees - totalSwap;
    } else if (pointValue != null && fxRate != null) {
      grossPl = grossPoints * pointValue * fxRate;
      netPl = grossPl - totalFees - totalSwap;
    }

    if (riskPts != null && entryQty > 0) {
      /**
       * R IS MEASURED AGAINST THE RISK ACTUALLY TAKEN, NOT THE PART CLOSED.
       *
       * The denominator uses `entryQty` — the whole position — while
       * `grossPoints` above covers only `exitQty`. For a fully closed trade the
       * two quantities are equal and this is exact. For a partially closed one
       * it is deliberately diluted: a position half closed at +2R reports +1R,
       * because the other half is still exposed to the same 1R of risk and has
       * not paid anything yet.
       *
       * The alternative — dividing by `exitQty` — would report the closed half
       * at its full +2R while the open half could still stop out, and a trade
       * scaled out in four pieces would print four 2R rows for one 1R of risk.
       *
       * Two consequences worth knowing, since `realized_r` flows on into
       * `rHistogram`, `expectancy` and the R filter alongside closed trades:
       *
       *   - an open partial reads LOW and drifts up as the rest closes;
       *   - the same expression lives in the SQL view
       *     (`20260728120000_snapshot_instrument_spec.sql`). The two must agree,
       *     so neither may be changed alone.
       */
      const riskDenom = riskPts * entryQty;
      realizedR = grossPoints / riskDenom;
      if (pointValue != null && fxRate != null) {
        // Net R divides money by money, so the denominator has to be in the same currency as the numerator.
        //
        // It needs point_value and the rate even when `netPl` is known through an
        // override: risk in money is still derived from prices. That is why R IN
        // MONEY can stay null while both the net result and R IN PRICE are
        // known — a gap, not a bug.
        const riskMoney = riskDenom * pointValue * fxRate;
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
