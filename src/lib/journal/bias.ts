import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { BiasAnalysis, CotLeg, MarketContext } from "./types";

// Relocated factor values now live in tj_market_context / tj_cot_legs; the
// analysis row keeps only its identity, period, status and pair-level COT.
const COLUMNS =
  "id,instrument,bias,start_date,period_weeks,end_date,status,notes,chart_url,closed_at,created_at,updated_at,week_start,cot_score,cot_verdict,cot_confidence";

export async function getBiasAnalyses(): Promise<BiasAnalysis[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tj_bias_analyses")
    .select(COLUMNS)
    .order("created_at", { ascending: false });
  return (data ?? []) as BiasAnalysis[];
}

const CONTEXT_COLUMNS =
  "id,week_start,rates_regime,yield_curve,growth_bias,dxy_1m,vix_level,move_level,shield_active,dxy_trend,created_at,updated_at";

export async function getMarketContexts(): Promise<MarketContext[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tj_market_context")
    .select(CONTEXT_COLUMNS)
    .order("week_start", { ascending: false });
  return (data ?? []) as MarketContext[];
}

const LEG_COLUMNS =
  "id,week_start,underlying,cot_score,cot_verdict,cot_confidence,cot_idx_3y,cot_flow,seasonality,cot_timing,fx_policy_spread,energy_stress,created_at,updated_at";

export async function getCotLegs(): Promise<CotLeg[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tj_cot_legs")
    .select(LEG_COLUMNS)
    .order("week_start", { ascending: false });
  return (data ?? []) as CotLeg[];
}

export type BiasStats = {
  total: number;
  open: number;
  closed: number;
  wins: number;
  losses: number;
  winRate: number; // %, over closed (win + loss)
};

export function biasStats(rows: BiasAnalysis[]): BiasStats {
  let open = 0,
    wins = 0,
    losses = 0;
  for (const r of rows) {
    if (r.status === "win") wins++;
    else if (r.status === "loss") losses++;
    else open++;
  }
  const closed = wins + losses;
  return {
    total: rows.length,
    open,
    closed,
    wins,
    losses,
    winRate: closed > 0 ? (wins / closed) * 100 : 0,
  };
}

export type BiasBreakdownRow = {
  key: string;
  total: number;
  open: number;
  wins: number;
  losses: number;
  winRate: number;
};

/** Group analyses by a field (e.g. instrument or bias) -> hit-rate. */
export function biasBreakdown(
  rows: BiasAnalysis[],
  field: "instrument" | "bias",
): BiasBreakdownRow[] {
  const groups = new Map<string, BiasAnalysis[]>();
  for (const r of rows) {
    const raw = r[field];
    const key = typeof raw === "string" && raw ? raw : "—";
    const arr = groups.get(key) ?? [];
    arr.push(r);
    groups.set(key, arr);
  }
  const out: BiasBreakdownRow[] = [];
  for (const [key, arr] of groups) {
    const s = biasStats(arr);
    out.push({
      key,
      total: s.total,
      open: s.open,
      wins: s.wins,
      losses: s.losses,
      winRate: s.winRate,
    });
  }
  return out.sort((a, b) => b.winRate - a.winRate || b.total - a.total);
}
