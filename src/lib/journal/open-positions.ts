import { addDaysToDayKey, zonedDateKey } from "./time";
import type { TradeRow } from "./types";

/**
 * A position as the daily check-in needs to see it.
 *
 * Not `EnrichedTrade`: that type is built from `RealizedTrade`, which by
 * definition only holds CLOSED trades. The whole point here is the ones still
 * running.
 */
export type OpenPosition = {
  row: TradeRow;
  id: string;
  label: string;
  openDay: string;
  /** Days held INCLUSIVE of the open day, so the first day reads as day 1. */
  daysInTrade: number;
  timeStopDays: number | null;
  pastTimeStop: boolean;
};

function numOrNull(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Whole days from `from` to `to`, counting the first day as 1.
 *
 * Day keys rather than timestamps on purpose: a swing hold is counted in
 * sessions, not in hours. A position opened at 15:50 on Monday and still open
 * on Tuesday morning is on day 2, and an hours-based count would call it day 1
 * for another sixteen hours.
 *
 * Walks with `addDaysToDayKey` instead of subtracting epochs so DST cannot make
 * a day 23 or 25 hours long and round the answer off by one.
 */
export function daysBetweenKeys(from: string, to: string): number {
  if (!from || !to || to < from) return 0;
  let day = from;
  for (let i = 1; i <= 3_650; i++) {
    if (day >= to) return i;
    day = addDaysToDayKey(day, 1);
  }
  return 3_650;
}

/**
 * Positions that were open on `dayKey`, in the account's timezone.
 *
 * Reads the trades the page has already loaded rather than issuing its own
 * query — `/daily` calls `getTradesWithStats()` for the day's numbers anyway,
 * and a second round trip for a list derivable from the first is a round trip
 * spent on nothing.
 *
 * "Open on day D" is `opened on or before D` AND `not yet closed, or closed on
 * D or later`. The closing day counts as open: the position was live for part
 * of it, it can still have been touched, and its thesis was either right or
 * wrong that morning. Excluding it would make the last day of every trade —
 * often the one that decided the outcome — the one day nobody journalled.
 *
 * A trade with no `opened_at` is not open, it is PLANNED. Planned trades carry
 * no exposure and nothing to check.
 */
export function openPositionsOn(
  trades: readonly TradeRow[],
  dayKey: string,
  tzOf: (row: TradeRow) => string,
): OpenPosition[] {
  const out: OpenPosition[] = [];

  for (const row of trades) {
    if (row.status === "missed" || row.status === "planned") continue;

    const openedAt = row.stats?.opened_at ?? null;
    if (!openedAt) continue;

    const tz = tzOf(row);
    const openDay = zonedDateKey(openedAt, tz);
    if (!openDay || openDay > dayKey) continue;

    const closedAt = row.stats?.closed_at ?? null;
    if (closedAt) {
      const closeDay = zonedDateKey(closedAt, tz);
      if (closeDay && closeDay < dayKey) continue;
    }

    const days = daysBetweenKeys(openDay, dayKey);
    const timeStopDays = numOrNull(row.time_stop_days);
    const instrument =
      typeof row.instrument === "string" ? row.instrument : null;

    out.push({
      row,
      id: row.id,
      label: `${row.trade_no != null ? `#${row.trade_no}` : row.id.slice(0, 8)}${
        instrument ? ` ${instrument}` : ""
      }`,
      openDay,
      daysInTrade: days,
      timeStopDays,
      // Strictly past, not "at": on the day the time stop is reached the plan is
      // still being followed. The warning belongs to the day it was broken.
      pastTimeStop: timeStopDays != null && days > timeStopDays,
    });
  }

  // Oldest first: the position closest to its time stop is the one most likely
  // to need a decision, and it should not be at the bottom of the list.
  return out.sort((a, b) => a.openDay.localeCompare(b.openDay));
}
