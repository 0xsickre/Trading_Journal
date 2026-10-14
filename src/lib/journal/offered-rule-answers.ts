import type { Outcome } from "./breakeven";
import { ruleAppliesTo, type Playbook } from "./playbook-types";

/**
 * Answers to the rules the checklist is currently OFFERING, as the save sends them.
 *
 * Every rule that applies to the outcome gets an explicit true or false: the
 * checklist has one tick per rule, and an untouched box IS the answer "not
 * kept" — writing nothing would leave the screen saying 3 of 8 while the
 * statistics counted 3 of 3. A retired rule nobody ticked is left unanswered,
 * so a retired rule cannot collect fresh observations. Rules that do not apply
 * to the outcome are left out, the same predicate (`ruleAppliesTo`) the
 * statistics filter with.
 */
export function offeredRuleAnswers(
  book: Pick<Playbook, "rules"> | null | undefined,
  answers: Readonly<Record<string, boolean>>,
  outcome: Outcome | null,
): Record<string, boolean> {
  if (!book) return {};
  const out: Record<string, boolean> = {};
  for (const rule of book.rules) {
    if (!ruleAppliesTo(rule.show_when, outcome)) continue;
    const v = answers[rule.id];
    if (rule.deleted_at != null && v === undefined) continue;
    out[rule.id] = v === true;
  }
  return out;
}
