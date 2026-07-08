import { describe, it, expect } from "vitest";
import { bestCombos } from "@/lib/journal/combos";
import type {
  BiasAnalysis,
  ResolvedAnalysis,
  ResolvedFactor,
} from "@/lib/journal/types";

function ra(
  status: BiasAnalysis["status"],
  instrument: string,
  factors: ResolvedFactor[],
): ResolvedAnalysis {
  return {
    analysis: {
      id: Math.random().toString(36),
      instrument,
      bias: "bullish",
      technical_bias: "bullish",
      macro_bias: "bullish",
      bias_magnitude: null,
      alignment: null,
      event_risk: null,
      start_date: "2026-06-27",
      period_weeks: 1,
      end_date: null,
      status,
      notes: null,
      chart_url: null,
      closed_at: null,
      created_at: "",
      updated_at: "",
      week_start: "2026-06-22",
      cot_score: null,
      cot_verdict: null,
      cot_confidence: null,
      prev_week_close: null,
      period_high: null,
      period_low: null,
      period_close: null,
    },
    factors,
  };
}

const F = (name: string, value: string): ResolvedFactor => ({
  name,
  label: name,
  value,
});

describe("bestCombos", () => {
  it("computes win rate over closed analyses and honours minSample", () => {
    const rows: ResolvedAnalysis[] = [
      ra("win", "EURUSD", [F("final_bias", "Bullish"), F("vix_level", "<15")]),
      ra("win", "EURUSD", [F("final_bias", "Bullish"), F("vix_level", "<15")]),
      ra("loss", "EURUSD", [F("final_bias", "Bullish"), F("vix_level", "<15")]),
      // open rows are ignored
      ra("open", "EURUSD", [F("final_bias", "Bullish"), F("vix_level", "<15")]),
    ];

    const combos = bestCombos(rows, { minSample: 3, size: 2 });
    const bothFactors = combos.find((c) => c.factors.length === 2);
    expect(bothFactors).toBeDefined();
    expect(bothFactors!.wins).toBe(2);
    expect(bothFactors!.losses).toBe(1);
    expect(bothFactors!.total).toBe(3);
    expect(bothFactors!.winRate).toBeCloseTo((2 / 3) * 100);
  });

  it("drops combos below minSample", () => {
    const rows: ResolvedAnalysis[] = [
      ra("win", "EURUSD", [F("final_bias", "Bullish")]),
      ra("loss", "EURUSD", [F("final_bias", "Bearish")]),
    ];
    // Each distinct combo has sample 1 -> nothing passes minSample 3.
    expect(bestCombos(rows, { minSample: 3 })).toHaveLength(0);
  });

  it("filters by instrument", () => {
    const rows: ResolvedAnalysis[] = [
      ra("win", "EURUSD", [F("final_bias", "Bullish")]),
      ra("win", "EURUSD", [F("final_bias", "Bullish")]),
      ra("loss", "XAUUSD", [F("final_bias", "Bullish")]),
    ];
    const combos = bestCombos(rows, { instrument: "EURUSD", minSample: 2 });
    expect(combos).toHaveLength(1);
    expect(combos[0].wins).toBe(2);
    expect(combos[0].losses).toBe(0);
  });

  it("ranks technical bias alone at size 1", () => {
    const rows: ResolvedAnalysis[] = [
      ra("win", "EURUSD", [F("technical_bias", "Bullish")]),
      ra("win", "EURUSD", [F("technical_bias", "Bullish")]),
      ra("loss", "EURUSD", [F("technical_bias", "Bullish")]),
    ];
    const combos = bestCombos(rows, { minSample: 3, size: 1 });
    expect(combos).toHaveLength(1);
    expect(combos[0].factors[0].name).toBe("technical_bias");
    expect(combos[0].winRate).toBeCloseTo((2 / 3) * 100);
  });
});
