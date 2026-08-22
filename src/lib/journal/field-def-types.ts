// Client-safe types for user-defined trade fields (no server-only imports).

/**
 * When a category is asked for.
 *
 * This replaced `group_id`, which put every category into one of four groups
 * fixed in code — "Setup", "Context", two "Advanced". Those groups carried a
 * heading and a description nobody could rename, delete or add to: the only
 * structure on the form the trader looked at and could not touch. The form
 * shows a flat list now, and the question a group was standing in for turns out
 * to be this one — not "which box does it live in" but "when do I need it".
 */
export const FIELD_DEF_PHASES = [
  "always",
  "planned",
  "active",
  "missed",
] as const;

export type FieldDefPhase = (typeof FIELD_DEF_PHASES)[number];

/** Names shown in Settings when choosing when a category appears. */
export const FIELD_DEF_PHASE_LABELS: Record<FieldDefPhase, string> = {
  always: "Always",
  planned: "Only while planned",
  active: "Only once active",
  missed: "Only on a missed setup",
};

/**
 * Does a category apply to the trade as it stands?
 *
 * `always` is the default and the answer for most: a tag you want on every
 * trade. The other three are the phases the form itself already branches on, so
 * a category can be asked for exactly where it makes sense — a miss reason only
 * on a missed setup, a management note only once the position is live.
 */
export function fieldAppliesToPhase(
  showPhase: FieldDefPhase,
  phase: Exclude<FieldDefPhase, "always">,
): boolean {
  return showPhase === "always" || showPhase === phase;
}

export const FIELD_DEF_TYPES = [
  "select",
  "text",
  "textarea",
  "number",
  "tags",
  "url",
] as const;

export type FieldDefType = (typeof FIELD_DEF_TYPES)[number];

export type FieldDef = {
  id: string;
  /** Storage key inside `tj_positions.custom`. */
  key: string;
  label: string;
  field_type: FieldDefType;
  /** Option list key backing a select / tags field. */
  list_key: string | null;
  /** Which phase of a trade asks for this category. */
  show_phase: FieldDefPhase;
  sort_order: number;
  is_active: boolean;
  show_when: "always" | "winner" | "loser" | "breakeven";
};

/**
 * A label like "ATR at entry" becomes the storage key `atr_at_entry`.
 *
 * Lives here rather than beside the server action because the add-field form
 * previews the key as you type — and a `"use server"` module may only export
 * async functions.
 */
export function slugifyFieldKey(label: string): string {
  const base = label
    .normalize("NFD")
    // Strip diacritics, so "\u010cekirano" slugs to "cekirano" and not "ekirano".
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 49);
  // The DB requires a leading letter; a label of only digits or symbols would
  // otherwise produce a key the insert rejects.
  return /^[a-z]/.test(base) ? base : `f_${base}`.replace(/_+$/, "").slice(0, 49);
}
