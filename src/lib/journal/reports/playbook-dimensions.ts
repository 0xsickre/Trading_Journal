/**
 * Playbook dimensions and the follow-rate metric.
 *
 * This is where "which rule actually carries the edge" gets answered, and it is
 * deliberately **two registry entries plus one metric** rather than a separate
 * screen. The Phase 3 engine already groups, filters, pivots, sorts and flags
 * thin samples; a per-rule report is just a different `GROUP BY`, so building it
 * as its own page would be reimplementing all of that to display the same
 * numbers.
 *
 * The grouping is per-rule, so one trade appears in a row for every rule it was
 * asked about. That makes both dimensions multi-value, and the rows do not sum
 * to the portfolio total — the table has to say so, which it does via
 * `Dimension.multiValue`.
 */

import { EMPTY_BUCKET, type Dimension } from "./dimensions";
import { ruleAppliesTo, type PositionRule, type ShowWhen } from "../playbook-types";
import { stringFieldValue } from "../field-values";
import type { EnrichedTrade } from "../enriched-trade";

export type RuleLookup = {
  /** Rule id → display text, including retired rules. */
  text: Map<string, string>;
  /** Rule id → when it applies, so stats and form agree on the population. */
  showWhen: Map<string, ShowWhen>;
  /** Trade id → recorded answers. */
  answersByTrade: Map<string, PositionRule[]>;
};

export type PlaybookLookup = {
  /** Playbook id → name. */
  names: Map<string, string>;
  rules: RuleLookup;
};

/**
 * Answers that count for a trade.
 *
 * A rule whose `show_when` does not match the outcome is excluded even if an
 * answer exists — the outcome may have changed after the checklist was filled
 * in, and counting a winner-only rule against a trade that ended red would put
 * an observation in a population it was never asked about.
 */
export function applicableAnswers(
  t: EnrichedTrade,
  rules: RuleLookup,
): PositionRule[] {
  const answers = rules.answersByTrade.get(t.id) ?? [];
  return answers.filter((a) => {
    const when = rules.showWhen.get(a.rule_id);
    return when == null || ruleAppliesTo(when, t.outcome);
  });
}

/**
 * Group by individual playbook rule.
 *
 * Only rules with an ANSWER put the trade in a bucket. An unanswered rule is
 * missing information, not a violation, and bucketing it would manufacture a
 * discipline problem out of a half-filled form.
 */
export function playbookRuleDimension(rules: RuleLookup): Dimension {
  return {
    key: "playbook_rule",
    label: "Playbook rule",
    group: "process",
    multiValue: true,
    valueOf: (t) => {
      const applicable = applicableAnswers(t, rules)
        .filter((a) => a.followed != null)
        .map((a) => rules.text.get(a.rule_id) ?? a.rule_id);
      return applicable.length > 0 ? applicable : null;
    },
  };
}

/** Group by playbook, resolving the id to its name. */
export function playbookDimension(names: Map<string, string>): Dimension {
  return {
    key: "playbook",
    label: "Playbook",
    group: "trade",
    valueOf: (t) => {
      const id = stringFieldValue(t.trade.row, "playbook_id");
      if (!id) return EMPTY_BUCKET;
      return names.get(id) ?? EMPTY_BUCKET;
    },
  };
}

/** Conviction rating recorded at entry, 1–5. */
export const convictionDimension: Dimension = {
  key: "conviction",
  label: "Uverenost (1–5)",
  group: "trade",
  order: ["1", "2", "3", "4", "5"],
  valueOf: (t) => {
    const v = t.trade.row.conviction;
    return typeof v === "number" && v >= 1 && v <= 5 ? String(v) : null;
  },
};

/**
 * Share of applicable answers that were "followed".
 *
 * Counted over ANSWERS, not over trades. Unanswered rules are absent from the
 * numerator and the denominator alike — this measures adherence, not diligence
 * in filling in the form.
 *
 * `scope` is what makes the number mean what the row says it means. On a
 * per-rule report the row IS a rule, so only answers to that rule may count;
 * without this the row for "wait for the sweep" would silently mix in every
 * other rule the same trades happened to answer, and read as a statement about
 * one rule while describing several. When no bucket in `scope` names a rule —
 * grouping by setup grade, say — no filter applies and the number reads as
 * "how disciplined was I on these trades overall", which is the right answer
 * for that question.
 */
export function computeFollowRate(
  group: EnrichedTrade[],
  rules: RuleLookup,
  scope?: readonly string[],
): number | null {
  const scoped = scope?.filter((b) => ruleIdsByText(rules).has(b)) ?? [];
  const wanted =
    scoped.length > 0
      ? new Set(scoped.flatMap((b) => [...(ruleIdsByText(rules).get(b) ?? [])]))
      : null;

  let followed = 0;
  let total = 0;
  for (const t of group) {
    for (const a of applicableAnswers(t, rules)) {
      if (a.followed == null) continue;
      if (wanted && !wanted.has(a.rule_id)) continue;
      total++;
      if (a.followed) followed++;
    }
  }
  return total === 0 ? null : (followed / total) * 100;
}

/**
 * Rule text → the ids carrying it.
 *
 * A set, not a single id: two rules can share wording (an edited rule kept
 * alongside its retired original), and they share a bucket, so they must share
 * the bucket\'s statistics too. Cached per lookup — this is called once per
 * metric per row.
 */
const textIndexCache = new WeakMap<RuleLookup, Map<string, Set<string>>>();

function ruleIdsByText(rules: RuleLookup): Map<string, Set<string>> {
  const hit = textIndexCache.get(rules);
  if (hit) return hit;
  const index = new Map<string, Set<string>>();
  for (const [id, text] of rules.text) {
    const bucket = index.get(text) ?? new Set<string>();
    bucket.add(id);
    index.set(text, bucket);
  }
  textIndexCache.set(rules, index);
  return index;
}

/**
 * Build the lookup from loaded playbooks and recorded answers.
 *
 * Rule text is indexed across ALL rules, retired ones included: a retired rule's
 * historical answers are real observations, and losing its name would turn them
 * into rows labelled by a uuid.
 *
 * Lives here rather than in the reports screen because the dashboard needs the
 * same lookup for the follow rate that feeds Process Adherence, and two copies
 * of this walk would be two places for the retired-rule rule to be forgotten.
 */
export function buildPlaybookLookup(
  playbooks: readonly {
    id: string;
    name: string;
    groups: readonly {
      rules: readonly { id: string; text: string; show_when: ShowWhen }[];
    }[];
  }[],
  answersByTrade?: Map<string, PositionRule[]>,
): PlaybookLookup {
  const text = new Map<string, string>();
  const showWhen = new Map<string, ShowWhen>();
  for (const book of playbooks) {
    for (const group of book.groups) {
      for (const rule of group.rules) {
        text.set(rule.id, rule.text);
        showWhen.set(rule.id, rule.show_when);
      }
    }
  }
  return {
    names: new Map(playbooks.map((p) => [p.id, p.name])),
    rules: { text, showWhen, answersByTrade: answersByTrade ?? new Map() },
  };
}

/** Every playbook-derived dimension, for the registry. */
export function playbookDimensions(lookup: PlaybookLookup): Dimension[] {
  return [
    playbookDimension(lookup.names),
    convictionDimension,
    playbookRuleDimension(lookup.rules),
  ];
}
