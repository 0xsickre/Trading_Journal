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
  always: "Always",
  winner: "Winners only",
  loser: "Losers only",
  breakeven: "Breakeven only",
};

/**
 * Where a rule sits in the sequence of a trade.
 *
 * This replaces the per-playbook group. A group was a name owned by ONE
 * playbook, so "Entry" under OTE and "Entry" under Order Block were two
 * unrelated rows — and a rule could only ever belong to one of them. The
 * category belongs to the RULE, which is what lets the same rule be linked into
 * several playbooks and keep one id, and therefore one set of answers.
 *
 * Closed set, mirroring the DB CHECK, in the order a trade is actually thought
 * through. `no_trade` is the one with no predecessor in the old schema: nothing
 * could express "this is when I stand aside", which is the decision a playbook
 * most needs to make explicit.
 */
export const RULE_CATEGORIES = [
  "context",
  "entry",
  "management",
  "exit",
  "no_trade",
] as const;
export type RuleCategory = (typeof RULE_CATEGORIES)[number];

export const RULE_CATEGORY_LABELS: Record<RuleCategory, string> = {
  context: "Context",
  entry: "Entry",
  management: "Management",
  exit: "Exit",
  no_trade: "No-trade",
};

export const RULE_CATEGORY_HINTS: Record<RuleCategory, string> = {
  context: "The standing read, before you look for an entry.",
  entry: "What has to be true at the moment you take it.",
  management: "What you do — and do not do — while it runs.",
  exit: "How the position comes off.",
  no_trade: "When you stand aside. Answered false on a trade you took anyway.",
};

export type PlaybookRule = {
  id: string;
  category: RuleCategory;
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

export type Playbook = {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  icon: string | null;
  is_active: boolean;
  sort_order: number;
  /**
   * Suggested risk for this setup. Prefills the trade form only into an EMPTY
   * field — a deliberate 0.5 % on a marginal setup is never overwritten.
   */
  default_risk_pct: number | null;
  /** What earns an A+ grade here. Shown beside `setup_grade` on the form. */
  a_plus_criteria: string | null;
  /** The rules linked into this playbook, in link order within each category. */
  rules: PlaybookRule[];
};

/** Rules bucketed by category, in `RULE_CATEGORIES` order, empties dropped. */
export function rulesByCategory(
  rules: readonly PlaybookRule[],
): { category: RuleCategory; rules: PlaybookRule[] }[] {
  return RULE_CATEGORIES.map((category) => ({
    category,
    rules: rules.filter((r) => r.category === category),
  })).filter((g) => g.rules.length > 0);
}

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
