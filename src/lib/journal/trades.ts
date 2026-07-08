import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { TradeFormInitial } from "@/components/journal/trade-form";
import type { PositionStat, TradeRow } from "./types";

export type { PositionStat, TradeRow } from "./types";

/** Position joined with its derived stats — the row shape for the journal grid. */
export type TradeWithStats = TradeRow;

type RawPosition = Record<string, unknown> & {
  id: string;
  account_id: string | null;
  trade_no: number | null;
};

export async function getTradesWithStats(
  accountId?: string | null,
): Promise<TradeWithStats[]> {
  const supabase = await createClient();

  let posQ = supabase.from("tj_positions").select("*").order("created_at", {
    ascending: false,
  });
  if (accountId) posQ = posQ.eq("account_id", accountId);

  const [{ data: positions }, { data: stats }] = await Promise.all([
    posQ,
    supabase.from("tj_position_stats").select("*"),
  ]);

  const statById = new Map<string, PositionStat>();
  for (const s of (stats ?? []) as PositionStat[]) {
    if (s.position_id) statById.set(s.position_id, s);
  }

  return ((positions ?? []) as RawPosition[]).map(
    (p) =>
      ({
        ...p,
        stats: statById.get(p.id) ?? null,
      }) as TradeRow,
  );
}

export async function getTradeForEdit(
  id: string,
): Promise<TradeFormInitial | null> {
  const supabase = await createClient();
  const [{ data: pos }, { data: execs }] = await Promise.all([
    supabase.from("tj_positions").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("tj_executions")
      .select("side,price,qty,executed_at,fee,swap_funding")
      .eq("position_id", id)
      .order("executed_at"),
  ]);
  if (!pos) return null;

  const { id: _id, account_id, trade_no, ...rest } = pos as RawPosition;
  // Keep only the dynamic field columns (sanitize handles the rest on save).
  const fields: Record<string, string | number | string[] | null> = {};
  for (const [k, v] of Object.entries(rest)) {
    if (v == null) continue;
    if (typeof v === "string" || typeof v === "number") fields[k] = v;
    if (Array.isArray(v)) fields[k] = v.filter((x) => typeof x === "string");
  }

  return {
    id,
    account_id: account_id ?? null,
    trade_no: trade_no ?? null,
    status: (pos as RawPosition & { status?: string }).status ?? "open",
    fields,
    executions: (execs ?? []).map((e) => ({
      side: e.side as "entry" | "exit",
      price: Number(e.price),
      qty: Number(e.qty),
      executed_at: e.executed_at as string,
      fee: Number(e.fee),
      swap_funding: Number(e.swap_funding),
    })),
  };
}
