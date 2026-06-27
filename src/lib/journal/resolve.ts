// Client-safe resolver: flattens an analysis's effective factors across all
// three scopes (global / leg / pair) into a single list, so combos and the UI
// read one shape regardless of where each value is stored.
//
// Single-vs-pair rule (no double counting):
//   - pair:   pair COT (3) come from the analysis row; the 5 leg factors come
//             from each of the 2 legs, namespaced ("EUR:cot_flow").
//   - single: ALL 7 COT fields come from the single leg card; the analysis's
//             own pair COT columns are ignored.
// Global + leg data live solely in tj_market_context / tj_cot_legs.

import type {
  BiasAnalysis,
  CotLeg,
  MarketContext,
  ResolvedAnalysis,
  ResolvedFactor,
  BiasValue,
} from "./types";
import {
  GLOBAL_FACTORS,
  LEG_FACTORS,
  PAIR_FACTORS,
  SINGLE_LEG_FACTORS,
  isSingleSymbol,
  legsForSymbol,
  legLabel,
} from "./analysis-config";
import { weekStart } from "./week";

const BIAS_LABELS: Record<BiasValue, string> = {
  bullish: "Bullish",
  bearish: "Bearish",
  neutral: "Neutral",
};

/** Read a named string field off any record, normalising empty -> null. */
function field(obj: unknown, name: string): string | null {
  if (!obj || typeof obj !== "object") return null;
  const raw = (obj as Record<string, unknown>)[name];
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  return t === "" ? null : t;
}

export function contextByWeek(
  contexts: MarketContext[],
): Map<string, MarketContext> {
  const m = new Map<string, MarketContext>();
  for (const c of contexts) m.set(c.week_start, c);
  return m;
}

export function legByKey(legs: CotLeg[]): Map<string, CotLeg> {
  const m = new Map<string, CotLeg>();
  for (const l of legs) m.set(`${l.week_start}|${l.underlying}`, l);
  return m;
}

/** Effective flattened factors for one analysis. */
export function resolveAnalysisFactors(
  a: BiasAnalysis,
  ctxByWeek: Map<string, MarketContext>,
  legsByKey: Map<string, CotLeg>,
): ResolvedFactor[] {
  const out: ResolvedFactor[] = [];

  if (a.bias) {
    out.push({ name: "bias", label: "Bias", value: BIAS_LABELS[a.bias] ?? a.bias });
  }

  const wk = a.week_start || weekStart(a.start_date);
  const ctx = wk ? ctxByWeek.get(wk) : undefined;

  // Global (weekly) factors from the shared context.
  for (const f of GLOBAL_FACTORS) {
    const value = field(ctx, f.name);
    if (value) out.push({ name: f.name, label: f.label, value });
  }

  const legs = legsForSymbol(a.instrument);

  if (isSingleSymbol(a.instrument)) {
    // Single: all 7 COT fields from the one leg card (pair COT cols ignored).
    const leg = wk ? legsByKey.get(`${wk}|${legs[0]}`) : undefined;
    for (const f of SINGLE_LEG_FACTORS) {
      const value = field(leg, f.name);
      if (value) out.push({ name: f.name, label: f.label, value });
    }
  } else {
    // Pair: pair-level COT from the analysis row.
    for (const f of PAIR_FACTORS) {
      const value = field(a, f.name);
      if (value) out.push({ name: f.name, label: f.label, value });
    }
    // Per-leg factors, namespaced by currency.
    for (const code of legs) {
      const leg = wk ? legsByKey.get(`${wk}|${code}`) : undefined;
      for (const f of LEG_FACTORS) {
        const value = field(leg, f.name);
        if (value) {
          out.push({
            name: `${code}:${f.name}`,
            label: `${legLabel(code)} · ${f.label}`,
            value,
          });
        }
      }
    }
  }

  return out;
}

/** Resolve every analysis against the provided context + leg records. */
export function resolveAll(
  analyses: BiasAnalysis[],
  contexts: MarketContext[],
  legs: CotLeg[],
): ResolvedAnalysis[] {
  const ctxMap = contextByWeek(contexts);
  const legMap = legByKey(legs);
  return analyses.map((analysis) => ({
    analysis,
    factors: resolveAnalysisFactors(analysis, ctxMap, legMap),
  }));
}
