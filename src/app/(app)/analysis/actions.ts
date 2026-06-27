"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { BiasStatus, BiasValue } from "@/lib/journal/types";
import { ANALYSIS_FACTOR_NAMES } from "@/lib/journal/analysis-config";

export type BiasInput = {
  instrument: string | null;
  bias: BiasValue;
  start_date: string; // YYYY-MM-DD
  period_weeks: number;
  notes: string | null;
  chart_url: string | null;
  // Optional data factors (COT / Macro / Vol). Keyed by column name.
  factors?: Record<string, string | null>;
};

const BIAS_VALUES: BiasValue[] = ["bullish", "bearish", "neutral"];

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
  const start =
    /^\d{4}-\d{2}-\d{2}$/.test(input.start_date)
      ? input.start_date
      : new Date().toISOString().slice(0, 10);
  const clean = (v: string | null) => {
    const t = (v ?? "").trim();
    return t === "" ? null : t;
  };
  const factors: Record<string, string | null> = {};
  for (const name of ANALYSIS_FACTOR_NAMES) {
    factors[name] = clean(input.factors?.[name] ?? null);
  }
  return {
    instrument: clean(input.instrument),
    bias,
    start_date: start,
    period_weeks: weeks,
    end_date: computeEndDate(start, weeks),
    conviction: null,
    notes: clean(input.notes),
    chart_url: clean(input.chart_url),
    ...factors,
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
