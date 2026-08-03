/**
 * Cost report — commissions, swap, and what they take out of gross profit.
 *
 * `total_fees` and `total_swap` have always been in the position stats view and
 * on the trade form, but no aggregate ever read them. For a swing book this is
 * the report that decides whether a long hold was worth it.
 *
 * On "no data" vs zero: the spec is emphatic that a missing commission must not
 * render as 0. Our schema defaults fees to 0, so a total of zero is genuinely
 * ambiguous. Rather than guess, every figure ships with the number of trades
 * that actually carry a non-zero cost, so the UI can say "0 of 24 trades carry
 * cost data" instead of implying trading was free.
 */

import type { RealizedTrade } from "./analytics";

export type CostStats = {
  totalFees: number;
  totalSwap: number;
  totalCosts: number;
  /** Trades in scope. */
  count: number;
  /** Trades carrying a non-zero fee or swap — the honesty check on the totals. */
  withCostData: number;
  /** Gross profit of winning trades only; the base the spec divides by. */
  grossProfit: number;
  /** Costs as a share of gross profit. Null when there was no gross profit. */
  costPctOfGross: number | null;
  /** Total swap divided by total days held — the swing-specific number. */
  avgSwapPerHoldingDay: number | null;
  /** Days of exposure the swap figure is spread over. */
  holdingDays: number;
};

const EMPTY_COSTS: CostStats = {
  totalFees: 0,
  totalSwap: 0,
  totalCosts: 0,
  count: 0,
  withCostData: 0,
  grossProfit: 0,
  costPctOfGross: null,
  avgSwapPerHoldingDay: null,
  holdingDays: 0,
};

export function computeCostStats(trades: RealizedTrade[]): CostStats {
  if (trades.length === 0) return EMPTY_COSTS;

  let totalFees = 0;
  let totalSwap = 0;
  let withCostData = 0;
  let grossProfit = 0;
  let holdingDays = 0;

  for (const t of trades) {
    const fees = t.row.stats?.total_fees ?? 0;
    const swap = t.row.stats?.total_swap ?? 0;
    totalFees += fees;
    totalSwap += swap;
    if (fees !== 0 || swap !== 0) withCostData++;

    // Only winners contribute to gross profit; costs are measured against what
    // the edge actually produced, not against a net figure they already reduced.
    if (t.gross > 0) grossProfit += t.gross;

    const secs = t.row.stats?.duration_seconds;
    if (secs != null && secs > 0) holdingDays += secs / 86_400;
  }

  const totalCosts = totalFees + totalSwap;

  return {
    totalFees,
    totalSwap,
    totalCosts,
    count: trades.length,
    withCostData,
    grossProfit,
    // Signed on purpose: a net carry CREDIT must read as a negative share, not
    // get flipped into a cost by an absolute value.
    costPctOfGross: grossProfit > 0 ? (totalCosts / grossProfit) * 100 : null,
    avgSwapPerHoldingDay: holdingDays > 0 ? totalSwap / holdingDays : null,
    holdingDays,
  };
}
