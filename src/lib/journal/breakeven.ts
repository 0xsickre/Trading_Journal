/**
 * Outcome classification against the account's breakeven band.
 *
 * Before this module, a trade counted as breakeven only when net P&L equalled
 * exactly 0 — tested on a float that already carries fees. That is
 * practically never true, so the breakeven bucket was always empty and win rate
 * had nothing to exclude from its denominator.
 *
 * The band is asymmetric on purpose: "-37.50 to 0" is a normal configuration
 * (costs ate the trade but the idea was flat), not a symmetric tolerance.
 */

import { riskMoneyAtEntry } from "./risk-taken";
import type { TradeRow } from "./types";

export type Outcome = "win" | "loss" | "breakeven";

export type BreakevenUnit = "currency" | "pct";

/** The account fields this module needs — keeps callers and tests light. */
export type BreakevenConfig = {
  breakeven_from: number;
  breakeven_to: number;
  breakeven_unit: BreakevenUnit;
  starting_balance: number;
};

/**
 * A trade with a stop is a scratch while |net| is at most a tenth of its own
 * risk to that stop (K4, 30.09.2026) — on every account since phase X: the
 * share is the trader's, not a prop firm's.
 */
export const BREAKEVEN_R = 0.1;

/**
 * Band resolved into account currency, ready to compare against net P&L.
 *
 * `riskShare` (decided 30.09.2026, every account since phase X): a trade whose
 * risk is known is judged against ITS OWN risk — breakeven while |P&L| is at
 * most this share of it — and `from`/`to` (the account's band) are only the
 * fallback for a trade with no stop, a day or a week. A fixed dollar band is
 * the wrong unit for a trade: a full stop on one MES contract (−1.13R,
 * −$22.25) sat inside the ±$25 band of the time and was filed as a scratch,
 * leaving the loss out of the win rate and the expectancy.
 */
export type BreakevenRange = { from: number; to: number; riskShare?: number };

/** Reproduces the old exact-zero behaviour — used when no account is in scope. */
export const EXACT_ZERO_RANGE: BreakevenRange = { from: 0, to: 0 };

/** No money band, but still a tenth of a stop's risk — what every account shares (phase X). */
const NO_BAND: BreakevenRange = { ...EXACT_ZERO_RANGE, riskShare: BREAKEVEN_R };

export function resolveBreakevenRange(
  config: BreakevenConfig | null | undefined,
): BreakevenRange {
  if (!config) return EXACT_ZERO_RANGE;
  const { breakeven_from, breakeven_to, breakeven_unit, starting_balance } =
    config;
  if (breakeven_unit === "pct") {
    const base = Math.abs(starting_balance) / 100;
    return { from: breakeven_from * base, to: breakeven_to * base, riskShare: BREAKEVEN_R };
  }
  return { from: breakeven_from, to: breakeven_to, riskShare: BREAKEVEN_R };
}

/**
 * Classify realized P&L. The band is inclusive on both ends, so a 0..0 band
 * classifies exactly-zero as breakeven and behaves like the previous code.
 *
 * `riskMoney` is the trade's risk to its stop in account currency. Given, and
 * the range carries a `riskShare`, the band is that share of it; otherwise the
 * range's own money band. A day or a week has no single risk and passes none.
 */
export function classifyOutcome(
  netPnl: number,
  range: BreakevenRange = EXACT_ZERO_RANGE,
  riskMoney?: number | null,
): Outcome {
  if (range.riskShare != null && riskMoney != null && riskMoney > 0) {
    if (Math.abs(netPnl) <= range.riskShare * riskMoney) return "breakeven";
    return netPnl > 0 ? "win" : "loss";
  }
  if (netPnl >= range.from && netPnl <= range.to) return "breakeven";
  return netPnl > range.to ? "win" : "loss";
}

// Risk per row, read once: the reports engine classifies the same trade in
// every group it sits in, and the rows are stable objects between renders.
const riskCache = new WeakMap<object, number | null>();

/** A trade's outcome, judged against its own risk to the stop where the range says so. */
export function tradeOutcome(
  row: TradeRow,
  pnl: number,
  range: BreakevenRange = EXACT_ZERO_RANGE,
): Outcome {
  if (range.riskShare == null) return classifyOutcome(pnl, range);
  let risk = riskCache.get(row);
  if (risk === undefined) {
    risk = riskMoneyAtEntry(row);
    riskCache.set(row, risk);
  }
  return classifyOutcome(pnl, range, risk);
}

/** True when the account has an actual band configured (not the 0..0 default). */
export function hasBreakevenBand(range: BreakevenRange): boolean {
  return range.from !== 0 || range.to !== 0;
}

/**
 * One breakeven band for a set of accounts.
 *
 * The same six-line block stood in five copies — `dashboard.tsx` and four
 * routes (`/daily`, `/calendar`, the since-removed `/weekly`, `/playbooks`). While they are
 * identical, duplication is merely a cost; the problem is that editing one
 * would silently pull the screens apart, and the win rate on the Dashboard and
 * on the calendar would start to differ over the same trades.
 *
 * The rule: a band applies only if ALL accounts in scope agree on it. When they
 * do not, the money band falls back to exact zero — because a +$15 trade cannot
 * be breakeven on one account and a win on another at the same time, and
 * picking one of the two bands would apply somebody's rule to somebody else's
 * trades. The tenth of a stop's risk is every account's, so it stays.
 *
 * An empty set gives the same: there is no account whose band would apply.
 */
export function sharedBreakevenRange(
  accounts: readonly BreakevenConfig[],
): BreakevenRange {
  if (accounts.length === 0) return NO_BAND;
  const ranges = accounts.map((a) => resolveBreakevenRange(a));
  const first = ranges[0];
  const uniform = ranges.every(
    (r) => r.from === first.from && r.to === first.to && r.riskShare === first.riskShare,
  );
  return uniform ? first : NO_BAND;
}

/**
 * Each account's own band, by id — what the tracker judges a stop loss by
 * (`stop_after_two_losses`). A trade with no account, or an unknown one, gets
 * exact zero and still a tenth of a stop's risk.
 */
export function breakevenRangeResolver(
  accounts: readonly (BreakevenConfig & { id: string })[],
): (accountId: string | null | undefined) => BreakevenRange {
  const byId = new Map(accounts.map((a) => [a.id, resolveBreakevenRange(a)]));
  return (accountId) => (accountId ? (byId.get(accountId) ?? NO_BAND) : NO_BAND);
}
