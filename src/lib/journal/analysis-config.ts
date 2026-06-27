// Declarative config for the extra "data" factors logged with each bias
// analysis. Single source of truth for both the form (which dropdowns to
// render) and the combo analytics (which columns count as factors).

export type AnalysisGroup = "COT" | "Macro" | "Vol/Risk";

export type AnalysisFactor = {
  name: string; // tj_bias_analyses column === option list key
  label: string;
  listKey: string;
  group: AnalysisGroup;
};

export const ANALYSIS_FACTORS: AnalysisFactor[] = [
  // 1) COT — smart-money positioning
  { name: "cot_score", label: "COT Score", listKey: "cot_score", group: "COT" },
  { name: "cot_verdict", label: "COT Verdict", listKey: "cot_verdict", group: "COT" },
  { name: "cot_idx_3y", label: "COT idx 3Y", listKey: "cot_idx_3y", group: "COT" },
  { name: "cot_flow", label: "Flow", listKey: "cot_flow", group: "COT" },
  { name: "cot_confidence", label: "Confidence", listKey: "cot_confidence", group: "COT" },
  { name: "seasonality", label: "Seasonality", listKey: "seasonality", group: "COT" },
  { name: "cot_timing", label: "COT Timing", listKey: "cot_timing", group: "COT" },

  // 2) Macro — broader context
  { name: "rates_regime", label: "Rates regime", listKey: "rates_regime", group: "Macro" },
  { name: "yield_curve", label: "Yield kriva", listKey: "yield_curve", group: "Macro" },
  { name: "growth_bias", label: "Growth bias (Cu/Au)", listKey: "growth_bias", group: "Macro" },
  { name: "dxy_1m", label: "DXY ~1M smer", listKey: "dxy_1m", group: "Macro" },
  { name: "energy_stress", label: "Energy stress", listKey: "energy_stress", group: "Macro" },
  { name: "fx_policy_spread", label: "FX policy spread vs USD", listKey: "fx_policy_spread", group: "Macro" },

  // 3) Vol / risk — calm vs stressed
  { name: "vix_level", label: "VIX nivo", listKey: "vix_level", group: "Vol/Risk" },
  { name: "move_level", label: "MOVE nivo", listKey: "move_level", group: "Vol/Risk" },
  { name: "shield_active", label: "Shield Active", listKey: "shield_active", group: "Vol/Risk" },
  { name: "dxy_trend", label: "DXY trend", listKey: "dxy_trend", group: "Vol/Risk" },
];

export const ANALYSIS_FACTOR_NAMES = ANALYSIS_FACTORS.map((f) => f.name);

export const ANALYSIS_GROUPS: AnalysisGroup[] = ["COT", "Macro", "Vol/Risk"];

export function factorsByGroup(group: AnalysisGroup): AnalysisFactor[] {
  return ANALYSIS_FACTORS.filter((f) => f.group === group);
}

export const ANALYSIS_FACTOR_LABEL: Record<string, string> = Object.fromEntries(
  ANALYSIS_FACTORS.map((f) => [f.name, f.label]),
);
