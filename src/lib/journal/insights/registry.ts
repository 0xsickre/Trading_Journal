/**
 * Rule registry and runner.
 *
 * The registry is also the honest record of what this engine does NOT do.
 * Four TradeZella patterns are deliberately absent rather than approximated,
 * and the reason is listed with each — see `OMITTED_RULES`. A percentage
 * invented from data we do not have would be worse than a missing one.
 */

import type { InsightContext } from "./context";
import { DAY_RULES } from "./day-rules";
import { PROCESS_RULES } from "./process-rules";
import { SWING_RULES } from "./swing-rules";
import { TRADE_RULES } from "./trade-rules";
import { WEEK_RULES } from "./week-rules";
import { sortInsights, type Insight, type InsightRule } from "./types";

export type Rule = InsightRule<InsightContext>;

/** TradeZella patterns implemented here. */
export const TZ_RULES: Rule[] = [...TRADE_RULES, ...DAY_RULES, ...WEEK_RULES];

/**
 * Patterns this journal has that TradeZella structurally cannot.
 *
 * `SWING_RULES` join on the thesis, the time stop and the per-position
 * check-ins — three things that only exist because the trade is held across
 * days. There is nothing to approximate them with in a book that flattens
 * every night.
 */
export const OWN_RULES: Rule[] = [...PROCESS_RULES, ...SWING_RULES];

export const ALL_RULES: Rule[] = [...TZ_RULES, ...OWN_RULES];

export type OmittedRule = {
  id: string;
  reason: string;
};

/**
 * Deliberately not implemented. Each needs a running P&L series per trade,
 * which needs an intraday price feed — the one piece of infrastructure this
 * project has decided not to buy.
 */
export const OMITTED_RULES: OmittedRule[] = [
  {
    id: "most_time_in_drawdown",
    reason:
      "Needs the share of TIME spent underwater, so the full running P&L curve. MAE/MFE shows how deep, not how long.",
  },
  {
    id: "deep_in_drawdown_day",
    reason:
      "The daily version of the same — same missing data, same decision.",
  },
  {
    id: "patience_paid_off",
    reason:
      "Measures how late in the SESSION the first entry falls. An intraday notion with no meaningful swing equivalent.",
  },
  {
    id: "maximize_your_profit_day",
    reason:
      "Needs the intraday peak of cumulative P&L. The trade-level `maximize_your_profit` covers the same behaviour from MFE.",
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
