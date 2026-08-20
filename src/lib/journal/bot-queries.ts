import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { BotEventRow } from "./bot-events";

export type BotToken = {
  id: string;
  label: string;
  token_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

export type BrokerSymbolMap = {
  id: string;
  broker: string;
  broker_symbol: string;
  instrument: string;
  units_per_qty: number;
};

/**
 * `token_hash` is never selected.
 *
 * It is only ever written, and only ever compared inside `tj_bot_ingest`.
 * Pulling it into the app would put a credential-equivalent value into a render
 * tree and a Next.js RSC payload for no reason at all.
 */
export async function getBotTokens(): Promise<BotToken[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tj_bot_tokens")
    .select("id,label,token_prefix,created_at,last_used_at,revoked_at")
    .order("created_at", { ascending: false });
  return (data ?? []) as BotToken[];
}

export async function getBrokerSymbolMaps(): Promise<BrokerSymbolMap[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tj_broker_symbol_map")
    .select("id,broker,broker_symbol,instrument,units_per_qty")
    .order("broker_symbol");
  return (data ?? []) as BrokerSymbolMap[];
}

/**
 * Quarantined events, newest first.
 *
 * Bounded rather than paged: this list is a to-do queue, and a queue long
 * enough to need paging is itself the finding. The count below is read
 * separately with `head: true` so the panel can say "200 of 4 300" honestly
 * instead of implying the cap is the total — PostgREST truncates at
 * `db-max-rows` with HTTP 200 and no error, which is exactly how a partial list
 * comes to be read as a complete one.
 */
export async function getQuarantinedEvents(limit = 200): Promise<BotEventRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tj_bot_events")
    .select("id,broker,broker_account,event_key,kind,payload,status,reason,position_id,received_at")
    .eq("status", "quarantined")
    .order("received_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as BotEventRow[];
}

export async function countQuarantinedEvents(): Promise<number | null> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("tj_bot_events")
    .select("id", { count: "exact", head: true })
    .eq("status", "quarantined");
  // null, not 0: "we could not find out" must not render as "nothing is wrong".
  return error ? null : (count ?? 0);
}
