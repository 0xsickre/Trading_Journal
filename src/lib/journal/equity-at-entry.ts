/**
 * When `tj_positions.equity_at_entry` is written, and when it must not be.
 *
 * The column is the DENOMINATOR of every risk percentage in the application,
 * and it is the one part of that arithmetic that cannot be recovered after the
 * fact: the account's equity moves with every later trade, deposit and
 * correction, so a percentage recomputed next month would answer a question
 * nobody asked. It is therefore frozen, on the same principle as
 * `point_value_at_trade` — a fact captured when it was true.
 *
 * THREE RULES, and each one is a mistake that was available:
 *
 *   1. **Written once, when the trade first has an entry fill.** A plan has no
 *      entry, so it has no equity-at-entry; stamping one at creation would date
 *      the risk to the day the idea was written rather than the day the money
 *      was exposed.
 *   2. **Never overwritten.** Editing a fill's quantity a week later changes
 *      how much was risked (correctly — the risk was whatever was actually
 *      filled), but it must not restate what the account was worth on the day.
 *      Re-reading equity on that edit would quietly re-base every historical
 *      percentage against today's book.
 *   3. **Cleared on the way back to `planned`.** A save that removes the last
 *      fill turns the position back into a plan, and a plan must not keep an
 *      entry's denominator — refilling it next week would otherwise measure the
 *      new risk against the old day. (That save is the only route: both
 *      `markTradeMissed` and `restoreTradeToPlanned` refuse a trade with fills,
 *      so a stamped row reaches them only after passing through here.)
 *
 * `{}` — the empty patch — means "say nothing", and the dynamic UPDATE inside
 * `tj_save_trade` then never names the column. Same shape, and same reason, as
 * `excursionSourcePatch`.
 */

import type { PositionStatus } from "./trade-lifecycle";

/** Statuses that mean the position has been entered. */
const ENTERED: ReadonlySet<PositionStatus> = new Set<PositionStatus>([
  "open",
  "partial",
  "closed",
]);

export function equityAtEntryPatch(
  nextStatus: PositionStatus,
  prev: { equity_at_entry: number | null } | null,
  equity: number | null,
): { equity_at_entry?: number | null } {
  const had = prev?.equity_at_entry ?? null;

  if (!ENTERED.has(nextStatus)) {
    // Rule 3. Only when there is something to clear — an untouched plan must
    // not produce a write on every save.
    return had == null ? {} : { equity_at_entry: null };
  }

  // Rule 2: a value already on the row is the record, whatever today says.
  if (had != null) return {};

  // Rule 1, and the refusal that goes with it: an equity that could not be
  // computed (an unpriced trade earlier in the book) stays absent rather than
  // being written as a zero that would read as a real denominator.
  if (equity == null || !(equity > 0)) return {};

  return { equity_at_entry: equity };
}

/**
 * When the position was entered — the earliest entry fill.
 *
 * The earliest, not the latest: a position scaled into over three days was
 * risked from the first fill, and the day that first fill landed on is the day
 * whose opening balance the decision was made against.
 */
export function firstEntryAt(
  execs: readonly { side: string; executed_at: string }[],
): string | null {
  let earliest: string | null = null;
  for (const e of execs) {
    if (e.side !== "entry" || !e.executed_at) continue;
    if (earliest == null || e.executed_at < earliest) earliest = e.executed_at;
  }
  return earliest;
}
