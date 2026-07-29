import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { FieldDef } from "./field-def-types";

export type { FieldDef, FieldDefGroup } from "./field-def-types";

/**
 * User-defined trade fields, in render order.
 *
 * `activeOnly` is what the FORM wants: a deactivated field must not be offered
 * for new input. Everything that READS history — reports, the mentor pack, the
 * CSV export — must pass `false`, because trades taken while the field was
 * active still carry its values and hiding the definition would turn recorded
 * data into an unlabelled key.
 */
export async function getFieldDefs(activeOnly = true): Promise<FieldDef[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tj_field_defs")
    .select("id,key,label,field_type,list_key,group_id,sort_order,is_active,show_when")
    // `id` breaks ties — sort_order is not unique, and without a tiebreak two
    // fields sharing an ordinal reshuffle between identical page loads.
    .order("sort_order")
    .order("id");

  return (data ?? [])
    .filter((d) => !activeOnly || d.is_active)
    .map((d) => ({
      id: d.id,
      key: d.key,
      label: d.label,
      field_type: d.field_type as FieldDef["field_type"],
      list_key: d.list_key,
      group_id: d.group_id as FieldDef["group_id"],
      sort_order: d.sort_order,
      is_active: d.is_active,
      show_when: d.show_when as FieldDef["show_when"],
    }));
}
