// Client-safe playbook types (no server-only imports).

/**
 * When a checklist offers a rule.
 *
 * Not cosmetic. A `winner` rule is a review question — "did you let it run?" —
 * that is meaningless on a loss, and its follow rate is measured against winning
 * trades only. Because the denominator depends on this value, it is frozen once
 * the rule has been answered even once; see the DB trigger in
 * 20260729130000_playbook.sql.
 */
export const SHOW_WHEN_VALUES = ["always", "winner", "loser", "breakeven"] as const;

export type ShowWhen = (typeof SHOW_WHEN_VALUES)[number];

export const SHOW_WHEN_LABELS: Record<ShowWhen, string> = {
  always: "Uvek",
  winner: "Samo kod dobitka",
  loser: "Samo kod gubitka",
  breakeven: "Samo kod breakeven-a",
};

export type PlaybookRule = {
  id: string;
  group_id: string;
  text: string;
  show_when: ShowWhen;
  sort_order: number;
  /** Set when the rule was retired. Never shown on a form, always kept in stats. */
  deleted_at: string | null;
  /**
   * How many trades have an answer recorded for this rule. Non-zero means
   * `show_when` is locked and deletion must stay soft.
   */
  answerCount: number;
};

export type PlaybookGroup = {
  id: string;
  playbook_id: string;
  name: string;
  sort_order: number;
  rules: PlaybookRule[];
};

export type Playbook = {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  icon: string | null;
  is_active: boolean;
  sort_order: number;
  groups: PlaybookGroup[];
};

/** One trade's answer for one rule. `followed: null` means "not answered". */
export type PositionRule = {
  position_id: string;
  rule_id: string;
  followed: boolean | null;
};

/**
 * Whether a rule applies to a trade with this outcome.
 *
 * The same predicate decides what the FORM offers and what the STATISTICS count,
 * which is the point: if they could disagree, a rule's follow rate would be
 * measured against a population the trader was never asked about.
 */
export function ruleAppliesTo(
  showWhen: ShowWhen,
  outcome: "win" | "loss" | "breakeven" | null,
): boolean {
  if (showWhen === "always") return true;
  if (outcome == null) return false;
  if (showWhen === "winner") return outcome === "win";
  if (showWhen === "loser") return outcome === "loss";
  return outcome === "breakeven";
}
