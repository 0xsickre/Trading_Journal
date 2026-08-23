// Client-safe playbook types (no server-only imports).

/**
 * When a checklist offers a rule.
 *
 * Not cosmetic. A `winner` rule is a review question — "did you let it run?" —
 * that is meaningless on a loss, and its follow rate is measured against winning
 * trades only. Because the denominator depends on this value, it is frozen once
 * the rule has been answered even once; see the DB trigger in
 * 20260729130000_playbook.sql.
 *
 * Stays on the RULE rather than on the link, unlike the section and the setup
 * criterion. Answers are recorded against `rule_id`, so a per-playbook
 * `show_when` would give one set of answers two different denominators.
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
 * A heading inside ONE playbook.
 *
 * It used to be a row in a single `rule_category` option list shared by the
 * whole account, and all three complaints about playbooks came out of that: a
 * new playbook drew every section the account had, empty or not; a section
 * could not be deleted because some rule in ANOTHER book sat under the same
 * name; and one rule was in the same section everywhere.
 *
 * A section belongs to a playbook now, so a book has exactly the headings its
 * owner gave it. Identity is the `id`, not the text, which is what makes
 * renaming free — nothing points at the label.
 */
export type PlaybookSection = {
  id: string;
  label: string;
  /** The line beside the heading. Written by the trader, or absent. */
  description: string | null;
  sort_order: number;
};

/**
 * A rule as it exists in the LIBRARY: one row, one id, one set of answers.
 *
 * Knows nothing about any section. That is deliberate — the library is the
 * trader's whole vocabulary of rules, and where a rule is filed is a fact about
 * a playbook using it, not about the rule.
 */
export type PlaybookRule = {
  id: string;
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

/**
 * A rule as ONE playbook uses it: the library row plus everything the link says.
 *
 * The three link-owned fields are the whole point of the split. `section_id`
 * lets the same rule sit under "Entry" in one book and "Exit" in another;
 * `is_setup_criterion` lets it grade the setup in a swing book and count as
 * plain process in a scalp one — which is what `criteriaByPlaybook` in
 * `reports/rule-lookup.ts` was already computing per playbook, from a flag that
 * could not vary; and `link_sort` orders it within this book only.
 */
export type LinkedRule = PlaybookRule & {
  link_id: string;
  section_id: string;
  is_setup_criterion: boolean;
  link_sort: number;
};

/** Header metrics per playbook — the TradeZella set, computed by our engine. */
export const HEADER_METRICS = [
  "trade_count",
  "win_rate",
  "expectancy",
  "profit_factor",
  "avg_r",
  "follow_rate",
] as const;

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
  /** What earns an A+ grade here. Shown beside the grade on the checklist. */
  a_plus_criteria: string | null;
  /** This book's own headings, in the trader's order. Empty on a new playbook. */
  sections: PlaybookSection[];
  /** The rules linked into this playbook, in link order. */
  rules: LinkedRule[];
};

/**
 * Rules bucketed by this playbook's own sections, in the trader's order.
 *
 * EMPTIES ARE KEPT, which is the opposite of what the old `rulesByCategory`
 * did. It dropped them because the section list was shared: an account with
 * five headings drew five cards on a playbook that used one, four of them a
 * heading over nothing. A section exists now only because someone created it
 * IN THIS BOOK, so an empty one is a prompt to write the rule that is missing.
 *
 * A rule whose `section_id` matches no section is appended under its own
 * bucket rather than dropped — that state is unreachable through the UI (the
 * FK cascades), but silently losing a rule is the wrong way to find out
 * otherwise.
 */
export function rulesBySection(
  sections: readonly PlaybookSection[],
  rules: readonly LinkedRule[],
): { section: PlaybookSection; rules: LinkedRule[] }[] {
  const out = [...sections]
    .sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label))
    .map((section) => ({
      section,
      rules: rules.filter((r) => r.section_id === section.id),
    }));

  const known = new Set(sections.map((s) => s.id));
  const orphans = rules.filter((r) => !known.has(r.section_id));
  if (orphans.length > 0) {
    out.push({
      section: {
        id: orphans[0]!.section_id,
        label: "Unfiled",
        description: null,
        sort_order: Number.MAX_SAFE_INTEGER,
      },
      rules: orphans,
    });
  }
  return out;
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
