import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { OptionItem, OptionList, OptionsMap } from "./types";

export type { OptionList, OptionsMap } from "./types";

/** All lists with their items. `activeOnly` filters soft-deleted options. */
export async function getListsWithItems(
  activeOnly = false,
): Promise<OptionList[]> {
  const supabase = await createClient();
  const [{ data: lists }, { data: items }] = await Promise.all([
    // `id` breaks ties: sort_order is not unique, and rows written before the
    // ordinal was allocated atomically can share one. Without a tiebreak those
    // rows come back in whatever order the planner picks, so a list could
    // reshuffle between two identical page loads.
    supabase
      .from("tj_option_lists")
      .select("id,key,label,category,color,sort_order")
      .order("sort_order")
      .order("id"),
    supabase
      .from("tj_option_items")
      .select("id,list_id,value,label,color,is_active,sort_order")
      .order("sort_order")
      .order("id"),
  ]);

  const byList = new Map<string, OptionItem[]>();
  for (const it of items ?? []) {
    if (activeOnly && !it.is_active) continue;
    const arr = byList.get(it.list_id) ?? [];
    arr.push({
      id: it.id,
      value: it.value,
      label: it.label,
      color: it.color,
      is_active: it.is_active,
      sort_order: it.sort_order,
    });
    byList.set(it.list_id, arr);
  }

  return (lists ?? []).map((l) => ({
    ...l,
    items: byList.get(l.id) ?? [],
  }));
}

/** Map keyed by list `key` -> items, for powering form dropdowns. */
export async function getOptionsMap(activeOnly = true): Promise<OptionsMap> {
  const lists = await getListsWithItems(activeOnly);
  const map: OptionsMap = {};
  for (const l of lists) map[l.key] = l.items;
  return map;
}
