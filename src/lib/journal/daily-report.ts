import { addDays, format, parseISO, subDays } from "date-fns";
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
   * "Danas ne trgujem" — decided before the session. Compliance reads it: on
   * such a day the trade-stage MANUAL rules have nothing to judge
   * (`computeDayCompliance`, phase M).
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

export function emptyDailyReport(reportDate: string): DailyReportInput {
  return {
    report_date: reportDate,
    mental_temp: null,
    no_trade_day: false,
  };
}
