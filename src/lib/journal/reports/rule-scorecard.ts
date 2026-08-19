/**
 * Per-rule scorecard: does a rule carry anything, or is it a ritual?
 *
 * Its own module rather than a function inside `playbook-dimensions.ts`, and
 * the reason is structural: `metrics.ts` already imports `computeFollowRate`
 * from there, so reaching back for `getMetric` would close an import cycle.
 * TypeScript tolerates that; ESM initialisation order does not always, and a
 * cycle that works today breaks on the day a bundler reorders the modules. This
 * file sits DOWNSTREAM of both and the graph stays a tree.
 */

import { applicableAnswers, ruleSampleTier, RULE_SAMPLE } from "./playbook-dimensions";
import type { RuleLookup, RuleSampleTier } from "./playbook-dimensions";
import { getMetric, type MetricContext } from "./metrics";
import type { EnrichedTrade } from "../enriched-trade";

export type RuleSide = {
  n: number;
  winRate: number | null;
  expectancy: number | null;
};

export type RuleScore = {
  ruleId: string;
  text: string;
  /** Trades with an applicable, answered observation for this rule. */
  n: number;
  followed: RuleSide;
  broken: RuleSide;
  /**
   * Win rate followed minus win rate broken, in percentage points.
   *
   * Null unless EACH SIDE on its own clears `RULE_SAMPLE.MIN` — not the total.
   * The difference is a comparison of two proportions and cannot be sounder
   * than the weaker one, so a lopsided rule (many kept, twice broken) has no
   * gap to report however tempting the arithmetic looks.
   *
   * A rule you have never broken has no contrast either — that is an honest
   * absence, not a gap of zero, and printing zero would read as "this rule does
   * nothing".
   */
  gapPp: number | null;
  tier: RuleSampleTier;
};

/**
 * Per-rule scorecard.
 *
 * Metrics are NOT computed here. `getMetric("win_rate")` and `expectancy` are
 * the same entries `/reports` renders, so a number on the playbook page and the
 * same number in a report cannot drift — there is one implementation and this
 * calls it.
 *
 * Returns rules in the order `ruleIds` gives them and never sorts by result.
 * Sorting a rule list by win rate is the act that turns a journal into an
 * overfitting machine, so the function simply does not offer it.
 */
export function ruleScorecard(
  trades: readonly EnrichedTrade[],
  rules: RuleLookup,
  ctx: MetricContext,
  ruleIds: readonly string[],
): RuleScore[] {
  const winRate = getMetric("win_rate");
  const expectancy = getMetric("expectancy");

  const side = (group: EnrichedTrade[]): RuleSide => ({
    n: group.length,
    winRate: group.length > 0 ? (winRate?.compute(group, ctx) ?? null) : null,
    expectancy: group.length > 0 ? (expectancy?.compute(group, ctx) ?? null) : null,
  });

  return ruleIds.map((ruleId) => {
    const followedTrades: EnrichedTrade[] = [];
    const brokenTrades: EnrichedTrade[] = [];

    for (const t of trades) {
      // `applicableAnswers` and not the raw answers: a `winner`-only rule
      // answered on a trade that ended red is an observation from outside the
      // population the rule was ever asked about.
      const answer = applicableAnswers(t, rules).find(
        (a) => a.rule_id === ruleId && a.followed != null,
      );
      if (!answer) continue;
      (answer.followed ? followedTrades : brokenTrades).push(t);
    }

    const followed = side(followedTrades);
    const broken = side(brokenTrades);
    const n = followed.n + broken.n;

    // EACH SIDE clears the floor, not the total.
    //
    // The rule used to be `n >= RULE_SAMPLE.MIN` on the sum, and it let the
    // screen contradict itself in a way that only appeared once there was
    // enough data to see: 14 followed against 18 broken withheld BOTH win rates
    // as too thin to print, then printed their difference as "+100 pp". A
    // difference is a comparison of two proportions, so it cannot be sounder
    // than the weaker of them — and the lopsided case is worse still, since
    // 31 followed against 1 broken cleared the old test on the strength of a
    // single observation.
    const bothSidesUsable =
      followed.n >= RULE_SAMPLE.MIN &&
      broken.n >= RULE_SAMPLE.MIN &&
      followed.winRate != null &&
      broken.winRate != null;

    return {
      ruleId,
      text: rules.text.get(ruleId) ?? ruleId,
      n,
      followed,
      broken,
      gapPp: bothSidesUsable
        ? (followed.winRate as number) - (broken.winRate as number)
        : null,
      tier: ruleSampleTier(n),
    };
  });
}
