// Client-safe tracker types (no server-only imports), mirroring playbook-types.ts.

export const TRACKER_STAGES = ["prepare", "trade", "reflect"] as const;
export type TrackerStage = (typeof TRACKER_STAGES)[number];

export const STAGE_LABELS: Record<TrackerStage, string> = {
  prepare: "Prepare",
  trade: "Trade",
  reflect: "Review",
};

/**
 * Rules the tracker scores from data instead of asking about.
 *
 * The set is closed. Adding one means writing an evaluator, so a key with no
 * evaluator must never be storable.
 *
 * Phase X (X-1 B, 26.10.2026): the tracker measures process only. The money
 * rules — `max_loss_per_day`, `max_loss_per_trade`, `risk_per_trade`,
 * `risk_matched_intent`, `no_entry_after_daily_target` — left the code; the
 * trader keeps money limits on each account's own platform. Their
 * rows stay in the database RETIRED (`deleted_at`), and the DB CHECK still
 * admits their keys, because a locked day's frozen verdicts point at those
 * rows. A retired key has no evaluator, so an unlocked past day simply leaves
 * it out (no verdict = not applicable), and a locked day keeps what it froze.
 */
export const AUTO_RULE_KEYS = [
  "playbook_linked",
  "stop_loss_set",
  "thesis_written",
  // F4, the day trader's rules (G5): flat by the close. "No entry inside a red
  // window of the day's brief" (`no_entry_in_red_window`) left in phase X9
  // (X-10, 26.10.2026): the brief writes nothing into the journal any more; its
  // rows are retired like the money rules above.
  "flat_by_close",
  // 08.10.2026 (trader, with the mentor): two stop losses IN A ROW end the day.
  // Not a count of trades — a win or a scratch in between breaks the run.
  "stop_after_two_losses",
  // Phase Q (14.10.2026): the manual ticks that the trade page already answers,
  // per trade. Each reads what the trader wrote on the trade, never the chart —
  // whether the bias was on the chart before the entry is the recording's to say.
  "htf_bias_set",
  "thesis_recorded",
  "honest_tags",
  "review_complete",
  "screenshot_per_trade",
  // Phase Y4 (15.10.2026, reversing Q-2's "retired"): every entry and exit inside
  // the day's trading window, Belgrade time, the window kept per week shift.
  "trading_window",
  // Phase B5 (26.10.2026): the day's feeling, written once on /daily.
  "daily_psychology",
] as const;
export type AutoRuleKey = (typeof AUTO_RULE_KEYS)[number];

/** ISO weekday numbering, 1=Mon … 7=Sun — never `Date#getDay`'s 0=Sun. */
export const ISO_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

export const WEEKDAY_LABELS: Record<number, string> = {
  1: "Mon",
  2: "Tue",
  3: "Wed",
  4: "Thu",
  5: "Fri",
  6: "Sat",
  7: "Sun",
};

export type TrackerRule = {
  id: string;
  text: string;
  stage: TrackerStage;
  /** ISO weekday numbers the rule applies on. */
  active_days: number[];
  /** NULL for a manual rule. */
  auto_key: AutoRuleKey | null;
  /** No rule reads a setting since the count rules left (30.09.2026); always `{}`. */
  config: Record<string, unknown>;
  is_mandatory: boolean;
  sort_order: number;
  /**
   * Both timestamps are load-bearing for compliance, not bookkeeping: a rule is
   * only applicable to days between them. That is what stops a rule added today
   * from failing a year of history, and a rule retired tomorrow from raising
   * yesterday's score.
   */
  created_at: string;
  deleted_at: string | null;
};

export type TrackerCheckin = {
  rule_id: string;
  report_date: string;
  /** `null` = evaluated, not applicable. Only legal on a frozen auto row. */
  checked: boolean | null;
  auto_evaluated: boolean;
};

/** A locked day's process journal is sealed; its trades are not. */
export function canEditDay(
  report: { locked_at?: string | null } | null | undefined,
): boolean {
  return report?.locked_at == null;
}
