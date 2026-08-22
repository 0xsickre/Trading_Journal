// Client-safe ordering for a playbook's rule links (no server-only imports).

import type { RuleCategory } from "@/lib/journal/playbook-types";

/** One link, in the order the playbook currently holds it. */
export type RuleLink = { ruleId: string; category: RuleCategory };

/**
 * The full link order after moving one rule one place WITHIN ITS CATEGORY.
 *
 * Its own module, and pure, for the reason `dashboard-widgets.ts` gives for
 * `moveWidget`: ordering is the part of a reorder that can actually be wrong,
 * and it is the part a server action cannot test cheaply. The action stays a
 * shell around this.
 *
 * WHY THE CATEGORY SCOPE IS THE WHOLE PROBLEM
 *
 * The screen groups rules by category, but the database stores ONE flat
 * `sort_order` per playbook across all of them, and a playbook's links are not
 * grouped in it — Context, Entry and Exit rules interleave freely, because
 * `linkRule` only ever appends `max + 1` in whatever order the rules were added.
 *
 * So "move this Entry rule down" cannot mean "swap with the next link". The next
 * link may be a Context rule sitting between two Entry rules, and swapping with
 * it would move nothing on screen while shuffling a different section.
 *
 * What it means instead: the rules of one category occupy a set of ABSOLUTE
 * SLOTS in the flat order, and moving within the category swaps the occupants of
 * two of those slots. Every rule of every other category keeps its exact index —
 * which is invisible, and correct, because nothing draws the flat order.
 *
 * Returns the complete canonical order rather than the two changed positions,
 * matching `moveWidget` and `moveFieldDef`: the caller writes ordinals from an
 * array, so a set of links that already share an ordinal comes out normalised
 * instead of staying ambiguous. `linkRule` assigns `max + 1` through a
 * read-then-write, so duplicates are reachable.
 *
 * Null — not a copy of the input — when the move is a no-op: unknown rule, or
 * already at the end of its own category. That lets the action skip the write
 * entirely, and it is why the return type is nullable rather than forgiving.
 * Clamped at both ends, never wrapping.
 */
export function moveRuleWithinCategory(
  links: readonly RuleLink[],
  ruleId: string,
  direction: -1 | 1,
): string[] | null {
  const self = links.findIndex((l) => l.ruleId === ruleId);
  if (self < 0) return null;

  // The absolute indices this rule's category occupies, in link order.
  const slots = links.flatMap((l, i) => (l.category === links[self].category ? [i] : []));

  const from = slots.indexOf(self);
  const to = from + direction;
  if (to < 0 || to >= slots.length) return null;

  const next = links.map((l) => l.ruleId);
  [next[slots[from]], next[slots[to]]] = [next[slots[to]], next[slots[from]]];
  return next;
}

/**
 * The order after dragging `fromId` onto `toId`'s place.
 *
 * The drop target's index is where the dragged item LANDS, computed after the
 * dragged item has been lifted out — which is what makes a downward drag behave
 * the way the pointer implies. Splice out first, then insert at the target's
 * index in the shortened array: dragging item 0 onto item 3 puts it after the
 * three that were above it, and dragging item 3 onto item 0 puts it first.
 * Taking the index before removal would leave a downward drag one place short
 * of the row it was dropped on.
 *
 * Null when nothing moves — same id, unknown id, or a drop that would rebuild
 * the identical array — so the caller can skip the write entirely.
 */
export function moveToIndex(
  ids: readonly string[],
  fromId: string,
  toId: string,
): string[] | null {
  if (fromId === toId) return null;
  const from = ids.indexOf(fromId);
  const to = ids.indexOf(toId);
  if (from < 0 || to < 0) return null;

  const next = [...ids];
  next.splice(from, 1);
  next.splice(next.indexOf(toId) + (from < to ? 1 : 0), 0, fromId);
  return next.every((id, i) => id === ids[i]) ? null : next;
}

/**
 * The full link order after reordering ONE category's rules wholesale.
 *
 * The drag-and-drop counterpart to `moveRuleWithinCategory`, and it inherits
 * that function's whole reason for existing: a playbook's links carry one flat
 * `sort_order` across every category, and rules of different categories
 * interleave freely in it. So a category's rules occupy a set of ABSOLUTE SLOTS
 * scattered through the flat order, and reordering them means refilling those
 * same slots in the new order. Every rule of every other category keeps its
 * exact index.
 *
 * `ordered` is that category's rule ids in their new order. Ids it does not
 * name — and ids belonging to other categories — are left exactly where they
 * are, so a stale client array can never drop a rule out of the playbook.
 * Null when the result matches what is already stored.
 */
export function reorderWithinCategory(
  links: readonly RuleLink[],
  category: RuleCategory,
  ordered: readonly string[],
): string[] | null {
  const slots = links.flatMap((l, i) => (l.category === category ? [i] : []));
  // Only the ids actually in this category, in the order given, with any the
  // caller forgot appended in their current order.
  const inCategory = slots.map((i) => links[i].ruleId);
  const wanted = ordered.filter((id) => inCategory.includes(id));
  const rest = inCategory.filter((id) => !wanted.includes(id));
  const filled = [...wanted, ...rest];
  if (filled.length !== slots.length) return null;

  const next = links.map((l) => l.ruleId);
  slots.forEach((slot, i) => {
    next[slot] = filled[i];
  });
  return next.every((id, i) => id === links[i].ruleId) ? null : next;
}

/**
 * The full order after moving one id one place. Null when nothing moves.
 *
 * Deliberately NOT `moveRuleWithinCategory` with the category argument dropped.
 * That one exists because rule links share one flat ordinal across sections and
 * a "next" link may belong to a different section; a section list has no such
 * interleaving, so the honest implementation is a plain adjacent swap and
 * pretending otherwise would import a subtlety that does not apply here.
 *
 * Returns the whole array, matching the three siblings in this codebase: the
 * caller writes ordinals from indices, so a list that already holds duplicate
 * `sort_order` values comes out normalised instead of staying ambiguous.
 * Clamped at both ends, never wrapping.
 */
export function moveInOrder(
  ids: readonly string[],
  id: string,
  direction: -1 | 1,
): string[] | null {
  const from = ids.indexOf(id);
  if (from < 0) return null;
  const to = from + direction;
  if (to < 0 || to >= ids.length) return null;
  const next = [...ids];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}
