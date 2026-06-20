"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { POSITION_FIELD_NAMES, NUMERIC_FIELDS } from "@/lib/journal/form-config";

export type ExecutionInput = {
  side: "entry" | "exit";
  price: number;
  qty: number;
  executed_at: string; // UTC ISO
  fee: number;
  swap_funding: number;
};

export type TradeInput = {
  account_id: string | null;
  trade_no: number | null;
  fields: Record<string, string | number | null>;
  executions: ExecutionInput[];
};

function computeStatus(execs: ExecutionInput[]): "open" | "partial" | "closed" {
  const entryQty = execs
    .filter((e) => e.side === "entry")
    .reduce((s, e) => s + (e.qty || 0), 0);
  const exitQty = execs
    .filter((e) => e.side === "exit")
    .reduce((s, e) => s + (e.qty || 0), 0);
  if (exitQty <= 0) return "open";
  if (exitQty < entryQty) return "partial";
  return "closed";
}

function sanitizeFields(fields: Record<string, string | number | null>) {
  const out: Record<string, string | number | null> = {};
  for (const key of POSITION_FIELD_NAMES) {
    if (!(key in fields)) continue;
    const raw = fields[key];
    if (NUMERIC_FIELDS.has(key)) {
      const n =
        raw === "" || raw == null ? null : Number(raw);
      out[key] = n != null && Number.isFinite(n) ? n : null;
    } else {
      out[key] = raw === "" ? null : (raw as string | null);
    }
  }
  return out;
}

function cleanExecs(execs: ExecutionInput[]) {
  return execs
    .filter((e) => Number.isFinite(e.price) && Number.isFinite(e.qty) && e.qty > 0)
    .map((e) => ({
      side: e.side,
      price: Number(e.price),
      qty: Number(e.qty),
      executed_at: e.executed_at,
      fee: Number(e.fee) || 0,
      swap_funding: Number(e.swap_funding) || 0,
      source: "manual" as const,
    }));
}

export async function createTrade(input: TradeInput) {
  const supabase = await createClient();
  const fields = sanitizeFields(input.fields);
  const execs = cleanExecs(input.executions);

  const { data: pos, error: posErr } = await supabase
    .from("tj_positions")
    .insert({
      ...fields,
      account_id: input.account_id,
      trade_no: input.trade_no,
      status: computeStatus(execs),
      source: "manual",
    })
    .select("id")
    .single();
  if (posErr || !pos) return { ok: false as const, error: posErr?.message ?? "Insert failed" };

  if (execs.length > 0) {
    const { error: exErr } = await supabase
      .from("tj_executions")
      .insert(execs.map((e) => ({ ...e, position_id: pos.id })));
    if (exErr) {
      // roll back the orphan position
      await supabase.from("tj_positions").delete().eq("id", pos.id);
      return { ok: false as const, error: exErr.message };
    }
  }

  revalidatePath("/journal");
  revalidatePath("/", "layout");
  return { ok: true as const, id: pos.id };
}

export async function updateTrade(id: string, input: TradeInput) {
  const supabase = await createClient();
  const fields = sanitizeFields(input.fields);
  const execs = cleanExecs(input.executions);

  const { error: upErr } = await supabase
    .from("tj_positions")
    .update({
      ...fields,
      account_id: input.account_id,
      trade_no: input.trade_no,
      status: computeStatus(execs),
    })
    .eq("id", id);
  if (upErr) return { ok: false as const, error: upErr.message };

  // Replace fills (subjective fields on the position are untouched).
  await supabase.from("tj_executions").delete().eq("position_id", id);
  if (execs.length > 0) {
    const { error: exErr } = await supabase
      .from("tj_executions")
      .insert(execs.map((e) => ({ ...e, position_id: id })));
    if (exErr) return { ok: false as const, error: exErr.message };
  }

  revalidatePath("/journal");
  revalidatePath(`/trades/${id}`);
  revalidatePath("/", "layout");
  return { ok: true as const, id };
}

export async function deleteTrade(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("tj_positions").delete().eq("id", id);
  if (error) return { ok: false as const, error: error.message };
  revalidatePath("/journal");
  revalidatePath("/", "layout");
  return { ok: true as const };
}
