import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Instrument } from "./types";
import { DEFAULT_INSTRUMENT_SYMBOLS } from "./default-instruments";

export async function getInstruments(
  activeOnly = false,
): Promise<Instrument[]> {
  const supabase = await createClient();
  let query = supabase
    .from("tj_instruments")
    .select(
      "id,symbol,name,asset_class,point_value,tick_size,tick_value,currency,is_active,sort_order",
    )
    .in("symbol", DEFAULT_INSTRUMENT_SYMBOLS)
    .order("sort_order")
    .order("symbol");
  if (activeOnly) query = query.eq("is_active", true);
  const { data } = await query;
  return (data ?? []) as Instrument[];
}
