import { zonedDateKey, addDaysToDayKey, isoWeekdayOfDayKey } from "./time";

/**
 * Did this trade's holding window cross a weekend?
 *
 * DERIVED, never stored. The manual `result` column was dropped from this schema
 * for duplicating the outcome that already falls out of net P&L, and a
 * `weekend_hold` flag would be the same mistake one table over: a stored answer
 * that can disagree with the dates it claims to describe. Derived, it is right
 * for every trade in the book — including imported ones and every trade booked
 * before anyone thought to ask the question.
 *
 * Why it earns its own function at all: for an intraweek swing book the weekend
 * is a DIFFERENT risk from an overnight gap, not a longer one. The market is
 * shut for 64+ hours, a stop cannot fill inside them, and the exposure is not
 * hedgeable in a retail account. A trader who crosses one rarely — deliberately
 * — is running a small, self-selected sample that is worth measuring against the
 * rest of the book. It cannot be measured while nothing marks it.
 *
 * Days are resolved in the ACCOUNT's timezone, like every other date in this
 * app: a Friday 23:00 New York close is Saturday in UTC, and a UTC reading would
 * report a weekend crossing that never happened.
 */
export function spansWeekend(
  openedAt: string | null | undefined,
  closedAt: string | null | undefined,
  timezone: string,
): boolean {
  if (!openedAt || !closedAt) return false;

  const open = zonedDateKey(openedAt, timezone);
  const close = zonedDateKey(closedAt, timezone);
  if (!open || !close || close < open) return false;

  // Walk the days the position was actually held. The window is days, not hours:
  // a position opened Friday and closed Monday crossed the weekend whether it
  // was held for 50 hours or for 80.
  //
  // Bounded rather than `while`: a corrupt far-future close date would otherwise
  // spin. Two years is far past any swing hold, and a trade that long has bigger
  // problems than this flag.
  let day = open;
  for (let i = 0; i < 730 && day <= close; i++) {
    const weekday = isoWeekdayOfDayKey(day);
    // 6 = Saturday, 7 = Sunday in ISO numbering — never `Date#getDay`'s 0=Sun.
    if (weekday === 6 || weekday === 7) return true;
    day = addDaysToDayKey(day, 1);
  }
  return false;
}
