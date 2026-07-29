// Client-safe types for user-defined trade fields (no server-only imports).

/**
 * Form groups a custom field may be placed in.
 *
 * Deliberately a closed set of METHODOLOGY groups. The rest of the form — the
 * risk plan with its progressive reveal, the outcome block, the missed-setup
 * review — is behaviour, not a field list, and letting a custom field land
 * there would mean the form's logic no longer matches what it renders.
 */
export const FIELD_DEF_GROUPS = [
  "macro",
  "setup",
  "plan_advanced",
  "execution_advanced",
] as const;

export type FieldDefGroup = (typeof FIELD_DEF_GROUPS)[number];

export const FIELD_DEF_GROUP_LABELS: Record<FieldDefGroup, string> = {
  macro: "Macro (vault)",
  setup: "Setup",
  plan_advanced: "Plan — Advanced",
  execution_advanced: "Execution — Advanced",
};

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
  group_id: FieldDefGroup;
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
