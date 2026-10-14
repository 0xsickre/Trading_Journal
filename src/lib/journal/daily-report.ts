import { addDays, format, parseISO, subDays } from "date-fns";
import { DEFAULT_TZ, fmtInTz, isoWeekdayOfDayKey, toEpoch } from "./time";

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
  /**
   * When the mental rating was set or last changed — written by a trigger only
   * (phase Y, `20261014200000`), so the form never sends it. Null without a rating.
   */
  mental_temp_at: string | null;
  created_at: string;
  updated_at: string;
};

export type DailyReportInput = Omit<
  DailyReport,
  "id" | "user_id" | "created_at" | "updated_at" | "locked_at" | "mental_temp_at"
>;

/**
 * The pre-session gate written after the day's first entry (phase Y, Y-3 = A):
 * "upisano 14.10. 11:15, posle prvog ulaza (09:24)", in Belgrade time. Null when
 * it came first, when the day has no entry, or when either time is unknown — a
 * mark, never a verdict; the tracker does not read it.
 */
export function gateLateText(
  mentalTempAt: string | null | undefined,
  firstEntryAt: string | null | undefined,
  tz: string = DEFAULT_TZ,
): string | null {
  if (!mentalTempAt || !firstEntryAt) return null;
  const at = toEpoch(mentalTempAt);
  const entry = toEpoch(firstEntryAt);
  if (!Number.isFinite(at) || !Number.isFinite(entry) || at <= entry) return null;
  return `upisano ${fmtInTz(mentalTempAt, tz, "dd.MM. HH:mm")}, posle prvog ulaza (${fmtInTz(firstEntryAt, tz, "HH:mm")})`;
}

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
