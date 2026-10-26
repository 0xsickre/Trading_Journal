import type { Outcome } from "./breakeven";
import { ruleAppliesTo, type Playbook } from "./playbook-types";

/** The rules the checklist asks (phase B1): the setup criteria, „Zašto ulazim“. */
export function isAskedRule(rule: { is_setup_criterion?: boolean }): boolean {
  return rule.is_setup_criterion === true;
}

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
 *
 * Only the setup criteria — „Zašto ulazim“ — are offered since phase B1
 * (26.10.2026): the checklist asks nothing else. An answer a trade already
 * carries to any other rule is passed through as it is, because the save
 * replaces every answer of the trade and leaving it out would delete history.
 */
export function offeredRuleAnswers(
  book: Pick<Playbook, "rules"> | null | undefined,
  answers: Readonly<Record<string, boolean>>,
  outcome: Outcome | null,
): Record<string, boolean> {
  if (!book) return {};
  const out: Record<string, boolean> = {};
  for (const rule of book.rules) {
    const v = answers[rule.id];
    if (!isAskedRule(rule)) {
      if (v !== undefined) out[rule.id] = v;
      continue;
    }
    if (!ruleAppliesTo(rule.show_when, outcome)) continue;
    if (rule.deleted_at != null && v === undefined) continue;
    out[rule.id] = v === true;
  }
  return out;
}
