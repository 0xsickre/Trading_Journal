// Declarative config for the extra "data" factors logged with each bias
// analysis. Single source of truth for the form, the storage scope of each
// factor, and the combo analytics.
//
// Scope = where a factor naturally lives ("enter once, reuse"):
//   - "global": one weekly snapshot shared by all symbols  (tj_market_context)
//   - "leg":    per currency / underlying, reused per pair  (tj_cot_legs)
//   - "pair":   pair-level COT, entered on the analysis      (tj_bias_analyses)
// For single instruments (DXY/NDX/SPX/XAU) all 7 COT fields live on the leg
// card (SINGLE_LEG_FACTORS); their pair-level columns stay empty.

export type AnalysisGroup = "COT" | "Macro" | "Vol/Risk";
export type AnalysisScope = "global" | "leg" | "pair";

export type AnalysisFactor = {
  name: string; // tj_* column === option list key
  label: string;
  listKey: string;
  group: AnalysisGroup;
  scope: AnalysisScope;
};

export const ANALYSIS_FACTORS: AnalysisFactor[] = [
  // 1) COT — smart-money positioning. Every field is a low-cardinality bucket so
  // it can be correlated with outcomes ("what works when"), not an exact number.
  { name: "cot_score", label: "COT Score", listKey: "cot_score", group: "COT", scope: "pair" },
  { name: "cot_verdict", label: "COT Verdict", listKey: "cot_verdict", group: "COT", scope: "pair" },
  { name: "cot_idx_3y", label: "COT idx 3Y", listKey: "cot_idx_3y", group: "COT", scope: "leg" },
  { name: "cot_flow", label: "Flow", listKey: "cot_flow", group: "COT", scope: "leg" },
  // Spec Z-score bucketed — the key "don't chase crowded shorts" squeeze signal.
  { name: "cot_crowding", label: "COT crowding", listKey: "cot_crowding", group: "COT", scope: "leg" },
  { name: "oi_trend", label: "OI trend", listKey: "oi_trend", group: "COT", scope: "leg" },

  // 2) Macro — broader context
  { name: "rates_regime", label: "Rates regime", listKey: "rates_regime", group: "Macro", scope: "global" },
  { name: "yield_curve", label: "Yield kriva", listKey: "yield_curve", group: "Macro", scope: "global" },
  { name: "dxy_direction", label: "DXY smer", listKey: "dxy_direction", group: "Macro", scope: "global" },
  { name: "fx_policy_spread", label: "FX policy spread vs USD", listKey: "fx_policy_spread", group: "Macro", scope: "leg" },

  // 3) Vol / risk — calm vs stressed
  { name: "vix_level", label: "VIX nivo", listKey: "vix_level", group: "Vol/Risk", scope: "global" },
  // Credit/liquidity gate (HY OAS + NFCI + net liquidity) for indices/gold.
  { name: "risk_regime", label: "Risk regime", listKey: "risk_regime", group: "Vol/Risk", scope: "global" },
];

export const ANALYSIS_FACTOR_NAMES = ANALYSIS_FACTORS.map((f) => f.name);

export const ANALYSIS_GROUPS: AnalysisGroup[] = ["COT", "Macro", "Vol/Risk"];

export function factorsByGroup(group: AnalysisGroup): AnalysisFactor[] {
  return ANALYSIS_FACTORS.filter((f) => f.group === group);
}

export const ANALYSIS_FACTOR_LABEL: Record<string, string> = Object.fromEntries(
  ANALYSIS_FACTORS.map((f) => [f.name, f.label]),
);

// --- Scope groupings ------------------------------------------------------

export const GLOBAL_FACTORS = ANALYSIS_FACTORS.filter((f) => f.scope === "global");
export const LEG_FACTORS = ANALYSIS_FACTORS.filter((f) => f.scope === "leg");
export const PAIR_FACTORS = ANALYSIS_FACTORS.filter((f) => f.scope === "pair");

/**
 * Factors shown on a single instrument's leg card: all COT fields direct
 * (the per-leg COT fields + the otherwise pair-level score/verdict), since a
 * single instrument's COT is read 1:1, not split across two legs.
 */
export const SINGLE_LEG_FACTORS = ANALYSIS_FACTORS.filter(
  (f) => f.group === "COT",
);

export const GLOBAL_FACTOR_NAMES = GLOBAL_FACTORS.map((f) => f.name);
export const LEG_FACTOR_NAMES = LEG_FACTORS.map((f) => f.name);
export const PAIR_FACTOR_NAMES = PAIR_FACTORS.map((f) => f.name);
export const SINGLE_LEG_FACTOR_NAMES = SINGLE_LEG_FACTORS.map((f) => f.name);

// --- Symbol -> legs -------------------------------------------------------

export type SymbolLegs = {
  kind: "pair" | "single";
  legs: string[]; // currencies for pairs; one underlying for singles
};

/** Watchlist symbol -> its COT legs. Drives leg cards + factor resolution. */
export const SYMBOL_LEGS: Record<string, SymbolLegs> = {
  EURUSD: { kind: "pair", legs: ["EUR", "USD"] },
  GBPUSD: { kind: "pair", legs: ["GBP", "USD"] },
  USDJPY: { kind: "pair", legs: ["USD", "JPY"] },
  GBPJPY: { kind: "pair", legs: ["GBP", "JPY"] },
  EURJPY: { kind: "pair", legs: ["EUR", "JPY"] },
  DXY: { kind: "single", legs: ["DXY"] },
  NAS100USD: { kind: "single", legs: ["NDX"] },
  SPX500USD: { kind: "single", legs: ["SPX"] },
  XAUUSD: { kind: "single", legs: ["XAU"] },
};

export function legsForSymbol(symbol: string | null | undefined): string[] {
  if (!symbol) return [];
  return SYMBOL_LEGS[symbol]?.legs ?? [];
}

export function isSingleSymbol(symbol: string | null | undefined): boolean {
  if (!symbol) return false;
  return SYMBOL_LEGS[symbol]?.kind === "single";
}

export function isPairSymbol(symbol: string | null | undefined): boolean {
  if (!symbol) return false;
  return SYMBOL_LEGS[symbol]?.kind === "pair";
}

/** Human label for a leg / underlying code. */
export const LEG_LABELS: Record<string, string> = {
  EUR: "EUR",
  USD: "USD",
  GBP: "GBP",
  JPY: "JPY",
  DXY: "DXY",
  NDX: "Nasdaq 100",
  SPX: "S&P 500",
  XAU: "Gold",
};

export function legLabel(code: string): string {
  return LEG_LABELS[code] ?? code;
}

/** Every distinct underlying across the watchlist (for building leg cards). */
export const ALL_LEGS: string[] = Array.from(
  new Set(Object.values(SYMBOL_LEGS).flatMap((s) => s.legs)),
);

/** FX currency legs vs single-instrument underlyings. */
export const FX_CURRENCY_LEGS: string[] = Array.from(
  new Set(
    Object.values(SYMBOL_LEGS)
      .filter((s) => s.kind === "pair")
      .flatMap((s) => s.legs),
  ),
);

export const SINGLE_UNDERLYINGS: string[] = Array.from(
  new Set(
    Object.values(SYMBOL_LEGS)
      .filter((s) => s.kind === "single")
      .flatMap((s) => s.legs),
  ),
);

/** Which factor names apply to a given leg, based on whether it's FX vs single. */
export function factorsForLeg(code: string): AnalysisFactor[] {
  return SINGLE_UNDERLYINGS.includes(code) ? SINGLE_LEG_FACTORS : LEG_FACTORS;
}
