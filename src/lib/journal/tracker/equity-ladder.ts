/**
 * Equity at the START of each day — the denominator of the Survival card's
 * simulation on the dashboard.
 *
 * WHY THE OPENING AND NOT THE LIVE FIGURE. A share measured against equity as
 * it stands right now is a moving target: lose money and the base shrinks.
 * Pegging it to the balance the day opened with — the previous day's close —
 * gives the day one fixed number, which is also the convention every prop firm
 * uses. (The tracker's money rules read the Topstep plan instead since H2.)
 *
 * WHY IT CAN ANSWER `null`. An unpriced trade (an instrument with no point
 * value) makes the realized total unknown from that day on, and an unknown
 * denominator cannot produce an honest percentage.
 */

import { dayKeyIn, type DayZone } from "../time";
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
  tzOf: (accountId: string) => DayZone,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of events) {
    if (!e.occurred_at) continue;
    const day = dayKeyIn(e.occurred_at, tzOf(e.account_id));
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
    // A Topstep account's money is not capital a percentage limit is a share of:
    // its limits are the plan's (F3), so its trades never move this ladder.
    const closed = (index.byCloseDay.get(day) ?? []).filter((t) => !t.topstep);
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
  accounts: readonly { id?: string; starting_balance?: number | null; topstep_mode?: boolean | null }[],
  cashEvents: readonly CashEvent[],
  tzOf: (accountId: string) => DayZone,
): EquityLadder {
  // Topstep accounts left out, balance and cash alike (F3, E1): a 50K Topstep
  // balance is not money a CFD limit is a percentage of — the account can only
  // lose what is above its MLL, and its own limits are money from its plan.
  const topstep = new Set(accounts.filter((a) => a.topstep_mode && a.id).map((a) => a.id as string));
  const startingBalance = accounts
    .filter((a) => !a.topstep_mode)
    .reduce((sum, a) => sum + (a.starting_balance ?? 0), 0);
  cashEvents = cashEvents.filter((e) => !topstep.has(e.account_id));
  // A book with no starting balance has no percentage of itself, and the seed
  // writes 0 — so this is the state a new journal is in, not an edge case.
  if (startingBalance <= 0) return NO_EQUITY;
  return buildEquityLadder(index, startingBalance, cashByDay(cashEvents, tzOf));
}
