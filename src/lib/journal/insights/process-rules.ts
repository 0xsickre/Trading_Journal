/**
 * Process insights — the ones TradeZella structurally cannot have.
 *
 * They all join trade outcomes against the daily process journal or against
 * a decision made before entry (the setup grade, the plan). That join is the
 * whole reason this journal exists: it prices discipline in R instead of
 * describing it in prose.
 *
 * `against_macro_bias` and `cot_chase` read the swing cycle's vault fields
 * (`macro_align`, `cot_filter`); the day trader's bias comes from the brief, and
 * no form asks for either field any more, so both rules left in F6 (decision
 * M2-A). The values stay on the trades that carry them.
 */

import { setupScoreFromTrade } from "../setup-score";
import { fmtMoney } from "../format";
import { planDayEndsAt } from "../session-brief";
import type { TradeRow } from "../types";
import type { InsightContext } from "./context";
import type { Insight, InsightRule } from "./types";

const P = {
  /** Mental temperature below which entries are flagged. */
  LOW_MENTAL_TEMP: 3,
} as const;

type Rule = InsightRule<InsightContext>;

/** Entering on a day you rated your own head below par. */
export const lowMentalTempEntry: Rule = {
  id: "low_mental_temp_entry",
  level: "trade",
  minSample: 0,
  description: "An entry on a day with mental temperature below the threshold.",
  evaluate: (ctx) => {
    const out: Insight[] = [];
    for (const e of ctx.trades) {
      // The judgement that matters is the one made at ENTRY, so this reads the
      // open day rather than the close day.
      const report = ctx.reportByDate.get(e.openDay);
      const temp = report?.mental_temp;
      if (temp == null || temp >= P.LOW_MENTAL_TEMP) continue;
      out.push({
        ruleId: "low_mental_temp_entry",
        level: "trade",
        severity: e.outcome === "loss" ? "critical" : "warning",
        title: "Entry on a poor mental rating",
        detail: `On the entry day you rated your mental temperature ${temp}/5. Outcome: ${
          e.r != null ? `${e.r.toFixed(2)}R` : fmtMoney(e.pnl, ctx.currency)
        }.`,
        subjectId: e.id,
        subjectLabel: e.label,
      });
    }
    return out;
  },
};

/** A-grade setups that were planned and never taken. */
/**
 * Is this an A-setup?
 *
 * The derived grade wins when it exists; the hand-typed column is the fallback
 * for trades graded before criteria existed. Both are compared against a closed
 * set rather than by prefix, which is how it used to be done — `startsWith("a")`
 * also matched anything a person typed into the editable option list, "Awful"
 * included.
 */
function isASetup(
  row: TradeRow,
  scored: { grade: string } | null,
): boolean {
  // Derived only — the typed column is gone (Phase E).
  const grade = scored?.grade ?? "";
  return grade === "A+" || grade === "A";
}

export const missedASetup: Rule = {
  id: "missed_a_setup",
  level: "portfolio",
  minSample: 0,
  description: "A-setups marked as missed.",
  evaluate: (ctx) => {
    // Derived here too, from the raw row — `ScorableTrade` is exactly
    // `{ id, outcome, row }`, and setup criteria are pinned to
    // `show_when = 'always'`, so they apply with no outcome at all. That is
    // the right population for this rule: a plan that was never taken has no
    // outcome to be graded with hindsight, and its checklist was filled in
    // when it was written. This used to read the typed column instead, which
    // Phase E removed.
    const missed = ctx.allRows.filter(
      (r) =>
        r.status === "missed" &&
        isASetup(
          r,
          ctx.rules
            ? setupScoreFromTrade({ id: r.id, outcome: null, row: r }, ctx.rules)
            : null,
        ),
    );
    if (missed.length === 0) return [];
    return [
      {
        ruleId: "missed_a_setup",
        level: "portfolio",
        severity: "warning",
        title: "Missed A-setups",
        detail: `${missed.length} A-setups were planned and never executed. No P&L statistic shows this — an execution problem, not a selection one.`,
        subjectId: "missed_a_setup",
        sample: missed.length,
      },
    ];
  },
};

/** Plans left sitting without a fill. */
export const stalePlan: Rule = {
  id: "stale_plan",
  level: "portfolio",
  minSample: 0,
  description: "Planned trades whose trading day is over, with no fill and not marked missed.",
  evaluate: (ctx) => {
    const now = Date.now();
    const stale = ctx.allRows.filter((r) => {
      if (r.status !== "planned") return false;
      const ends = planDayEndsAt(r.created_at == null ? null : String(r.created_at));
      return Number.isFinite(ends) && ends < now;
    });
    if (stale.length === 0) return [];
    return [
      {
        ruleId: "stale_plan",
        level: "portfolio",
        severity: "info",
        title: "Plans without execution",
        detail: `${stale.length} ${stale.length === 1 ? "plan" : "plans"} whose trading day is over, with no fill. Mark ${stale.length === 1 ? "it" : "them"} as missed — then R2 prices what they would have done — or delete them; a plan left open hides what hesitation cost.`,
        subjectId: "stale_plan",
        sample: stale.length,
      },
    ];
  },
};

export const PROCESS_RULES: Rule[] = [
  lowMentalTempEntry,
  missedASetup,
  stalePlan,
];
