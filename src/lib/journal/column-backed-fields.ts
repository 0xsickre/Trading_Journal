// Client-safe: the trade form and the save path both read this.

/**
 * Categories whose value lives in a COLUMN on `tj_positions`, not in `custom`.
 *
 * WHY THIS EXISTS. A category is normally a row in `tj_field_defs` whose values
 * go into the `custom` jsonb bag — that is what makes it addable, renamable and
 * deletable without a migration. Five categories predate that and own a real
 * column each, because reports, the grid and the CSV export read them by name:
 * `technical_tags`, `mistake`, `psychology_tags`, `exit_reason`, `miss_reason`.
 *
 * They were therefore declared in `form-config.ts` instead, and that made them
 * second-class in a way the trader could see: no phase to set, no single/multi
 * to choose, nothing in Settings but a rename and a colour. Every other
 * category had all three.
 *
 * A definition row for them fixes that — but a definition writes to `custom`,
 * and `fieldValue` reads a COLUMN before it looks in the bag. Written to the
 * bag and read from the column, the value would be permanently invisible. That
 * is the precise trap `RESERVED_KEYS` was built to prevent, and it is why a
 * trader still cannot NAME a category after a column.
 *
 * So the definition exists and the storage does not move: a key in this set is
 * marked `custom: false`, and the save path routes it to its column. Read and
 * write finally agree, and the trap closes rather than being stepped around.
 *
 * NOT the same list as `RESERVED_KEYS`. That one holds every column on the
 * table — `id`, `user_id`, `created_at`, the prices, the timestamps — and none
 * of those is a category. This is the handful that genuinely are, and it stays
 * hand-written for that reason: a column becomes a category because someone
 * decided it is one, never because it happens to exist.
 */
export const COLUMN_BACKED_CATEGORY_KEYS: ReadonlySet<string> = new Set([
  "technical_tags",
  "mistake",
  "psychology_tags",
  "exit_reason",
  "miss_reason",
]);

/** True when this category's values belong in a column rather than in `custom`. */
export function isColumnBackedCategory(key: string): boolean {
  return COLUMN_BACKED_CATEGORY_KEYS.has(key);
}

/**
 * The one category whose picker draws from MORE than one list.
 *
 * `psychology_tags` is a single column fed by two categories — how you felt
 * (`emotion`) and how you behaved (`discipline`) — and a definition row carries
 * one `list_key`. The row binds to `emotion` so the category has somewhere to
 * keep its phase and its single/multi, and this fills the gap the model cannot:
 * the picker offers both lists, exactly as the hardcoded field used to.
 *
 * It is a genuine exception rather than a shortcut. Splitting it into two
 * categories would need two columns and a rewrite of every reader that groups
 * on `psychology_tags`; merging the two lists into one would throw away the
 * distinction the reports dimension is built on. Written down here so the next
 * person finds the reason instead of the symptom.
 */
export const MERGED_CATEGORY_LISTS: Readonly<Record<string, readonly string[]>> = {
  psychology_tags: ["emotion", "discipline"],
};
