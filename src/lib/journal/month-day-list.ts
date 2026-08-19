import type { DailyReportListRow } from "./daily-report-queries";
import type { PeriodRow } from "./period-stats";
import { addDaysToDayKey, isValidMonthKey } from "./time";

/**
 * One day of the month, as the list shows it.
 *
 * Three sources side by side and none of them merged: the money (`row`), the
 * journal (`journal`) and the process (`compliancePct`). Each is independently
 * absent — a day can be traded and unwritten, written and untraded, or scored
 * by rules while neither — so each stays its own nullable field rather than
 * being flattened into one object with zeros standing in for the gaps.
 */
export type MonthDayEntry = {
  day: string;
  /** Trading on the day, `null` when nothing closed. */
  row: PeriodRow | null;
  /** The day's journal, `null` when none was written. */
  journal: DailyReportListRow | null;
  /** Rule compliance, `null` when no rule applied or none was answered. */
  compliancePct: number | null;
};

/**
 * Every day key inside a month, without the grid's padding from neighbours.
 *
 * Guarded with `isValidMonthKey`, not a shape regex. `/^\d{4}-\d{2}$/` accepts
 * "2026-13" — two digits is all it asks — and `Date.UTC(2026, 13, 0)` then rolls
 * happily into 2027 and returns a month of the wrong year's days. The validator
 * checks the month actually exists, which is the difference between a total
 * function and one that answers confidently in the wrong year.
 */
export function monthDays(monthKey: string): string[] {
  if (!isValidMonthKey(monthKey)) return [];
  const [y, m] = monthKey.split("-").map(Number);
  const lastDate = new Date(Date.UTC(y, m, 0));
  if (Number.isNaN(lastDate.getTime())) return [];

  const last = lastDate.toISOString().slice(0, 10);
  const out: string[] = [];
  for (let d = `${monthKey}-01`; d <= last; d = addDaysToDayKey(d, 1)) {
    out.push(d);
  }
  return out;
}

/**
 * The month as a list of days worth reading.
 *
 * A DAY WITH NEITHER A TRADE NOR A JOURNAL IS LEFT OUT, and that is the one
 * rule that makes this a list rather than a second calendar. A month has thirty
 * rows and a trader uses maybe twelve; keeping the empty ones would bury the
 * used ones under whitespace, and the grid already answers "which squares are
 * blank" far better than a list can.
 *
 * Compliance alone does NOT keep a day: rules score weekends and holidays too,
 * and a row saying only "0 % on a Sunday you never opened the platform" is
 * noise wearing a number.
 *
 * Newest first. The reader came to see what just happened, not to scroll a
 * month to reach it.
 */
export function buildMonthDayList(
  monthKey: string,
  byDay: ReadonlyMap<string, PeriodRow>,
  reports: readonly DailyReportListRow[],
  complianceByDay: ReadonlyMap<string, number | null>,
): MonthDayEntry[] {
  const byDate = new Map(reports.map((r) => [r.report_date, r]));

  return monthDays(monthKey)
    .map((day) => ({
      day,
      row: byDay.get(day) ?? null,
      journal: byDate.get(day) ?? null,
      compliancePct: complianceByDay.get(day) ?? null,
    }))
    .filter((e) => e.row != null || e.journal != null)
    .reverse();
}
