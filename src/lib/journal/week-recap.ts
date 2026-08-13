import type { EnrichedTrade } from "./enriched-trade";
import { isInterference, type PositionCheckin } from "./position-checkin";
import { weekDayKeys, weekEndOfWeekStart } from "./weekly-review";

/**
 * What actually happened in the week, counted.
 *
 * This exists because of the specific way weekly reviews fail. Asked "what went
 * well", a trader answers from memory, and memory after five days is a summary
 * of the last one — the recency trap the research names outright. Put the counts
 * on the screen and the question changes from "what do I remember" to "what do I
 * make of this".
 *
 * Everything here is COUNTED, never judged. There is no grade, no verdict, no
 * "you did badly on X": the grade is the trader's to give, and a panel that
 * pre-empted it would be answering the review's first question for them.
 */
export type WeekRecap = {
  /** Trades closed inside the week. */
  closed: number;
  net: number;
  wins: number;
  losses: number;
  /** Of those, the ones whose holding window crossed a Saturday or Sunday. */
  weekendHolds: number;
  /** Days of the week with a daily entry, out of seven. */
  journalledDays: number;
  /** Positions that got at least one check-in during the week. */
  checkedPositions: number;
  /** Of those, ones with a recorded intervention on any day of the week. */
  interferedPositions: number;
  /** Positions whose thesis was recorded as weakened or invalidated. */
  thesisSlippedPositions: number;
};

/**
 * Scoped by CLOSE day, matching the calendar cell and `dailyPnl`.
 *
 * A position opened in week 1 and closed in week 2 belongs to week 2's numbers,
 * because that is the week the money landed — and the two screens must never
 * print different figures for the same span. Its check-ins are a separate
 * question and are counted by their own date, so week 1 still gets credit for
 * the days it judged the position.
 */
export function buildWeekRecap(
  trades: readonly EnrichedTrade[],
  checkins: readonly PositionCheckin[],
  reportDates: ReadonlySet<string>,
  weekStart: string,
): WeekRecap {
  const weekEnd = weekEndOfWeekStart(weekStart);
  const inWeek = trades.filter(
    (t) => t.closeDay >= weekStart && t.closeDay <= weekEnd,
  );

  const checked = new Set<string>();
  const interfered = new Set<string>();
  const slipped = new Set<string>();
  for (const c of checkins) {
    if (c.report_date < weekStart || c.report_date > weekEnd) continue;
    checked.add(c.position_id);
    if (isInterference(c.touched)) interfered.add(c.position_id);
    if (c.thesis_state === "weakened" || c.thesis_state === "invalidated")
      slipped.add(c.position_id);
  }

  return {
    closed: inWeek.length,
    net: inWeek.reduce((s, t) => s + t.pnl, 0),
    wins: inWeek.filter((t) => t.outcome === "win").length,
    losses: inWeek.filter((t) => t.outcome === "loss").length,
    weekendHolds: inWeek.filter((t) => t.weekendHold).length,
    journalledDays: weekDayKeys(weekStart).filter((d) => reportDates.has(d))
      .length,
    checkedPositions: checked.size,
    interferedPositions: interfered.size,
    thesisSlippedPositions: slipped.size,
  };
}
