/**
 * Journal grid column visibility.
 *
 * The stored preference is the set of columns switched OFF. Everything the grid
 * knows about and the user has not hidden is visible, which is what makes a
 * newly added column appear for people who configured their grid a year ago —
 * storing the visible set instead would freeze each user's list on the day they
 * last touched it.
 */

/** At least one column must survive, or the grid renders as an empty frame. */
const MIN_VISIBLE_COLUMNS = 1;

/**
 * TanStack's `columnVisibility` state, built from the stored hidden ids.
 *
 * Ids that no longer match a column are inert — a renamed or deleted column
 * leaves a string behind, and it must do nothing rather than blank the grid.
 */
export function hiddenToVisibility(
  hidden: readonly string[],
  known: readonly string[],
): Record<string, boolean> {
  const off = new Set(hidden);
  const out: Record<string, boolean> = {};
  for (const id of known) out[id] = !off.has(id);
  return out;
}

/**
 * Toggle one column, refusing the move that empties the grid.
 *
 * Enforced here rather than only in the UI so the rule holds however the toggle
 * is driven — the last visible column simply cannot be switched off.
 */
export function toggleHidden(
  hidden: readonly string[],
  known: readonly string[],
  id: string,
): string[] {
  if (!known.includes(id)) return [...hidden];

  const off = new Set(hidden);
  if (off.has(id)) {
    off.delete(id);
  } else {
    const visibleAfter = known.filter((k) => k !== id && !off.has(k)).length;
    if (visibleAfter < MIN_VISIBLE_COLUMNS) return [...hidden];
    off.add(id);
  }
  // Ordered by the grid's own column order so the stored value is stable and two
  // identical selections never produce two different arrays.
  return known.filter((k) => off.has(k));
}

/** How many of the known columns are currently on. */
export function visibleCount(
  hidden: readonly string[],
  known: readonly string[],
): number {
  const off = new Set(hidden);
  return known.filter((k) => !off.has(k)).length;
}
