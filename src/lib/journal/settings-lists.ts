/**
 * Option lists that must not appear on Settings → Dropdown Lists.
 *
 * Not a cleanup of clutter — each of these would be actively misleading there,
 * and for a different reason. The list is small on purpose: hiding a list the
 * trader can still fill in is worse than showing one they rarely touch, so a
 * key only earns a place here when editing it does nothing or does harm.
 *
 * HIDDEN, NOT DELETED. Both still hold rows that other code reads —
 * `setup_grade` and `direction` carry the labels history was written with — and
 * a screen that stops offering an editor is reversible in a way that a `DELETE`
 * is not. Removing the rows would also put the seed and the app in disagreement
 * for every existing user until a data migration caught up.
 *
 * `rule_category` used to be the third. It is gone rather than hidden: playbook
 * sections are rows of `tj_playbook_sections`, owned by one playbook each, and
 * `20260824100000` dropped the list along with the account-wide heading it
 * stood for.
 */
export const LISTS_HIDDEN_FROM_SETTINGS: Record<string, string> = {
  /**
   * Derived from the playbook criteria, never typed.
   *
   * `setup-score.ts` computes the grade from the criteria ticked while the
   * trade was still planned; the column survives only to carry trades graded by
   * hand before that, and nothing writes it any more. Editing the letters here
   * would change nothing at all — the bucket order comes from `SETUP_GRADES`.
   */
  setup_grade: "The setup grade is computed from playbook criteria.",

  /**
   * Computed from entry versus stop.
   *
   * The field is `type: "computed"` in `form-config.ts` and the report
   * dimension carries its own fixed `order: ["Long", "Short"]`, so nothing
   * anywhere reads this list. Adding a third direction here would produce an
   * option no form can offer.
   */
  direction: "Direction is derived from the entry and stop prices.",
};

/** Lists the trader can actually act on, in their original order. */
export function editableLists<T extends { key: string }>(
  lists: readonly T[],
): T[] {
  return lists.filter((l) => !(l.key in LISTS_HIDDEN_FROM_SETTINGS));
}
