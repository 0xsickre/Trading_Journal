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
/**
 * The five sections this journal ships with.
 *
 * NOT A CLOSED SET ANY MORE. They are the seed of the user's `rule_category`
 * option list — renameable, reorderable, archivable in Settings like every other
 * list here. Kept in code only as the fallback for a caller that has no options
 * loaded, and as the keys the hints below are written against.
 *
 * The old `CHECK` on the column is gone (20260822140000): a trader whose method
 * is "conditions to get in, conditions to get out, and one risk rule" was given
 * three headings they wrote and two they did not, empty on every playbook.
 */
export const DEFAULT_RULE_CATEGORIES = [
  "context",
  "entry",
  "management",
  "exit",
  "no_trade",
] as const;

/** A section key. Free text, because the trader owns the list. */
export type RuleCategory = string;

export const RULE_CATEGORY_LABELS: Record<string, string> = {
  context: "Context",
  entry: "Entry",
  management: "Management",
  exit: "Exit",
  no_trade: "No-trade",
};

/**
 * Guidance under each default heading.
 *
 * Only the seeded five have one, and a custom section shows none — a sentence
 * explaining what "Risk" means to a trader who just named it "Risk" would be
 * this repo telling them about their own method.
 */
export const RULE_CATEGORY_HINTS: Record<string, string> = {
  context: "The standing read, before you look for an entry.",
  entry: "What has to be true at the moment you take it.",
  management: "What you do — and do not do — while it runs.",
  exit: "How the position comes off.",
  no_trade: "When you stand aside. Answered false on a trade you took anyway.",
};

/** Label for a section key: the user's own if they set one, else the seeded name, else the key. */
export function ruleCategoryLabel(
  category: string,
  options?: readonly { value: string; label: string }[],
): string {
  const own = options?.find((o) => o.value === category);
  return own?.label ?? RULE_CATEGORY_LABELS[category] ?? category;
}

export type PlaybookRule = {
  id: string;
  category: RuleCategory;
  text: string;
  show_when: ShowWhen;
  /**
   * Does this rule define SETUP QUALITY, as opposed to process?
   *
   * The derived setup grade is the share of these that were met. Constrained by
   * the database to `show_when = 'always'` — see 20260822110000.
   */
  is_setup_criterion: boolean;
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

/**
 * Rules bucketed by section, in the order the user's list gives, empties dropped.
 *
 * A category with rules but NOT in the list is appended rather than dropped.
 * That is the case archiving creates: switch off "No-trade" in Settings and the
 * heading should stop being offered, but the rules already filed under it must
 * still be visible. Hiding them because a heading was retired would be data
 * loss dressed as tidying.
 */
export function rulesByCategory(
  rules: readonly PlaybookRule[],
  categories: readonly string[] = DEFAULT_RULE_CATEGORIES,
): { category: RuleCategory; rules: PlaybookRule[] }[] {
  const ordered = [...categories];
  for (const r of rules) {
    if (!ordered.includes(r.category)) ordered.push(r.category);
  }
  return ordered
    .map((category) => ({
      category,
      rules: rules.filter((r) => r.category === category),
    }))
    .filter((g) => g.rules.length > 0);
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
