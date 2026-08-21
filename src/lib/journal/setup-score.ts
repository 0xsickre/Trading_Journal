/**
 * Setup quality, derived from the criteria you ticked rather than a letter you
 * typed.
 *
 * WHAT THIS REPLACES. `setup_grade` was a free-text column filled in by hand,
 * and filled in AFTER the outcome was known — a loser remembered as a B, a
 * winner as an A+. It is the dimension the dashboard groups by default, so the
 * grade "explained" performance with a label partly derived FROM performance.
 * A score computed from criteria answered while the trade was still planned
 * cannot close that loop.
 *
 * IT IS STILL NOT OBJECTIVE, and pretending otherwise would be the same class
 * of error. Ticking "MSS with displacement" remains a judgement. What changes is
 * that the judgement is DECOMPOSED (several small questions instead of one big
 * one), CONSISTENT (the same questions every time), AUDITABLE (you can see which
 * criterion was missing on the losers) and — the real prize — TESTABLE:
 * `ruleScorecard` already measures win rate when a rule was kept against when it
 * was broken, so a criterion that predicts nothing can be found and dropped. A
 * single letter can never say WHICH part of "A+" was doing the work.
 */

import {
  applicableAnswers,
  type RuleLookup,
  type TradeOutcome,
} from "./reports/rule-lookup";
import { stringFieldValue } from "./field-values";
import type { TradeRow } from "./types";
import type { EnrichedTrade } from "./enriched-trade";

/** The four labels, best first. Also the bucket order for the report dimension. */
export const SETUP_GRADES = ["A+", "A", "B", "C"] as const;
export type SetupGrade = (typeof SETUP_GRADES)[number];

/**
 * Deliberately not `EnrichedTrade`: the journal grid holds a raw row and can
 * classify its own outcome, and making it build an enriched trade just to read
 * a grade would be a second construction of something it already has.
 */
export type ScorableTrade = {
  id: string;
  outcome: TradeOutcome;
  row: TradeRow;
};

/** Adapter for the report side, which works in enriched trades. */
export function scorable(e: EnrichedTrade): ScorableTrade {
  return { id: e.id, outcome: e.outcome, row: e.trade.row };
}

export type SetupScore = {
  /** Criteria answered "followed". */
  met: number;
  /** Criteria that applied to this trade at all. */
  total: number;
  /** `met / total * 100`. */
  pct: number;
  grade: SetupGrade;
};

/**
 * Bands, best first.
 *
 * A+ demands ALL of them: the label means "this was the setup I said I was
 * waiting for", and a setup missing one of its own defining conditions is not
 * that. The rest fall on eighty and sixty.
 */
export function gradeFromPct(pct: number): SetupGrade {
  if (pct >= 100) return "A+";
  if (pct >= 80) return "A";
  if (pct >= 60) return "B";
  return "C";
}

/**
 * Null in three cases, all deliberate.
 *
 * 1. THE TRADE NAMES NO PLAYBOOK. Without one there is no list of criteria, so
 *    there is no question to answer.
 *
 * 2. ITS PLAYBOOK MARKS NO CRITERIA. Nothing to grade; an em dash is honest.
 *
 * 3. ANY CRITERION IS UNANSWERED. This departs from `computeFollowRate`, which
 *    drops unanswered rules from BOTH sides of its ratio — correct for a rate,
 *    and a loophole for a grade: answer one criterion, meet it, collect an A+.
 *    A grade is a verdict on the whole setup, so it requires the whole
 *    checklist.
 *
 * The third case is why this counts against what the PLAYBOOK defines rather
 * than against the answers present. An unanswered rule is stored as no row at
 * all, so scoring the rows alone would read three of four criteria as three of
 * three — a perfect score awarded for an unfinished checklist, which is exactly
 * the failure this function exists to prevent.
 *
 * `applicableAnswers` still supplies the answers, so the population is the one
 * the follow rate and the per-rule scorecard already use. The database refuses
 * a criterion that is not `show_when = 'always'`, so in practice every criterion
 * survives that filter — it is applied anyway because the guarantee lives in the
 * database rather than here.
 */
export function setupScoreFromTrade(
  t: ScorableTrade,
  rules: RuleLookup,
): SetupScore | null {
  const playbookId = stringFieldValue(t.row, "playbook_id");
  if (!playbookId) return null;

  const expected = rules.criteriaByPlaybook.get(playbookId);
  if (!expected || expected.length === 0) return null;

  const answered = new Map(
    applicableAnswers(t, rules).map((a) => [a.rule_id, a.followed]),
  );

  let met = 0;
  for (const ruleId of expected) {
    if (!answered.has(ruleId)) return null;
    const followed = answered.get(ruleId);
    // A row carrying a null verdict is "not answered" too — the type allows it
    // even though both write paths refuse to store it.
    if (followed == null) return null;
    if (followed) met++;
  }

  const total = expected.length;
  const pct = (met / total) * 100;
  return { met, total, pct, grade: gradeFromPct(pct) };
}
