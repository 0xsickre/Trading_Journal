import type { FieldDef } from "./field-def-types";

/**
 * The categories every account is seeded with, as `tj_field_defs` rows.
 *
 * Tests need these because the form is DATA-DRIVEN now: `technical_tags`,
 * `exit_reason`, `mistake`, `psychology_tags` and `miss_reason` used to be
 * declared in `form-config.ts`, so `buildFormTabs()` produced them from
 * nothing. They are rows now — that is the whole point, it is what gave them a
 * phase, a single/multi and a delete — and a test calling `buildFormTabs()`
 * with no defs is describing an account that has deleted every category, not a
 * fresh one.
 *
 * Kept beside the code rather than copied into each spec so there is one
 * answer to "what does a seeded account look like". Mirrors the seed in
 * `20260823140000_column_backed_categories.sql`; if that file gains a row, this
 * one does too.
 */
export const SEEDED_FIELD_DEFS: FieldDef[] = [
  def("technical_tags", "Technical Tags", "tags", "technical_tag", "always", 0),
  def("exit_reason", "Exit Reason", "select", "exit_reason", "active", 1),
  def("mistake", "Mistake", "tags", "mistake", "active", 2),
  def("psychology_tags", "Psychology tags", "tags", "emotion", "active", 3),
  def("miss_reason", "Miss Reason", "select", "miss_reason", "missed", 4),
];

function def(
  key: string,
  label: string,
  fieldType: FieldDef["field_type"],
  listKey: string,
  showPhase: FieldDef["show_phase"],
  sortOrder: number,
): FieldDef {
  return {
    id: key,
    key,
    label,
    field_type: fieldType,
    list_key: listKey,
    show_phase: showPhase,
    sort_order: sortOrder,
    is_active: true,
    show_when: "always",
  };
}
