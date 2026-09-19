import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { selectAllPages } from "@/lib/supabase/paginate";
import type { OptionItem, OptionList, OptionsMap } from "./types";
import {
  selectionOfFieldType,
  type CategorySelection,
  type FieldDefPhase,
  type FieldDefType,
} from "./field-def-types";

export type { OptionList, OptionsMap } from "./types";

/** One row of `tj_option_items`, as this module reads it. */
type OptionItemRow = OptionItem & { list_id: string };

/** All lists with their items. `activeOnly` filters soft-deleted options. */
async function readListsWithItems(
  activeOnly = false,
): Promise<OptionList[]> {
  const supabase = await createClient();
  const [{ data: lists }, items, { data: defs }] = await Promise.all([
    // `id` breaks ties: sort_order is not unique, and rows written before the
    // ordinal was allocated atomically can share one. Without a tiebreak those
    // rows come back in whatever order the planner picks, so a list could
    // reshuffle between two identical page loads.
    supabase
      .from("tj_option_lists")
      .select("id,key,label,category,color,sort_order")
      .order("sort_order")
      .order("id"),
    // Paginated, unlike the lists above: PostgREST caps a response at 1000 rows
    // and returns the truncated page with a 200. A trader past a thousand tags
    // would have lost the rest without a word — missing from the Tags table,
    // and missing from the dropdowns on the trade form.
    selectAllPages<OptionItemRow>((from, to) =>
      supabase
        .from("tj_option_items")
        .select("id,list_id,value,label,color,description,is_active,sort_order")
        .order("sort_order")
        .order("id")
        .range(from, to),
    ),
    // When each category is asked for. It is stored on the FIELD that renders
    // the list, because that is what the form reads — the list itself is only a
    // set of values. Joined here so Settings can show and edit it in one place.
    supabase.from("tj_field_defs").select("list_key,show_phase,field_type"),
  ]);

  const phaseByKey = new Map<string, FieldDefPhase>();
  const selectionByKey = new Map<string, CategorySelection | null>();
  for (const d of defs ?? []) {
    if (!d.list_key) continue;
    phaseByKey.set(d.list_key, d.show_phase as FieldDefPhase);
    selectionByKey.set(
      d.list_key,
      selectionOfFieldType(d.field_type as FieldDefType),
    );
  }

  const byList = new Map<string, OptionItem[]>();
  for (const it of items) {
    if (activeOnly && !it.is_active) continue;
    const arr = byList.get(it.list_id) ?? [];
    arr.push({
      id: it.id,
      value: it.value,
      label: it.label,
      color: it.color,
      description: it.description,
      is_active: it.is_active,
      sort_order: it.sort_order,
    });
    byList.set(it.list_id, arr);
  }

  return (lists ?? []).map((l) => ({
    ...l,
    show_phase: phaseByKey.get(l.key) ?? null,
    selection: selectionByKey.get(l.key) ?? null,
    items: byList.get(l.id) ?? [],
  }));
}

// Memoized per request (React `cache`), like `getCurrentUser` and `getFieldDefs`: a page
// and the helpers it calls ask for this more than once in one render, and each ask
// was its own round trip to the database.
export const getListsWithItems = cache(readListsWithItems);

/** Map keyed by list `key` -> items, for powering form dropdowns. */
export async function getOptionsMap(activeOnly = true): Promise<OptionsMap> {
  const lists = await getListsWithItems(activeOnly);
  const map: OptionsMap = {};
  for (const l of lists) map[l.key] = l.items;
  return map;
}

/**
 * Category key → the ordinal the trader dragged it to.
 *
 * Its own tiny read rather than a slice of `getListsWithItems`: the trade form
 * needs the ORDER and nothing else, and that heavier call drags every option
 * item and every field def along with it.
 *
 * This is what lets `technical_tags` take part in the ordering. That field is
 * declared in `form-config.ts` rather than in `tj_field_defs`, so it has no
 * field ordinal — but the category behind it is an ordinary row with an
 * ordinary `sort_order`, and ordering the group by the CATEGORY rather than by
 * the field is what puts every one of them on the same footing.
 */
export async function getCategoryOrder(): Promise<Record<string, number>> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tj_option_lists")
    .select("key,sort_order");
  const out: Record<string, number> = {};
  for (const l of data ?? []) out[l.key] = l.sort_order;
  return out;
}
