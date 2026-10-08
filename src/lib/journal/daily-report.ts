import { addDays, format, parseISO, subDays } from "date-fns";
import type { FocusGoal } from "./focus-goal";
import { isoWeekdayOfDayKey } from "./time";

// `DAY_GRADES`, `MICROMANAGE_*` and `MARKET_TYPE*` lived here. The grade moved
// to the weekly review (rating a day mid-hold reads the P&L), which in turn
// left the journal in phase M, and "did I touch
// it" moved to a per-position check-in, which left with the swing book (H1) — a
// day trader is flat by the close. Market type had no reader at all: nothing
// grouped, scored or surfaced it.

export type DailyReport = {
  id: string;
  user_id: string;
  report_date: string;
  mental_temp: number | null;
  /**
   * What is on the calendar between now and the planned exit.
   *
   * Re-asked rather than renamed: the column used to mean "macro events today",
   * which is the day trader's window. A position held to Thursday is exposed to
   * Thursday's release whether or not it lands today.
   */
  no_trade_day: boolean;
  /**
   * When the day's process journal was sealed. Null while it is still editable.
   *
   * Not part of `DailyReportInput`: the lock is set by `tj_lock_day` and by
   * nothing else. Letting it through the form's input type would put it in
   * `emptyDailyReport` and in the save payload, where the zod schema would reject
   * it — and if it ever got through, saving the form would clear the seal.
   */
  locked_at: string | null;
  created_at: string;
  updated_at: string;
};

export type DailyReportInput = Omit<
  DailyReport,
  "id" | "user_id" | "created_at" | "updated_at" | "locked_at"
>;

function formatDate(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

export function prevReportDate(date: string): string {
  return formatDate(subDays(parseISO(date), 1));
}

export function nextReportDate(date: string): string {
  return formatDate(addDays(parseISO(date), 1));
}

/**
 * Friday, in ISO numbering (1 = Monday … 5 = Friday).
 *
 * This used to be `parseISO(date).getDay() === 5`. That WAS correct —
 * `parseISO` on a date string gives local midnight, so reading it in local time
 * was consistent — but it required the reader to know that, and `time.ts`
 * carried a warning around it not to copy the pattern. Now there is nothing not
 * to copy: the same `isoWeekdayOfDayKey` the tracker rules and the weekday
 * dimension use.
 */
export function isFriday(date: string): boolean {
  return isoWeekdayOfDayKey(date) === 5;
}

/**
 * Is there anything left to answer for this day?
 *
 * The grade and "did you break a rule" are weekly now, and the per-position
 * check-in went with the swing book (H1, 28.09.2026): a day trader is flat by
 * the close, so no position is left to judge. What remains is the focus goal —
 * the day is measured against it, and with no goal set there is nothing for
 * "complete" to mean. Inventing something else to answer is exactly the
 * friction that gets journals abandoned.
 */
export function isDayComplete(activeGoal: FocusGoal | null): boolean {
  return activeGoal != null;
}

export function emptyDailyReport(reportDate: string): DailyReportInput {
  return {
    report_date: reportDate,
    mental_temp: null,
    no_trade_day: false,
  };
}
