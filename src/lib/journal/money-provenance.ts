/**
 * Where a money column's number came from — and when it is not there at all.
 *
 * The view already carries three columns that answer this:
 * `point_value_source`, `fx_rate_source` and `money_overridden`. Until now the
 * screen read ONLY the first, and in one place (`journal-grid.tsx`, the
 * "unpriced" badge).
 *
 * The consequence was a hole Step 3 spotted and deferred to here: a trade on an
 * instrument that HAS a `point_value` but whose FX rate is unknown has every
 * money column null — while `point_value_source` reads a perfectly healthy
 * `snapshot`, so no badge appears. The user sees a bare dash in the P/L column
 * and has nothing to do about it, because nothing says the reason is the rate.
 *
 * The reverse case is just as invisible: `money_overridden` means gross was NOT
 * computed from prices but transcribed from a statement or typed by hand. That
 * number is often MORE accurate than the computed one — the platform converted
 * it at the rate in force at execution, which can be neither recovered nor
 * reproduced. But it came about differently, and a reader comparing P/L against
 * R should know why they disagree: R is still computed FROM PRICES.
 *
 * Hence one function, rather than three conditions scattered across screens —
 * the same lesson as Step 5.
 */

import type { PositionStat, TradeRow } from "./types";

export type MoneyProvenance = {
  /** Short badge text, or null when there is nothing to say. */
  label: "unpriced" | "no FX" | "no account" | "broker" | null;
  /** A sentence saying what to do, or why the number is the way it is. */
  title: string | null;
  /**
   * Whether the money columns are null BECAUSE data is missing.
   *
   * Different from `label != null`: `broker` marks provenance, not breakage —
   * the money is there and it is correct. A screen that wants to colour a
   * problem red has to read this, not the presence of a badge.
   */
  unpriced: boolean;
};

const NONE: MoneyProvenance = { label: null, title: null, unpriced: false };

/**
 * Where one trade's money came from.
 *
 * The order of the checks is the order of CAUSE, not of importance. When gross
 * was transcribed, neither the contract spec nor the FX rate was needed — so
 * the absence of either is no cause for alarm and `broker` wins. Only when the
 * number is COMPUTED from prices do `point_value` and the rate become
 * preconditions, and then the absence of either means there is no money figure.
 */
export function moneyProvenance(
  stats: Pick<
    PositionStat,
    "point_value_source" | "fx_rate_source" | "money_overridden"
  > | null | undefined,
): MoneyProvenance {
  if (!stats) return NONE;

  if (stats.money_overridden) {
    return {
      label: "broker",
      title:
        "Gross P&L was entered directly (manual entry or broker CSV) rather than computed from prices, so neither the contract spec nor an FX rate touched it. R is still measured from prices.",
      unpriced: false,
    };
  }

  if (stats.point_value_source === "missing") {
    return {
      label: "unpriced",
      title:
        "No instrument definition for this symbol, so its point value is unknown and P/L cannot be calculated. Add the instrument in Settings.",
      unpriced: true,
    };
  }

  if (stats.fx_rate_source === "no_account") {
    return {
      label: "no account",
      title:
        "This trade has no account, so there is no currency to convert into and P/L cannot be calculated. Assign an account to the trade.",
      unpriced: true,
    };
  }

  if (stats.fx_rate_source === "missing") {
    return {
      label: "no FX",
      title:
        "The instrument is quoted in a different currency from the account and no exchange rate was recorded on this trade, so P/L cannot be calculated. Edit the trade and enter the rate.",
      unpriced: true,
    };
  }

  return NONE;
}

/**
 * Closed trades that no statistic counts.
 *
 * THE STEP 9 FINDING, and the most serious place a number on screen can be
 * wrong without anyone noticing — because it is not wrong, it is INCOMPLETE.
 *
 * `toRealized` discards every row whose `net_pl` is null:
 *
 *     if (!stats || stats.net_pl == null) return [];
 *
 * That is the right decision. A trade that cannot be valued must not enter a
 * total as a zero, and this whole project is built around that. But a discarded
 * row vanishes from EVERYTHING built on `toRealized`: the trade count, the net
 * result, profit factor, expectancy, the Sickre Score, the calendar, the
 * reports and the insights.
 *
 * A trader with ten closed trades, three of them on a symbol with no
 * instrument, sees "7 trades" and a net that leaves out three real results.
 * `/journal` has carried a per-row badge since Step 8, but the dashboard and
 * the reports say nothing — and those are the screens where the overall state
 * is read.
 *
 * This function counts exactly that gap, so a screen can acknowledge it. It
 * does NOT try to fill it: an estimate would be invention, and that is the
 * error all of this exists to avoid.
 */
export function unpricedClosedCount(trades: readonly TradeRow[]): number {
  let n = 0;
  for (const t of trades) {
    // Closed only. A planned or missed trade has nothing to value, and an open
    // one has not realized a result yet — neither of them is part of the gap.
    if (t.status !== "closed") continue;
    if (t.stats?.net_pl == null) n++;
  }
  return n;
}
