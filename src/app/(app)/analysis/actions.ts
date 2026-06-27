"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { BiasStatus, BiasValue } from "@/lib/journal/types";
import {
  GLOBAL_FACTOR_NAMES,
  LEG_FACTOR_NAMES,
  SINGLE_LEG_FACTOR_NAMES,
  isSingleSymbol,
} from "@/lib/journal/analysis-config";
import { weekStart } from "@/lib/journal/week";
import type { TablesInsert } from "@/lib/supabase/types";

export type BiasInput = {
  instrument: string | null;
  bias: BiasValue;
  start_date: string; // YYYY-MM-DD
  period_weeks: number;
  notes: string | null;
  chart_url: string | null;
  // Pair-level COT (FX pairs only; nulled for single instruments).
  cot_score?: string | null;
  cot_verdict?: string | null;
  cot_confidence?: string | null;
};

const BIAS_VALUES: BiasValue[] = ["bullish", "bearish", "neutral"];

const LEG_COLUMNS = Array.from(
  new Set([...LEG_FACTOR_NAMES, ...SINGLE_LEG_FACTOR_NAMES]),
);

function clean(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
}

/** start_date (YYYY-MM-DD) + weeks*7 days -> YYYY-MM-DD (UTC-safe). */
function computeEndDate(startDate: string, weeks: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startDate);
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const end = new Date(ms + weeks * 7 * 86_400_000);
  return end.toISOString().slice(0, 10);
}

function sanitize(input: BiasInput) {
  const weeks =
    Number.isFinite(input.period_weeks) && input.period_weeks >= 1
      ? Math.floor(input.period_weeks)
      : 1;
  const bias: BiasValue = BIAS_VALUES.includes(input.bias)
    ? input.bias
    : "bullish";
  const start = /^\d{4}-\d{2}-\d{2}$/.test(input.start_date)
    ? input.start_date
    : new Date().toISOString().slice(0, 10);
  const instrument = clean(input.instrument);
  // Single instruments carry no pair-level COT — those come from the leg card.
  const single = isSingleSymbol(instrument);
  return {
    instrument,
    bias,
    start_date: start,
    period_weeks: weeks,
    end_date: computeEndDate(start, weeks),
    week_start: weekStart(start) || null,
    notes: clean(input.notes),
    chart_url: clean(input.chart_url),
    cot_score: single ? null : clean(input.cot_score),
    cot_verdict: single ? null : clean(input.cot_verdict),
    cot_confidence: single ? null : clean(input.cot_confidence),
  };
}

export async function createBiasAnalysis(input: BiasInput) {
  const supabase = await createClient();
  const fields = sanitize(input);

  const { data, error } = await supabase
    .from("tj_bias_analyses")
    .insert({ ...fields, status: "open" })
    .select("id")
    .single();
  if (error || !data)
    return { ok: false as const, error: error?.message ?? "Insert failed" };

  revalidatePath("/analysis");
  return { ok: true as const, id: data.id };
}

export async function updateBiasAnalysis(id: string, input: BiasInput) {
  const supabase = await createClient();
  const fields = sanitize(input);

  const { error } = await supabase
    .from("tj_bias_analyses")
    .update(fields)
    .eq("id", id);
  if (error) return { ok: false as const, error: error.message };

  revalidatePath("/analysis");
  return { ok: true as const, id };
}

export async function closeBiasAnalysis(id: string, outcome: "win" | "loss") {
  const supabase = await createClient();
  const { error } = await supabase
    .from("tj_bias_analyses")
    .update({ status: outcome, closed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false as const, error: error.message };

  revalidatePath("/analysis");
  return { ok: true as const, id };
}

/** Re-open a closed analysis (clear the outcome). */
export async function reopenBiasAnalysis(id: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("tj_bias_analyses")
    .update({ status: "open" as BiasStatus, closed_at: null })
    .eq("id", id);
  if (error) return { ok: false as const, error: error.message };

  revalidatePath("/analysis");
  return { ok: true as const, id };
}

export async function deleteBiasAnalysis(id: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("tj_bias_analyses")
    .delete()
    .eq("id", id);
  if (error) return { ok: false as const, error: error.message };

  revalidatePath("/analysis");
  return { ok: true as const };
}

// --- Weekly context + per-leg COT (last-write-wins upserts) ---------------

async function authedClient() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

/** Upsert the weekly global market context (one row per user per week). */
export async function upsertMarketContext(
  week_start: string,
  fields: Record<string, string | null>,
) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week_start))
    return { ok: false as const, error: "Bad week" };
  const { supabase, user } = await authedClient();
  if (!user) return { ok: false as const, error: "Not authenticated" };

  const row: Record<string, string | null> = {
    user_id: user.id,
    week_start,
  };
  for (const name of GLOBAL_FACTOR_NAMES) row[name] = clean(fields[name]);

  const { error } = await supabase
    .from("tj_market_context")
    .upsert(row as TablesInsert<"tj_market_context">, {
      onConflict: "user_id,week_start",
    });
  if (error) return { ok: false as const, error: error.message };

  revalidatePath("/analysis");
  return { ok: true as const };
}

/** Upsert a per-currency / per-underlying COT card (one row per user/week/leg). */
export async function upsertCotLeg(
  week_start: string,
  underlying: string,
  fields: Record<string, string | null>,
) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week_start))
    return { ok: false as const, error: "Bad week" };
  const code = clean(underlying);
  if (!code) return { ok: false as const, error: "Missing leg" };
  const { supabase, user } = await authedClient();
  if (!user) return { ok: false as const, error: "Not authenticated" };

  const row: Record<string, string | null> = {
    user_id: user.id,
    week_start,
    underlying: code,
  };
  for (const name of LEG_COLUMNS) row[name] = clean(fields[name]);

  const { error } = await supabase
    .from("tj_cot_legs")
    .upsert(row as TablesInsert<"tj_cot_legs">, {
      onConflict: "user_id,week_start,underlying",
    });
  if (error) return { ok: false as const, error: error.message };

  revalidatePath("/analysis");
  return { ok: true as const };
}
