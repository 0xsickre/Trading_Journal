/**
 * Activity metrics: direction split, trading days, logged days.
 *
 * Note the two different day definitions in play, both deliberate:
 *
 *   trading day — a day a position was OPENED. This follows the spec, because
 *                 the question is "how often do I engage the market".
 *   P&L date    — the day a position was CLOSED, used everywhere money is
 *                 attributed (see period-stats.ts).
 *
 * Using the open date for money, as TradeZella does, would misdate a swing
 * book's returns by weeks. Using the close date for activity would claim you
 * traded on days you did nothing.
 */

import type { RealizedTrade } from "./analytics";
import { classifyOutcome, EXACT_ZERO_RANGE, type BreakevenRange } from "./breakeven";
import { isShortDirection } from "./plan-calculations";
import { zonedDateKey } from "./time";
import type { TradeRow } from "./types";

export type DirectionStats = {
  count: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRate: number;
  net: number;
};

export type DirectionSplit = { longs: DirectionStats; shorts: DirectionStats };

const emptyDirection = (): DirectionStats => ({
  count: 0,
  wins: 0,
  losses: 0,
  breakeven: 0,
  winRate: 0,
  net: 0,
});

export function computeDirectionSplit(
  trades: RealizedTrade[],
  range: BreakevenRange = EXACT_ZERO_RANGE,
  pnlOf: (t: RealizedTrade) => number = (t) => t.net,
): DirectionSplit {
  const longs = emptyDirection();
  const shorts = emptyDirection();

  for (const t of trades) {
    const bucket = isShortDirection((t.row.direction as string) ?? null)
      ? shorts
      : longs;
    bucket.count++;
    // Follows the selected basis, so a gross/net switch moves this number too.
    bucket.net += pnlOf(t);
    const outcome = classifyOutcome(pnlOf(t), range);
    if (outcome === "win") bucket.wins++;
    else if (outcome === "loss") bucket.losses++;
    else bucket.breakeven++;
  }

  for (const b of [longs, shorts]) {
    const decided = b.wins + b.losses;
    b.winRate = decided > 0 ? (b.wins / decided) * 100 : 0;
  }

  return { longs, shorts };
}

/**
 * Days with a journal entry — the join between the "soft" journaling side and
 * the metrics engine, and the one number that proves the process was followed
 * on days that produced no trades at all.
 */
export function countLoggedDays(
  reportDates: string[],
  from?: string | null,
  to?: string | null,
): number {
  const seen = new Set<string>();
  for (const d of reportDates) {
    if (!d) continue;
    const day = d.slice(0, 10);
    if (from && day < from.slice(0, 10)) continue;
    if (to && day > to.slice(0, 10)) continue;
    seen.add(day);
  }
  return seen.size;
}

/**
 * Trading days taken from raw position rows rather than realized trades.
 *
 * A position opened this week and still running is a day you engaged the
 * market; counting only closed trades would omit it and under-report activity
 * exactly when the book is most active.
 */
export function tradingDayKeysFromRows(
  rows: TradeRow[],
  tzOf: (row: TradeRow) => string,
): Set<string> {
  const days = new Set<string>();
  for (const row of rows) {
    const ref = row.stats?.opened_at ?? row.stats?.closed_at ?? null;
    if (!ref) continue;
    const key = zonedDateKey(ref, tzOf(row));
    if (key) days.add(key);
  }
  return days;
}
