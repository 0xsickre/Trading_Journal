import { describe, it, expect } from "vitest";
import {
  computePriceExcursion,
  formatPriceMove,
  priceToUnits,
} from "@/lib/journal/price-excursion";

describe("computePriceExcursion", () => {
  const ref = 1.085;
  const high = 1.092;
  const low = 1.08;
  const close = 1.089;

  it("computes bullish MFE, MAE and close move", () => {
    const ex = computePriceExcursion({
      prevWeekClose: ref,
      periodHigh: high,
      periodLow: low,
      periodClose: close,
      finalBias: "bullish",
    });
    expect(ex?.mfe).toBeCloseTo(0.007);
    expect(ex?.mae).toBeCloseTo(-0.005);
    expect(ex?.closeMove).toBeCloseTo(0.004);
    expect(ex?.range).toBeCloseTo(0.012);
  });

  it("computes bearish MFE, MAE and close move", () => {
    const ex = computePriceExcursion({
      prevWeekClose: ref,
      periodHigh: high,
      periodLow: low,
      periodClose: close,
      finalBias: "bearish",
    });
    expect(ex?.mfe).toBeCloseTo(0.005);
    expect(ex?.mae).toBeCloseTo(-0.007);
    expect(ex?.closeMove).toBeCloseTo(-0.004);
  });

  it("returns null without reference price", () => {
    expect(
      computePriceExcursion({
        prevWeekClose: null,
        periodHigh: high,
        periodLow: low,
        periodClose: close,
        finalBias: "bullish",
      }),
    ).toBeNull();
  });

  it("neutral only sets close move and range", () => {
    const ex = computePriceExcursion({
      prevWeekClose: ref,
      periodHigh: high,
      periodLow: low,
      periodClose: close,
      finalBias: "neutral",
    });
    expect(ex?.mfe).toBeNull();
    expect(ex?.mae).toBeNull();
    expect(ex?.closeMove).toBeCloseTo(0.004);
    expect(ex?.range).toBeCloseTo(0.012);
  });
});

describe("formatPriceMove", () => {
  it("formats FX pips from tick size", () => {
    expect(formatPriceMove(0.007, 0.0001)).toBe("+70.0 pips");
    expect(formatPriceMove(-0.005, 0.0001)).toBe("-50.0 pips");
  });

  it("falls back to raw price without tick size", () => {
    expect(formatPriceMove(0.004, null)).toBe("+0.00400");
  });
});

describe("priceToUnits", () => {
  it("converts using tick size", () => {
    expect(priceToUnits(0.007, 0.0001)).toBeCloseTo(70);
  });
});
