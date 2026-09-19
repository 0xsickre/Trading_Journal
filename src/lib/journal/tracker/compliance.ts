/**
 * Daily compliance and the consistency streak.
 *
 * The whole module turns on one question: which rules APPLY to a given day.
 * Getting that wrong does not throw — it silently rewrites history. A rule
 * added today must not fail a year of past days, and a rule retired tomorrow
 * must not raise yesterday's score. Both are enforced by comparing the day
 * against the rule's `created_at` and `deleted_at`, which is why those are
 * timestamps and why this table has no `is_active` boolean.
 */

import { isoWeekdayOfDayKey, isTradingDayKey } from "../time";
import type { AutoRuleKey, AutoRuleResult } from "./auto-rules";
import type { TrackerCheckin, TrackerRule } from "../tracker-types";

export type DayStatus =
  /** Every applicable rule satisfied. */
  | "compliant"
  /** At least one applicable rule missed. */
  | "broken"
  /** No rule applied — a weekend, or before any rule existed. */
  | "skipped"
  /** Today, still open. Unanswered manual rules do not count against you yet. */
  | "pending";

export type DayCompliance = {
  date: string;
  /** Rules that produced a verdict. */
  applicable: number;
  satisfied: number;
  /** Null when nothing applied — no opinion, NOT zero. */
  pct: number | null;
  status: DayStatus;
  missedRuleIds: string[];
  /** Rules with no answer yet, on a day that is still open. */
  unansweredRuleIds: string[];
};

export type AutoResults = Partial<Record<AutoRuleKey, AutoRuleResult>>;

/** yyyy-MM-dd of a timestamp, for comparing a day against a rule's lifetime. */
const dayOf = (iso: string | null): string => (iso ? iso.slice(0, 10) : "");

/**
 * Whether the rule was LIVE on day D — the three conditions that do not depend
 * on any trade:
 *   1. the weekday is one the rule runs on
 *   2. the day is not before the rule existed
 *   3. the day is not after the rule was retired
 *
 * Separate from `ruleAppliesOn` because the checklist needs exactly this: an
 * auto rule with an `na` verdict is not scored, but it must still be SHOWN, or a
 * money rule with no limit set would silently vanish from the page instead of
 * saying why it cannot answer.
 */
export function ruleIsLiveOn(rule: TrackerRule, day: string): boolean {
  // Never at the weekend, whatever the rule's own days say: the market is
  // closed, so a Saturday is not a day that can be kept or broken. A rule
  // saved with Sat/Sun before this still scores Monday to Friday only.
  if (!isTradingDayKey(day)) return false;
  const dow = isoWeekdayOfDayKey(day);
  if (!rule.active_days.includes(dow)) return false;
  if (day < dayOf(rule.created_at)) return false;
  if (rule.deleted_at && day >= dayOf(rule.deleted_at)) return false;
  return true;
}

/**
 * The rules in force on day D.
 *
 * Every per-day computation must start here, and that includes reading a rule's
 * CONFIG, not only whether it is counted. `configsFromRules` keys by `auto_key`
 * and lets the last rule win, and the unique index on `auto_key` is partial —
 * it only covers live rules — so a retired rule and its replacement coexist
 * under one key. Ordered by `sort_order`, which the user can reorder freely,
 * the retired one can come last and hand a dead limit to every day the
 * evaluator scores, today included.
 */
export function rulesLiveOn(
  rules: readonly TrackerRule[],
  day: string,
): TrackerRule[] {
  return rules.filter((r) => ruleIsLiveOn(r, day));
}

/**
 * Whether rule R is applicable to day D — live, and for an auto rule also
 * actually answerable: condition 4 is that the evaluator reached a verdict.
 */
export function ruleAppliesOn(
  rule: TrackerRule,
  day: string,
  auto: AutoResults,
): boolean {
  if (!ruleIsLiveOn(rule, day)) return false;
  if (rule.auto_key) {
    const verdict = auto[rule.auto_key]?.verdict;
    // `na` drops out of BOTH numerator and denominator. That is what lets a
    // disciplined no-trade day still score 100 % on the rules it could answer.
    return verdict === "pass" || verdict === "fail";
  }
  return true;
}

/**
 * Overlay the verdicts frozen at lock time on top of the freshly computed ones.
 *
 * This is the second half of the hybrid the schema was built around, and without
 * it the lock is decoration. Auto verdicts are derived on read, so a locked day
 * would silently re-score itself the moment a trade from that day was corrected —
 * and correcting trades on a locked day is explicitly allowed, because P&L is a
 * fact that must stay fixable.
 *
 * A frozen row wins outright, including `checked: null`, which means "evaluated,
 * not applicable" and must keep the rule out of the denominator forever.
 *
 * Offenders are dropped rather than carried over from the live evaluation: the
 * stored row holds the verdict, not the trade list, and pairing a sealed verdict
 * with a list of trades as they look today would show a contradiction.
 */
export function resolveAutoResults(
  rules: readonly TrackerRule[],
  live: AutoResults,
  checkins: Map<string, TrackerCheckin>,
): AutoResults {
  let out: AutoResults | null = null;
  for (const rule of rules) {
    if (!rule.auto_key) continue;
    const row = checkins.get(rule.id);
    if (!row?.auto_evaluated) continue;
    out ??= { ...live };
    out[rule.auto_key] = {
      key: rule.auto_key,
      verdict: row.checked === true ? "pass" : row.checked === false ? "fail" : "na",
      reason: "frozen",
      offenders: [],
      observed: null,
    };
  }
  return out ?? live;
}

export function computeDayCompliance(
  date: string,
  rules: readonly TrackerRule[],
  checkins: Map<string, TrackerCheckin>,
  auto: AutoResults,
  today: string,
): DayCompliance {
  let applicable = 0;
  let satisfied = 0;
  const missedRuleIds: string[] = [];
  const unansweredRuleIds: string[] = [];

  for (const rule of rules) {
    if (!ruleAppliesOn(rule, date, auto)) continue;
    applicable++;

    if (rule.auto_key) {
      if (auto[rule.auto_key]?.verdict === "pass") satisfied++;
      else missedRuleIds.push(rule.id);
      continue;
    }

    const answer = checkins.get(rule.id);
    if (answer?.checked === true) satisfied++;
    else {
      // No row on a PAST day counts against you: the tracker measures whether
      // the thing was done, and an unanswered box is not a done thing.
      missedRuleIds.push(rule.id);
      if (answer == null) unansweredRuleIds.push(rule.id);
    }
  }

  const pct = applicable === 0 ? null : (satisfied / applicable) * 100;

  let status: DayStatus;
  if (pct == null) status = "skipped";
  else if (pct === 100) status = "compliant";
  else if (date === today && unansweredRuleIds.length > 0) {
    // Today is still running. Without this the streak reads 0 every morning,
    // which users would report as "it resets randomly". A day that is already
    // broken by an explicit `false` is broken even today.
    status = missedRuleIds.length === unansweredRuleIds.length ? "pending" : "broken";
  } else status = "broken";

  return { date, applicable, satisfied, pct, status, missedRuleIds, unansweredRuleIds };
}

/**
 * How far back a compliance series reaches: 28 weeks.
 *
 * ONE constant because the streak has to be one number. This used to live twice
 * — as `TRACKER_WEEKS = 28` on the dashboard page, which decides how many
 * check-ins are FETCHED, and as `TRACKER_SPAN_DAYS = 28 * 7` in the dashboard
 * component, which decides how many days are SCORED. Their comments pointed at
 * each other for safety, which is the tell: two numbers that must agree, kept in
 * step by prose. A third screen reading the same streak would have made three.
 *
 * 26 weeks is what the heatmap draws; the two extra weeks keep the leading
 * partial column populated once the grid pads out to a full week.
 */
export const TRACKER_SPAN_DAYS = 28 * 7;

export function computeComplianceSeries(
  days: readonly string[],
  rules: readonly TrackerRule[],
  checkinsByDate: Map<string, Map<string, TrackerCheckin>>,
  autoByDate: (day: string) => AutoResults,
  today: string,
): DayCompliance[] {
  return days
    // A future day has not happened; it is not a gap in the record.
    .filter((d) => d <= today)
    .map((d) =>
      computeDayCompliance(
        d,
        rules,
        checkinsByDate.get(d) ?? new Map(),
        autoByDate(d),
        today,
      ),
    );
}

export type StreakResult = {
  current: number;
  longest: number;
  lastBrokenOn: string | null;
};

/**
 * Consistency streak.
 *
 * `skipped` neither breaks nor extends. Breaking on a Saturday you deliberately
 * excluded would cap every weekday-only trader at 5; extending on it would let
 * the streak be inflated by narrowing `active_days` to Mondays.
 *
 * Locking a day changes nothing here — a locked day is scored exactly as it
 * stands, so nobody should read "locked" as "compliant".
 */
export function computeStreak(series: readonly DayCompliance[]): StreakResult {
  const ordered = [...series].sort((a, b) => a.date.localeCompare(b.date));

  let current = 0;
  for (let i = ordered.length - 1; i >= 0; i--) {
    const s = ordered[i].status;
    if (s === "skipped" || s === "pending") continue;
    if (s === "compliant") current++;
    else break;
  }

  let longest = 0;
  let run = 0;
  let lastBrokenOn: string | null = null;
  for (const day of ordered) {
    if (day.status === "skipped" || day.status === "pending") continue;
    if (day.status === "compliant") {
      run++;
      if (run > longest) longest = run;
    } else {
      run = 0;
      lastBrokenOn = day.date;
    }
  }

  return { current, longest: Math.max(longest, current), lastBrokenOn };
}

/** Compliance percentages by day, for the heatmap. Null days are omitted. */
export function complianceByDay(
  series: readonly DayCompliance[],
): Map<string, number> {
  const out = new Map<string, number>();
  for (const d of series) if (d.pct != null) out.set(d.date, d.pct);
  return out;
}

/**
 * Mean of daily percentages over the series.
 *
 * Mean of DAYS, not of pooled rule counts: a Monday with 12 active rules must
 * not outweigh a Wednesday with 3, because the unit of process is the day.
 */
export function meanCompliance(series: readonly DayCompliance[]): number | null {
  const vals = series.map((d) => d.pct).filter((p): p is number => p != null);
  if (vals.length === 0) return null;
  return vals.reduce((s, v) => s + v, 0) / vals.length;
}

/**
 * The rows to freeze when a day is locked.
 *
 * Emits one row per auto rule INCLUDING not-applicable ones, with
 * `checked: null`. Without the `na` rows, locking a Monday with no trades would
 * write nothing for those rules — and a later import backfilling a Monday trade
 * would resurrect them on a day that is supposed to be sealed.
 *
 * The day is a parameter so that "which rules apply" is answered HERE, by
 * `ruleIsLiveOn`, and nowhere else. It used to be answered twice: the caller
 * filtered by `ruleIsLiveOn(rule, day)` and this function then dropped anything
 * with a `deleted_at` at all. Those two agree on today and disagree on the past
 * — sealing a day from before a rule was retired left that rule applicable on
 * read (it was live that day) but unfrozen, so the one thing the lock exists to
 * prevent kept happening to it: the verdict re-derived itself whenever a trade
 * on that day was corrected.
 */
export function freezeAutoCheckins(
  rules: readonly TrackerRule[],
  auto: AutoResults,
  day: string,
): { rule_id: string; checked: boolean | null }[] {
  const out: { rule_id: string; checked: boolean | null }[] = [];
  for (const rule of rules) {
    if (!rule.auto_key) continue;
    if (!ruleIsLiveOn(rule, day)) continue;
    const verdict = auto[rule.auto_key]?.verdict;
    out.push({
      rule_id: rule.id,
      checked: verdict === "pass" ? true : verdict === "fail" ? false : null,
    });
  }
  return out;
}
