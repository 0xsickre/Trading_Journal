import { formatInTimeZone } from "date-fns-tz";
import { addDays, format, parseISO, subDays } from "date-fns";
import type { FocusGoal } from "./focus-goal";
import { isoWeekdayOfDayKey } from "./time";

// `DAY_GRADES`, `MICROMANAGE_*` and `MARKET_TYPE*` lived here. The grade moved
// to the weekly review (rating a day mid-hold reads the P&L), and "did I touch
// it" moved to the position — see `position-checkin.ts`, where it also gained
// the `added` state the day-level version could not express. Market type had no
// reader at all: nothing grouped, scored or surfaced it.

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
  macro_note: string | null;
  impulse_fomo: boolean;
  impulse_fear: boolean;
  impulse_greed: boolean;
  impulse_fear_wrong: boolean;
  impulse_note: string | null;
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

export function todayInTz(timezone: string): string {
  return formatInTimeZone(new Date(), timezone, "yyyy-MM-dd");
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
 * Petak, po ISO numeraciji (1 = ponedeljak … 5 = petak).
 *
 * Ranije `parseISO(date).getDay() === 5`. To JESTE bilo tačno — `parseISO` na
 * datum-string daje lokalnu ponoć, pa je i čitanje u lokalnom vremenu bilo
 * dosledno — ali je tražilo da čitalac to zna, i `time.ts` je oko toga nosio
 * upozorenje da se taj obrazac ne kopira. Sada nema šta da se ne kopira: isti
 * `isoWeekdayOfDayKey` koji koriste tracker pravila i dimenzija dana u nedelji.
 */
export function isFriday(date: string): boolean {
  return isoWeekdayOfDayKey(date) === 5;
}

/**
 * Is there anything left to answer for this day?
 *
 * This replaces `isReportComplete`, and the change of subject is the point. The
 * old question was "did you grade the day and say whether you broke a rule" —
 * both of which are now weekly, because a day mid-hold has no outcome to grade.
 * The daily question that remains is about POSITIONS: every one that was open
 * today should have been judged today.
 *
 * A day with no open positions is complete as soon as a focus goal exists.
 * There is nothing to answer, and inventing something to answer is exactly the
 * friction that gets journals abandoned.
 *
 * The focus goal still gates it: the day is measured against the goal, and with
 * no goal set there is nothing for "complete" to mean.
 */
export function isDayComplete(
  positions: { openCount: number; judgedCount: number },
  activeGoal: FocusGoal | null,
): boolean {
  if (!activeGoal) return false;
  return positions.judgedCount >= positions.openCount;
}

export function emptyDailyReport(reportDate: string): DailyReportInput {
  return {
    report_date: reportDate,
    mental_temp: null,
    macro_note: null,
    impulse_fomo: false,
    impulse_fear: false,
    impulse_greed: false,
    impulse_fear_wrong: false,
    impulse_note: null,
    no_trade_day: false,
  };
}
