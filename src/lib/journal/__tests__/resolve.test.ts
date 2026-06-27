import { describe, it, expect } from "vitest";
import {
  resolveAnalysisFactors,
  contextByWeek,
  legByKey,
} from "@/lib/journal/resolve";
import type { BiasAnalysis, CotLeg, MarketContext } from "@/lib/journal/types";

const WK = "2026-06-22"; // Monday of 2026-06-27

function analysis(over: Partial<BiasAnalysis>): BiasAnalysis {
  return {
    id: "a1",
    instrument: "EURUSD",
    bias: "bullish",
    start_date: "2026-06-27",
    period_weeks: 1,
    end_date: null,
    status: "open",
    notes: null,
    chart_url: null,
    closed_at: null,
    created_at: "",
    updated_at: "",
    week_start: WK,
    cot_score: null,
    cot_verdict: null,
    cot_confidence: null,
    ...over,
  };
}

function context(over: Partial<MarketContext>): MarketContext {
  return {
    id: "c1",
    week_start: WK,
    rates_regime: null,
    yield_curve: null,
    growth_bias: null,
    dxy_1m: null,
    vix_level: null,
    move_level: null,
    shield_active: null,
    dxy_trend: null,
    created_at: "",
    updated_at: "",
    ...over,
  };
}

function leg(over: Partial<CotLeg>): CotLeg {
  return {
    id: "l1",
    week_start: WK,
    underlying: "EUR",
    cot_score: null,
    cot_verdict: null,
    cot_confidence: null,
    cot_idx_3y: null,
    cot_flow: null,
    seasonality: null,
    cot_timing: null,
    fx_policy_spread: null,
    energy_stress: null,
    created_at: "",
    updated_at: "",
    ...over,
  };
}

function valueOf(factors: { name: string; value: string }[], name: string) {
  return factors.find((f) => f.name === name)?.value;
}

describe("resolveAnalysisFactors — pair", () => {
  const a = analysis({
    instrument: "EURUSD",
    cot_score: "7-8",
    cot_verdict: "Bullish",
    cot_confidence: "High",
  });
  const ctx = [context({ vix_level: "<15", rates_regime: "Risk-on" })];
  const legs = [
    leg({ underlying: "EUR", cot_flow: "Healthy", cot_idx_3y: "80-100" }),
    leg({ underlying: "USD", cot_flow: "Weak" }),
  ];
  const factors = resolveAnalysisFactors(a, contextByWeek(ctx), legByKey(legs));

  it("includes bias", () => {
    expect(valueOf(factors, "bias")).toBe("Bullish");
  });

  it("includes global factors from the weekly context", () => {
    expect(valueOf(factors, "vix_level")).toBe("<15");
    expect(valueOf(factors, "rates_regime")).toBe("Risk-on");
  });

  it("includes pair-level COT from the analysis row", () => {
    expect(valueOf(factors, "cot_score")).toBe("7-8");
    expect(valueOf(factors, "cot_verdict")).toBe("Bullish");
    expect(valueOf(factors, "cot_confidence")).toBe("High");
  });

  it("namespaces leg factors per currency", () => {
    expect(valueOf(factors, "EUR:cot_flow")).toBe("Healthy");
    expect(valueOf(factors, "USD:cot_flow")).toBe("Weak");
    expect(valueOf(factors, "EUR:cot_idx_3y")).toBe("80-100");
  });
});

describe("resolveAnalysisFactors — single", () => {
  // Single instrument: pair COT columns on the analysis MUST be ignored;
  // all 7 COT fields come from the single leg card.
  const a = analysis({
    instrument: "XAUUSD",
    cot_score: "IGNORED",
    cot_verdict: "IGNORED",
    cot_confidence: "IGNORED",
  });
  const legs = [
    leg({
      underlying: "XAU",
      cot_score: "9-10",
      cot_verdict: "Bullish",
      cot_confidence: "High",
      cot_flow: "Healthy",
    }),
  ];
  const factors = resolveAnalysisFactors(a, new Map(), legByKey(legs));

  it("reads all COT from the leg card, not the analysis", () => {
    expect(valueOf(factors, "cot_score")).toBe("9-10");
    expect(valueOf(factors, "cot_verdict")).toBe("Bullish");
    expect(valueOf(factors, "cot_flow")).toBe("Healthy");
  });

  it("does not namespace single-instrument factors", () => {
    expect(valueOf(factors, "XAU:cot_flow")).toBeUndefined();
  });

  it("ignores the analysis row's pair COT columns for singles", () => {
    expect(factors.some((f) => f.value === "IGNORED")).toBe(false);
  });
});

describe("resolveAnalysisFactors — no shared records", () => {
  // Global + leg data live only in context/leg tables. With empty maps,
  // only bias + the analysis's own pair COT resolve.
  const a = analysis({ instrument: "EURUSD", cot_score: "5-6" });
  const factors = resolveAnalysisFactors(a, new Map(), new Map());

  it("still reads pair COT from the analysis row", () => {
    expect(valueOf(factors, "cot_score")).toBe("5-6");
  });

  it("produces no global or leg factors without shared records", () => {
    expect(valueOf(factors, "vix_level")).toBeUndefined();
    expect(valueOf(factors, "EUR:cot_flow")).toBeUndefined();
    expect(valueOf(factors, "USD:cot_flow")).toBeUndefined();
  });
});
