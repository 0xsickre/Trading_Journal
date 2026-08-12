// Client-safe tracker types (no server-only imports), mirroring playbook-types.ts.

export const TRACKER_STAGES = ["prepare", "trade", "reflect"] as const;
export type TrackerStage = (typeof TRACKER_STAGES)[number];

export const STAGE_LABELS: Record<TrackerStage, string> = {
  prepare: "Priprema",
  trade: "Trgovanje",
  reflect: "Osvrt",
};

/**
 * Rules the tracker scores from data instead of asking about.
 *
 * The set is closed and mirrors the DB CHECK. Adding one means writing an
 * evaluator, so a key with no evaluator must never be storable.
 */
export const AUTO_RULE_KEYS = [
  "max_loss_per_trade",
  "max_loss_per_day",
  "playbook_linked",
  "stop_loss_set",
] as const;
export type AutoRuleKey = (typeof AUTO_RULE_KEYS)[number];

/** Auto rules that need a money limit before they can say anything. */
export const AUTO_RULES_NEEDING_AMOUNT: ReadonlySet<AutoRuleKey> = new Set([
  "max_loss_per_trade",
  "max_loss_per_day",
]);

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
  config: { amount?: number };
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
