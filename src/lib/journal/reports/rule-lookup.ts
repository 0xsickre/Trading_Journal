/**
 * The rule lookup: what a rule is, and what was answered about it.
 *
 * ITS OWN MODULE, UPSTREAM OF EVERYTHING. `playbook-dimensions.ts` imports
 * `EMPTY_BUCKET` from `dimensions.ts`, so anything `dimensions.ts` needs cannot
 * live there without closing a cycle — and `setup-score.ts`, which
 * `dimensions.ts` now calls, needs exactly this. TypeScript tolerates the
 * cycle; ESM initialisation order does not always, and one that works today
 * breaks on the day a bundler reorders the modules. Same reasoning
 * `rule-scorecard.ts` was moved out for, applied one level further up.
 *
 * Nothing here imports a dimension, a metric or a bucket. It depends only on
 * the rule types and the enriched trade, so the graph stays a tree.
 */

import { ruleAppliesTo, type PositionRule, type ShowWhen } from "../playbook-types";
/**
 * Win / loss / breakeven, as `enrichTrades` classifies it — or `null`.
 *
 * Null is a real answer, not a missing one: a trade that is still planned or
 * open has no outcome yet, and `ruleAppliesTo` already treats it that way. It
 * matters here because a setup criterion is graded BEFORE the trade resolves,
 * and criteria are pinned to `show_when = 'always'`, which applies whatever the
 * outcome is — including none.
 */
export type TradeOutcome = "win" | "loss" | "breakeven" | null;

export type RuleLookup = {
  /** Rule id → display text, including retired rules. */
  text: Map<string, string>;
  /** Rule id → when it applies, so stats and form agree on the population. */
  showWhen: Map<string, ShowWhen>;
  /** Trade id → recorded answers. */
  answersByTrade: Map<string, PositionRule[]>;
  /**
   * Playbook id → the ids of ITS rules that define setup quality.
   *
   * Keyed by playbook rather than a flat set, and that is a correctness
   * requirement rather than convenience: an unanswered rule is stored as NO ROW,
   * so a grade computed from the answers alone would silently score three of
   * four criteria as three of three. Knowing what SHOULD have been asked is the
   * only way to notice the missing one.
   */
  criteriaByPlaybook: Map<string, string[]>;
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
  // The two fields it reads, rather than a whole EnrichedTrade. A caller that
  // holds a raw row and an outcome — the journal grid does — can ask the same
  // question without assembling a trade it does not have.
  t: { id: string; outcome: TradeOutcome },
  rules: RuleLookup,
): PositionRule[] {
  const answers = rules.answersByTrade.get(t.id) ?? [];
  return answers.filter((a) => {
    const when = rules.showWhen.get(a.rule_id);
    return when == null || ruleAppliesTo(when, t.outcome);
  });
}

/**
 * Build the lookup from loaded playbooks and recorded answers.
 *
 * Rule text is indexed across ALL rules, retired ones included: a retired rule's
 * historical answers are real observations, and losing its name would turn them
 * into rows labelled by a uuid. Pass the library, not just the linked rules,
 * when the caller has it — a rule unlinked from every playbook still names its
 * own history.
 *
 * Lives here rather than in the reports screen because the dashboard needs the
 * same lookup for the follow rate that feeds Process Adherence, and two copies
 * of this walk would be two places for the retired-rule rule to be forgotten.
 */
export function buildPlaybookLookup(
  playbooks: readonly {
    id: string;
    name: string;
    rules: readonly {
      id: string;
      text: string;
      show_when: ShowWhen;
      is_setup_criterion?: boolean;
    }[];
  }[],
  answersByTrade?: Map<string, PositionRule[]>,
): PlaybookLookup {
  const text = new Map<string, string>();
  const showWhen = new Map<string, ShowWhen>();
  const criteriaByPlaybook = new Map<string, string[]>();
  // One pass over links, and a rule shared by two playbooks is simply seen
  // twice with the same id — which is the point of the library. Before, the
  // same wording under two books carried two ids and its statistics split.
  for (const book of playbooks) {
    for (const rule of book.rules) {
      text.set(rule.id, rule.text);
      showWhen.set(rule.id, rule.show_when);
      if (rule.is_setup_criterion) {
        const list = criteriaByPlaybook.get(book.id) ?? [];
        if (!list.includes(rule.id)) list.push(rule.id);
        criteriaByPlaybook.set(book.id, list);
      }
    }
  }
  return {
    names: new Map(playbooks.map((p) => [p.id, p.name])),
    rules: {
      text,
      showWhen,
      criteriaByPlaybook,
      answersByTrade: answersByTrade ?? new Map(),
    },
  };
}
