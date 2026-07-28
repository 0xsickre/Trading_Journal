"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  POSITION_FIELD_NAMES,
  NUMERIC_FIELDS,
  ARRAY_FIELD_NAMES,
} from "@/lib/journal/form-config";
import { computeStatus, isValidFill } from "@/lib/journal/trade-lifecycle";
import { getFailedFtmoAccountIds } from "@/lib/journal/ftmo-status";
import { getInstrumentSpecs, instrumentSnapshot } from "@/lib/journal/instruments";

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
  /** User choice when no fills: planned vs active (maps to planned/open). */
  trade_phase?: "planned" | "active" | null;
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
    .filter(isValidFill)
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

function resolveStatus(
  execs: ExecutionInput[],
  tradePhase?: "planned" | "active" | null,
  currentStatus?: string | null,
) {
  const phase = execs.length > 0 ? "active" : tradePhase;
  const manual =
    currentStatus === "missed" && execs.length === 0
      ? "missed"
      : phase === "active"
        ? "open"
        : "planned";

  const status = computeStatus(execs, manual);
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
  // Freeze: block new trades on an FTMO account that broke a rule.
  if (input.account_id) {
    const failed = await getFailedFtmoAccountIds();
    if (failed.has(input.account_id)) {
      return {
        ok: false as const,
        error:
          "FTMO nalog je zamrznut — pravilo je prekršeno. Resetuj izazov u Settings da nastaviš.",
      };
    }
  }

  const supabase = await createClient();
  const fields = sanitizeFields(input.fields);
  const execs = cleanExecs(input.executions);
  const statusPatch = resolveStatus(
    execs,
    input.trade_phase,
    input.current_status,
  );

  // Freeze the contract spec onto the trade. Without this, later edits to the
  // instrument would retroactively rewrite this trade's P&L.
  const symbol = typeof fields.instrument === "string" ? fields.instrument : null;
  const snapshot = instrumentSnapshot(
    symbol,
    await getInstrumentSpecs([symbol]),
  );

  const { data: pos, error: posErr } = await supabase
    .from("tj_positions")
    .insert({
      ...fields,
      account_id: input.account_id,
      trade_no: input.trade_no,
      ...statusPatch,
      ...snapshot,
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
  const statusPatch = resolveStatus(
    execs,
    input.trade_phase,
    input.current_status,
  );

  // Re-snapshot the contract spec ONLY when the trade moves to a different
  // symbol, or when it predates the snapshot column. Re-stamping on every save
  // would pull in an edited point value and undo the whole point of freezing it.
  const { data: prevPos } = await supabase
    .from("tj_positions")
    .select("instrument, point_value_at_trade")
    .eq("id", id)
    .maybeSingle();

  const symbol = typeof fields.instrument === "string" ? fields.instrument : null;
  const symbolChanged = prevPos != null && prevPos.instrument !== symbol;
  const snapshot =
    symbolChanged || prevPos?.point_value_at_trade == null
      ? instrumentSnapshot(symbol, await getInstrumentSpecs([symbol]))
      : {};

  const { error: upErr } = await supabase
    .from("tj_positions")
    .update({
      ...fields,
      account_id: input.account_id,
      trade_no: input.trade_no,
      ...statusPatch,
      ...snapshot,
      ...(execs.length > 0 ? { needs_review: false } : {}),
    })
    .eq("id", id);
  if (upErr) return { ok: false as const, error: upErr.message };

  // Delete + insert in ONE transaction. Doing it as two round trips left a
  // window where the trade had no fills at all — reading as planned with null
  // P&L to any concurrent render — and the application-level rollback could
  // itself fail and lose the fills for good.
  const { error: exErr } = await supabase.rpc("tj_replace_executions", {
    p_position_id: id,
    p_executions: execs,
  });
  if (exErr) return { ok: false as const, error: exErr.message };

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

/** Planned → Active without fills (manual) or confirm after import. */
export async function activateTrade(id: string) {
  const supabase = await createClient();

  const [{ data: pos }, { count }] = await Promise.all([
    supabase.from("tj_positions").select("status").eq("id", id).maybeSingle(),
    supabase
      .from("tj_executions")
      .select("id", { count: "exact", head: true })
      .eq("position_id", id),
  ]);

  if (!pos) return { ok: false as const, error: "Trade not found" };
  if (pos.status === "missed") {
    return { ok: false as const, error: "Missed trade — restore to planned first" };
  }
  if (pos.status !== "planned") {
    return { ok: true as const, id };
  }
  if ((count ?? 0) > 0) {
    return { ok: false as const, error: "Trade already has fills — refresh the page" };
  }

  const { error } = await supabase
    .from("tj_positions")
    .update({ status: "open", needs_review: false })
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
