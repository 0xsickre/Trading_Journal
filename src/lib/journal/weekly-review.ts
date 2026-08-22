import { addDaysToDayKey, isoWeekdayOfDayKey } from "./time";

/**
 * Five stars, the unit the rest of the journal already judges in.
 *
 * THE OLD REASONING EXPIRED RATHER THAN BEING WRONG. This was six letters,
 * A..F, kept deliberately because "the trader has been reading this scale for
 * months" and re-basing would make old habits of judgement misfire. That held
 * while the letters were the only such scale. They no longer are: execution
 * rating and conviction are five stars, mental temperature became five stars,
 * and the week was the last place asking the same question in a different
 * alphabet — which is its own way of making judgement misfire.
 *
 * Six values became five, which is a narrowing, and it was only safe because no
 * week had ever been graded. With data present, "does D become 2 or 1" has no
 * honest answer.
 *
 * No exported list of the five. `WEEK_GRADES` was one, briefly, and nothing ever
 * read it: `StarRating` takes a count, not a set of values, and the range is
 * enforced by a zod check and a database CHECK. An array kept only so the scale
 * has something to point at is a second place for the scale to be wrong.
 *
 * PLAIN `number`, not the literal union `1|2|3|4|5`.
 *
 * The union looks stricter and buys nothing here: the value arrives from a
 * five-button component and passes a zod range check and a database CHECK
 * before it is ever stored. What it would cost is a narrowing cast at every
 * boundary. `mental_temp`, `execution_rating` and `conviction` are all typed
 * this way for the same reason.
 */
export type WeekGrade = number;

export type WeeklyReview = {
  id: string;
  user_id: string;
  /** Monday of the ISO week, `yyyy-MM-dd`. */
  week_start: string;
  week_grade: WeekGrade | null;
  went_well: string | null;
  went_badly: string | null;
  one_pattern: string | null;
  one_change: string | null;
  next_week_catalysts: string | null;
  /**
   * When the review was sealed. Null while it is still editable.
   *
   * Not part of `WeeklyReviewInput`, for the same reason `locked_at` is absent
   * from `DailyReportInput`: the lock is set by `lockWeek` and by nothing else.
   * Letting it through the form's type would put it in the save payload, where
   * saving the form would clear the seal.
   */
  locked_at: string | null;
  created_at: string;
  updated_at: string;
};

export type WeeklyReviewInput = Omit<
  WeeklyReview,
  "id" | "user_id" | "created_at" | "updated_at" | "locked_at"
>;

export function emptyWeeklyReview(weekStart: string): WeeklyReviewInput {
  return {
    week_start: weekStart,
    week_grade: null,
    went_well: null,
    went_badly: null,
    one_pattern: null,
    one_change: null,
    next_week_catalysts: null,
  };
}

/**
 * The Monday of the ISO week containing `dayKey`.
 *
 * Pure string arithmetic over a key that is ALREADY resolved to the account's
 * timezone — it must not resolve one again. `zonedWeekStartKey` in `time.ts` is
 * the other half of this pair and takes an instant; this one takes a day key,
 * and mixing them would re-apply the offset and shift the week by a day for
 * anyone whose account zone differs from UTC.
 *
 * Returns "" for an unparseable key, matching what `zonedWeekStartKey` does, so
 * a bad value shows up as an empty week rather than as a plausible wrong one.
 */
export function weekStartOfDayKey(dayKey: string): string {
  const dow = isoWeekdayOfDayKey(dayKey);
  if (dow === 0) return "";
  return addDaysToDayKey(dayKey, -(dow - 1));
}

/** Sunday of the week that starts on `weekStart`. */
export function weekEndOfWeekStart(weekStart: string): string {
  return addDaysToDayKey(weekStart, 6);
}

export function addWeeksToWeekStart(weekStart: string, delta: number): string {
  return addDaysToDayKey(weekStart, delta * 7);
}

/** The seven day keys of the week, Monday first. */
export function weekDayKeys(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDaysToDayKey(weekStart, i));
}

/**
 * Which week the page opens on.
 *
 * The most recent week there is anything to say about — which is NOT always the
 * current one:
 *
 *   Mon–Thu  → the PREVIOUS week. The current one is still running; grading it
 *              now would be grading it from open positions.
 *   Fri–Sun  → the CURRENT week. This book is intraweek and flat by Friday, so
 *              by Friday the week's trading has happened and the review has its
 *              facts.
 *
 * Friday is drawn in with the weekend rather than with the working days for a
 * reason worth stating: the alternative — waiting for Saturday — puts the
 * review a day after the last decision it is about, which is exactly when the
 * memory of that decision is worst.
 *
 * Either way the page navigates freely; this only decides where it lands.
 */
export function defaultWeekStart(todayKey: string): string {
  const thisWeek = weekStartOfDayKey(todayKey);
  if (!thisWeek) return "";
  const dow = isoWeekdayOfDayKey(todayKey);
  return dow >= 5 ? thisWeek : addWeeksToWeekStart(thisWeek, -1);
}

const MONTHS = [
  "jan", "feb", "mar", "apr", "maj", "jun",
  "jul", "avg", "sep", "okt", "nov", "dec",
];

/**
 * "5–11. jan 2026.", collapsing the parts both ends share.
 *
 * Formatted from the key's own digits rather than through a `Date`: these are
 * account-zone day keys, and `new Date("2026-01-05")` parses as UTC midnight,
 * which renders as the 4th for every reader west of Greenwich.
 */
export function formatWeekRange(weekStart: string): string {
  const end = weekEndOfWeekStart(weekStart);
  const [y1, m1, d1] = weekStart.split("-").map(Number);
  const [y2, m2, d2] = end.split("-").map(Number);
  if (!y1 || !y2) return weekStart;

  const from =
    y1 !== y2
      ? `${d1}. ${MONTHS[m1 - 1]} ${y1}.`
      : m1 !== m2
        ? `${d1}. ${MONTHS[m1 - 1]}`
        : `${d1}`;
  return `${from}–${d2}. ${MONTHS[m2 - 1]} ${y2}.`;
}

/**
 * Is the review finished?
 *
 * The grade plus the two singular questions — the pattern seen and the one
 * change. `went_well` / `went_badly` are the warm-up that makes those two
 * answerable, and `next_week_catalysts` is about a week this review is not
 * about; requiring either would be requiring prose for its own sake.
 */
export function isWeekComplete(
  review: Pick<WeeklyReview, "week_grade" | "one_pattern" | "one_change"> | null,
): boolean {
  if (!review) return false;
  return (
    review.week_grade != null &&
    (review.one_pattern ?? "").trim() !== "" &&
    (review.one_change ?? "").trim() !== ""
  );
}
