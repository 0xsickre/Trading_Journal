/**
 * Equity at the START of each day, which is what a percentage limit is a
 * percentage OF.
 *
 * WHY THE OPENING AND NOT THE LIVE FIGURE. A limit measured against equity as
 * it stands right now is a moving target: lose money and the limit shrinks, so
 * "2 % of equity" allows less after every loss and the rule can never quite be
 * broken. Pegging it to the balance the day opened with — the previous day's
 * close — gives the day one fixed number to be judged against, which is also
 * the convention every prop firm uses and the one `ftmo.ts` already implements
 * as `prev_close`.
 *
 * WHY IT CAN ANSWER `null`. An unpriced trade (an instrument with no point
 * value) makes the realized total unknown from that day on, and an unknown
 * denominator cannot produce an honest percentage. Returning `null` lets the
 * evaluator report the rule as not scored, which is the same answer
 * `auto-rules.ts` already gives for an unpriced day — rather than quietly
 * measuring against a balance that is missing a trade.
 */

import { zonedDateKey } from "../time";
import type { CashEvent } from "../balance";
import type { TradeDayIndex } from "./auto-rules";

/** Equity the given day opened with, or null when it cannot be known. */
export type EquityLadder = (day: string) => number | null;

type Rung = {
  day: string;
  /** Equity at the END of `day`. */
  equity: number;
};

/**
 * Cash movements folded onto the account-timezone day they landed on.
 *
 * Separate from the trades because they come from a different table and carry
 * their own instant. The timezone is the account's, for the same reason the
 * trade index takes one: a deposit at 23:00 New York is not the next day's
 * opening balance.
 */
export function cashByDay(
  events: readonly CashEvent[],
  tzOf: (accountId: string) => string,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of events) {
    if (!e.occurred_at) continue;
    const day = zonedDateKey(e.occurred_at, tzOf(e.account_id));
    if (!day) continue;
    out.set(day, (out.get(day) ?? 0) + e.amount);
  }
  return out;
}

/**
 * Build the ladder once, then read it per day.
 *
 * A precomputed ladder rather than a sum per query: compliance is evaluated
 * over a 182-day window on the daily page and a longer one on the dashboard,
 * and re-summing the whole book for each of those days turns an O(N) walk into
 * O(days × N).
 *
 * `startingBalance` is the book's, summed across accounts, matching the
 * dashboard's unfiltered equity curve — the limits are about the trader's
 * capital, not about one account's slice of it.
 */
export function buildEquityLadder(
  index: TradeDayIndex,
  startingBalance: number,
  cash: Map<string, number>,
): EquityLadder {
  const days = new Set<string>([...index.byCloseDay.keys(), ...cash.keys()]);
  const ordered = [...days].sort();

  const rungs: Rung[] = [];
  let equity = startingBalance;
  /** The first day whose realized total is unknowable. Everything after is too. */
  let brokenFrom: string | null = null;

  for (const day of ordered) {
    const closed = index.byCloseDay.get(day) ?? [];
    if (brokenFrom == null && closed.some((t) => t.netPl == null)) {
      brokenFrom = day;
    }
    for (const t of closed) equity += t.netPl ?? 0;
    equity += cash.get(day) ?? 0;
    rungs.push({ day, equity });
  }

  return (day: string): number | null => {
    // The opening balance is the close of the last day BEFORE this one, so a
    // day's own trades never move the limit they are judged against.
    if (brokenFrom != null && brokenFrom < day) return null;

    let lo = 0;
    let hi = rungs.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (rungs[mid].day < day) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    // No day before this one moved the balance: the account still opens on what
    // it started with. That is a real answer, not missing data.
    return found === -1 ? startingBalance : rungs[found].equity;
  };
}

/**
 * A ladder for a book with no starting balance recorded.
 *
 * Zero equity has no meaningful percentage of it, so every day answers `null`
 * and the percentage rules report themselves as unconfigured rather than
 * dividing by nothing. Used when the accounts sum to zero — which is the seed
 * default, so this is the state a brand-new journal is actually in.
 */
export const NO_EQUITY: EquityLadder = () => null;

/**
 * The ladder for a whole book, from what every caller already has in hand.
 *
 * Four screens evaluate the tracker and all four had to answer the same three
 * questions — what did the accounts start with, when did cash move, in which
 * zone — so they ask them here instead of four times over. `accountFilter` on
 * the dashboard is the one caller that scopes the book, and it scopes the
 * accounts and cash it passes in rather than asking this to know about filters.
 */
export function bookEquityLadder(
  index: TradeDayIndex,
  accounts: readonly { starting_balance?: number | null }[],
  cashEvents: readonly CashEvent[],
  tzOf: (accountId: string) => string,
): EquityLadder {
  const startingBalance = accounts.reduce(
    (sum, a) => sum + (a.starting_balance ?? 0),
    0,
  );
  // A book with no starting balance has no percentage of itself, and the seed
  // writes 0 — so this is the state a new journal is in, not an edge case.
  if (startingBalance <= 0) return NO_EQUITY;
  return buildEquityLadder(index, startingBalance, cashByDay(cashEvents, tzOf));
}
