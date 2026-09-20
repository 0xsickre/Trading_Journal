/**
 * Portfolio heat — how much of the account is at stake RIGHT NOW.
 *
 * THE GAP THIS CLOSES. Every risk figure in this journal is per trade: the
 * tracker grades each entry against a ceiling, and the reports group them. None
 * of them adds up what is open at the same moment. Three positions at 1 % are
 * not 3 % of anything if they gap together — and this is a swing book that
 * holds overnight and over weekends, where one Sunday open can move all three
 * at once.
 *
 * PER ACCOUNT, NEVER ACROSS. A percentage has a denominator, and two accounts
 * do not share one: 2 % of a €5,000 account plus 2 % of a $100,000 account is
 * not 4 % of anything that exists. `equity_at_entry` carries the same rule in
 * its own migration. "All accounts" therefore shows a list, not a sum.
 *
 * MEASURED IS NOT THE SAME AS ZERO. A position with no stop has no measurable
 * risk; counting it as 0 would turn "I do not know" into "it is safe", which is
 * the specific failure `sickre-score.ts` documents for drawdown. Those
 * positions are counted separately and said out loud: "3 of 4 measured".
 */

import { riskMoneyAtEntry } from "./risk-taken";
import { openQty } from "./trade-lifecycle";
import type { TradeRow } from "./types";

/** One open position's contribution to the heat. */
export type HeatPosition = {
  id: string;
  label: string;
  instrument: string | null;
  /** Money still at stake, or null when the position cannot be priced. */
  riskMoney: number | null;
  /** That money as a share of the account's equity now. */
  riskPct: number | null;
};

export type BookHeat = {
  accountId: string;
  positions: HeatPosition[];
  /** Sum over the positions that could be measured. */
  totalRiskMoney: number;
  /** The same over current equity; null when equity is unknown. */
  totalRiskPct: number | null;
  priced: number;
  unpriced: number;
};

/**
 * What a position still has at stake, in account currency.
 *
 * `riskMoneyAtEntry` prices the WHOLE entry, which is the right number for
 * judging the decision and the wrong one for judging exposure: a position
 * half-closed carries half the risk it opened with. Scaled by what is still
 * open, using the same `openQty` every other screen counts remaining size with.
 */
export function openRiskMoney(row: TradeRow): number | null {
  const full = riskMoneyAtEntry(row);
  if (full == null) return null;

  // `riskMoneyAtEntry` has already refused a row without a positive entry
  // quantity, so this cannot divide by zero — one guard, in one place.
  const entryQty = row.stats!.entry_qty as number;
  const remaining = openQty(entryQty, row.stats?.exit_qty ?? 0);
  if (remaining <= 0) return 0;
  return (full * remaining) / entryQty;
}

/**
 * The heat of one account's open positions.
 *
 * `equityNow` is the account's CURRENT equity, not the equity each trade opened
 * with: heat is a question about the present, and a denominator frozen weeks
 * ago would answer a different one.
 */
export function heatForAccount(
  accountId: string,
  openRows: readonly TradeRow[],
  equityNow: number | null,
): BookHeat {
  const positions: HeatPosition[] = openRows.map((row) => {
    const riskMoney = openRiskMoney(row);
    return {
      id: row.id,
      label: row.trade_no != null ? `#${row.trade_no}` : row.id.slice(0, 8),
      instrument: (row.instrument as string) ?? null,
      riskMoney,
      riskPct:
        riskMoney != null && equityNow != null && equityNow > 0
          ? (riskMoney / equityNow) * 100
          : null,
    };
  });

  const priced = positions.filter((p) => p.riskMoney != null);
  const totalRiskMoney = priced.reduce((s, p) => s + (p.riskMoney as number), 0);

  return {
    accountId,
    positions,
    totalRiskMoney,
    totalRiskPct:
      priced.length > 0 && equityNow != null && equityNow > 0
        ? (totalRiskMoney / equityNow) * 100
        : null,
    priced: priced.length,
    unpriced: positions.length - priced.length,
  };
}

/**
 * Heat for every account that has something open, one entry each.
 *
 * A map rather than a total, because the total does not exist. Accounts with no
 * open position are left out entirely — a zero row would fill the screen with
 * accounts the trader is not in.
 */
export function heatByAccount(
  openRows: readonly TradeRow[],
  equityOf: (accountId: string) => number | null,
): BookHeat[] {
  const byAccount = new Map<string, TradeRow[]>();
  for (const row of openRows) {
    const id = String(row.account_id ?? "");
    if (!id) continue;
    const arr = byAccount.get(id) ?? [];
    arr.push(row);
    byAccount.set(id, arr);
  }
  return [...byAccount.entries()].map(([id, rows]) =>
    heatForAccount(id, rows, equityOf(id)),
  );
}

/**
 * Whether the open risk has passed the ceiling the trader set for a SINGLE
 * trade — the only limit this journal stores.
 *
 * Deliberately not a new setting. The tracker's `risk_per_trade` percentage is
 * the number they already chose to describe their risk appetite, and a book
 * carrying more open risk than one trade is allowed to take is worth saying
 * out loud even though the two are not the same question. Null when no ceiling
 * is configured: an unset limit must never render as "within limits".
 */
export function heatExceedsPerTradeLimit(
  heat: BookHeat,
  perTradeLimitPct: number | null | undefined,
): boolean | null {
  if (perTradeLimitPct == null || !(perTradeLimitPct > 0)) return null;
  if (heat.totalRiskPct == null) return null;
  return heat.totalRiskPct > perTradeLimitPct;
}
