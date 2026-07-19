"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  POSITION_FIELD_NAMES,
  NUMERIC_FIELDS,
  ARRAY_FIELD_NAMES,
} from "@/lib/journal/form-config";
import { computeStatus } from "@/lib/journal/trade-lifecycle";

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
  fields: Record<string, string | number | string[] | null>;
  executions: ExecutionInput[];
  current_status?: string | null;
};

function sanitizeFields(fields: Record<string, string | number | string[] | null>) {
  const out: Record<string, string | number | string[] | null> = {};
  for (const key of POSITION_FIELD_NAMES) {
    if (!(key in fields)) continue;
    const raw = fields[key];
    if (ARRAY_FIELD_NAMES.has(key)) {
      const arr = Array.isArray(raw)
        ? raw.map((s) => String(s).trim()).filter(Boolean)
        : [];
      out[key] = arr;
    } else if (NUMERIC_FIELDS.has(key)) {
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

function resolveStatus(execs: ExecutionInput[], currentStatus?: string | null) {
  const status = computeStatus(execs, currentStatus);
  const patch: Record<string, string | null> = { status };

  if (execs.length > 0) {
    patch.missed_at = null;
    patch.miss_reason = null;
  } else if (status === "planned") {
    patch.missed_at = null;
    patch.miss_reason = null;
  }

  return patch;
}

export async function createTrade(input: TradeInput) {
  const supabase = await createClient();
  const fields = sanitizeFields(input.fields);
  const execs = cleanExecs(input.executions);
  const statusPatch = resolveStatus(execs, input.current_status);

  const { data: pos, error: posErr } = await supabase
    .from("tj_positions")
    .insert({
      ...fields,
      account_id: input.account_id,
      trade_no: input.trade_no,
      ...statusPatch,
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
  const statusPatch = resolveStatus(execs, input.current_status);

  const { error: upErr } = await supabase
    .from("tj_positions")
    .update({
      ...fields,
      account_id: input.account_id,
      trade_no: input.trade_no,
      ...statusPatch,
    })
    .eq("id", id);
  if (upErr) return { ok: false as const, error: upErr.message };

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

export async function markTradeMissed(
  id: string,
  input?: { miss_reason?: string | null; notes?: string | null },
) {
  const supabase = await createClient();

  const [{ data: pos }, { count }] = await Promise.all([
    supabase.from("tj_positions").select("status, trade_journal_notes").eq("id", id).maybeSingle(),
    supabase
      .from("tj_executions")
      .select("id", { count: "exact", head: true })
      .eq("position_id", id),
  ]);

  if (!pos) return { ok: false as const, error: "Trade not found" };
  if ((count ?? 0) > 0) {
    return { ok: false as const, error: "Cannot mark a trade with fills as missed" };
  }
  if (pos.status === "missed") {
    return { ok: false as const, error: "Trade is already missed" };
  }

  const notes = input?.notes?.trim();
  const mergedNotes =
    notes && notes.length > 0
      ? [pos.trade_journal_notes, notes].filter(Boolean).join("\n\n")
      : pos.trade_journal_notes;

  const { error } = await supabase
    .from("tj_positions")
    .update({
      status: "missed",
      missed_at: new Date().toISOString(),
      miss_reason: input?.miss_reason?.trim() || null,
      trade_journal_notes: mergedNotes,
    })
    .eq("id", id);

  if (error) return { ok: false as const, error: error.message };

  revalidatePath("/journal");
  revalidatePath(`/trades/${id}`);
  revalidatePath("/", "layout");
  return { ok: true as const, id };
}

export async function restoreTradeToPlanned(id: string) {
  const supabase = await createClient();

  const [{ data: pos }, { count }] = await Promise.all([
    supabase.from("tj_positions").select("status").eq("id", id).maybeSingle(),
    supabase
      .from("tj_executions")
      .select("id", { count: "exact", head: true })
      .eq("position_id", id),
  ]);

  if (!pos) return { ok: false as const, error: "Trade not found" };
  if (pos.status !== "missed") {
    return { ok: false as const, error: "Only missed trades can be restored to planned" };
  }
  if ((count ?? 0) > 0) {
    return { ok: false as const, error: "Cannot restore a trade with fills" };
  }

  const { error } = await supabase
    .from("tj_positions")
    .update({
      status: "planned",
      missed_at: null,
      miss_reason: null,
    })
    .eq("id", id);

  if (error) return { ok: false as const, error: error.message };

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
