/**
 * Which rule answers a trade page save writes, and which it removes (phase P).
 *
 * The old edit form went through `tj_save_trade`, which DELETES every answer on
 * the trade and inserts the ones on screen. That is wrong for a page that shows
 * only the chosen playbook's rules: trade #1 carries fifteen answers to rules
 * since unlinked and retired, and one save of an unrelated note erased them.
 *
 * So a save touches only what it can see:
 * - an answer the page sent for a rule the playbook links is written;
 * - a rule of the playbook the page no longer offers (outcome-scoped, or retired
 *   and unanswered) loses its answer, as the old save did;
 * - answers to rules OUTSIDE the playbook stay — unless the playbook itself
 *   changed (decision P-3, 14.10.2026): then the previous book's answers go, so
 *   they cannot keep counting in its statistics.
 */
export type RuleAnswerWrites = {
  upsert: { rule_id: string; followed: boolean }[];
  remove: string[];
};

export function ruleAnswerWrites({
  bookRuleIds,
  sent,
  previous,
  playbookChanged,
}: {
  /** Rules linked to the playbook the trade is saved with; empty for none. */
  bookRuleIds: ReadonlySet<string>;
  /** Rule id → followed, for every rule the page offered. */
  sent: Readonly<Record<string, boolean>>;
  /** Rule ids the trade already has an answer for. */
  previous: readonly string[];
  playbookChanged: boolean;
}): RuleAnswerWrites {
  const upsert = Object.entries(sent)
    .filter(([id]) => bookRuleIds.has(id))
    .map(([rule_id, followed]) => ({ rule_id, followed }));
  const kept = new Set(upsert.map((u) => u.rule_id));
  const remove = previous.filter((id) =>
    bookRuleIds.has(id) ? !kept.has(id) : playbookChanged,
  );
  return { upsert, remove };
}
