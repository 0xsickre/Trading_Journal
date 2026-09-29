/**
 * Rule registry and runner.
 *
 * The registry is also the honest record of what this engine does NOT do.
 * One TradeZella pattern is deliberately absent rather than approximated, and
 * the reason is listed with it — see `OMITTED_RULES`. A percentage
 * invented from data we do not have would be worse than a missing one.
 */

import type { InsightContext } from "./context";
import { DAY_RULES } from "./day-rules";
import { PROCESS_RULES } from "./process-rules";
import { TRADE_RULES } from "./trade-rules";
import { sortInsights, type Insight, type InsightRule } from "./types";

export type Rule = InsightRule<InsightContext>;

/** TradeZella patterns implemented here. */
export const TZ_RULES: Rule[] = [...TRADE_RULES, ...DAY_RULES];

/**
 * Patterns this journal has that TradeZella structurally cannot. The swing
 * rules that joined on the per-position check-ins, the time stop in days and
 * the weekend went with the swing book (H1, 28.09.2026).
 */
export const OWN_RULES: Rule[] = [...PROCESS_RULES];

export const ALL_RULES: Rule[] = [...TZ_RULES, ...OWN_RULES];

export type OmittedRule = {
  id: string;
  reason: string;
};

/**
 * Deliberately not implemented. The time-underwater pair came back in F5.3b,
 * measured from the R2 candles by `futures-trading`; what is left needs the
 * peak of the DAY's cumulative P&L, which no one measures.
 */
export const OMITTED_RULES: OmittedRule[] = [
  {
    id: "maximize_your_profit_day",
    reason:
      "Needs the intraday peak of cumulative P&L. The trade-level `gave_back_profit` covers the same behaviour from MFE.",
  },
];

export type RunResult = {
  insights: Insight[];
  /** Rules that did not run because the baseline was too small. */
  skipped: { id: string; minSample: number; sample: number }[];
};

/**
 * Evaluate every rule against the context.
 *
 * A rule whose baseline is smaller than its `minSample` is skipped, not run
 * with a shaky baseline — that is the difference between feedback and noise.
 */
export function runInsights(
  ctx: InsightContext,
  rules: Rule[] = ALL_RULES,
): RunResult {
  const insights: Insight[] = [];
  const skipped: RunResult["skipped"] = [];

  for (const rule of rules) {
    if (ctx.baseline.sample < rule.minSample) {
      skipped.push({
        id: rule.id,
        minSample: rule.minSample,
        sample: ctx.baseline.sample,
      });
      continue;
    }
    insights.push(...rule.evaluate(ctx));
  }

  return { insights: sortInsights(insights), skipped };
}

export function ruleById(id: string): Rule | undefined {
  return ALL_RULES.find((r) => r.id === id);
}
