import { describe, expect, it } from "vitest";
import {
  computePlannedRewardR,
  computePositionSize,
  formatPlannedRewardR,
  inferDirectionFromPrices,
  parsePlannedRewardR,
  parseRiskPct,
  riskPlanFieldVisible,
} from "./plan-calculations";

describe("riskPlanFieldVisible", () => {
  const vis = (name: string, e: number | null, s: number | null, t: number | null, r: number | null) =>
    riskPlanFieldVisible(name, e, s, t, r);

  it("only entry when no prices", () => {
    expect(vis("entry_price", null, null, null, null)).toBe(true);
    expect(vis("stop_price", null, null, null, null)).toBe(false);
    expect(vis("target_price", null, null, null, null)).toBe(false);
  });

  it("entry + stop when entry set", () => {
    expect(vis("stop_price", 100, null, null, null)).toBe(true);
    expect(vis("target_price", 100, null, null, null)).toBe(false);
  });

  it("target and risk% after stop", () => {
    expect(vis("target_price", 100, 98, null, null)).toBe(true);
    expect(vis("risk_pct", 100, 98, null, null)).toBe(true);
    expect(vis("position_size", 100, 98, null, null)).toBe(false);
  });

  it("position size after risk%", () => {
    expect(vis("position_size", 100, 98, null, 1)).toBe(true);
    expect(vis("planned_rr", 100, 98, null, 1)).toBe(false);
  });

  it("planned R:R after target", () => {
    expect(vis("planned_rr", 100, 98, 104, 1)).toBe(true);
  });
});

describe("inferDirectionFromPrices", () => {
  it("stop below entry → Long", () => {
    expect(inferDirectionFromPrices(100, 98)).toBe("Long");
  });

  it("stop above entry → Short", () => {
    expect(inferDirectionFromPrices(100, 102)).toBe("Short");
  });

  it("equal prices → null", () => {
    expect(inferDirectionFromPrices(100, 100)).toBeNull();
  });

  it("missing price → null", () => {
    expect(inferDirectionFromPrices(null, 98)).toBeNull();
    expect(inferDirectionFromPrices(100, null)).toBeNull();
  });
});

describe("computePlannedRewardR", () => {
  it("long: entry 100, stop 98, target 104 → 2.00", () => {
    expect(
      computePlannedRewardR({
        direction: "Long",
        entry: 100,
        stop: 98,
        target: 104,
      }),
    ).toBeCloseTo(2);
  });

  it("short: entry 100, stop 102, target 96 → 2.00", () => {
    expect(
      computePlannedRewardR({
        direction: "Short",
        entry: 100,
        stop: 102,
        target: 96,
      }),
    ).toBeCloseTo(2);
  });

  it("long with target below entry → null", () => {
    expect(
      computePlannedRewardR({
        direction: "Long",
        entry: 100,
        stop: 98,
        target: 99,
      }),
    ).toBeNull();
  });

  it("abs fallback when direction missing", () => {
    expect(
      computePlannedRewardR({
        direction: null,
        entry: 100,
        stop: 98,
        target: 104,
      }),
    ).toBeCloseTo(2);
  });
});

describe("computePositionSize", () => {
  it("EURUSD 10k balance, 1% risk, 10 pip stop", () => {
    // risk $100 / (0.0010 * 100_000) = 1.0 lot
    const size = computePositionSize({
      balance: 10_000,
      riskPct: 1,
      entry: 1.1,
      stop: 1.099,
      pointValue: 100_000,
    });
    expect(size).toBeCloseTo(1);
  });

  it("null without risk%", () => {
    expect(
      computePositionSize({
        balance: 10_000,
        riskPct: null,
        entry: 1.1,
        stop: 1.099,
        pointValue: 100_000,
      }),
    ).toBeNull();
  });
});

describe("parseRiskPct", () => {
  it("parses percent strings", () => {
    expect(parseRiskPct("1%")).toBe(1);
    expect(parseRiskPct("0.5%")).toBe(0.5);
  });
});

describe("formatPlannedRewardR", () => {
  it("formats reward multiple", () => {
    expect(formatPlannedRewardR(2.45)).toBe("2.45");
  });
});

describe("parsePlannedRewardR", () => {
  it("parses plain reward multiple", () => {
    expect(parsePlannedRewardR("2.45")).toBeCloseTo(2.45);
  });

  it("parses legacy 1:X", () => {
    expect(parsePlannedRewardR("1:3.00")).toBe(3);
  });
});

describe("computePositionSize refuses to size without a contract spec", () => {
  const plan = { balance: 10_000, riskPct: 1, entry: 5000, stop: 4990 };

  it("returns null when the point value is unknown", () => {
    // The runtime guard always handled this (`null <= 0` coerces to true); what
    // it could not do was let a caller SAY "unknown", because the parameter was
    // a non-nullable `number`. That signature is what pushed `?? 1` into the
    // trade form, where 1 instead of 50 suggests an ES position 50x too large
    // and the submit handler writes it into position_size. Widening the type is
    // the fix; this pins the contract so the fallback cannot come back.
    expect(computePositionSize({ ...plan, pointValue: null })).toBeNull();
  });

  it("sizes correctly once the instrument is priced", () => {
    // risk 100 / (10 points * 50) = 0.2 contracts
    expect(computePositionSize({ ...plan, pointValue: 50 })).toBeCloseTo(0.2);
    // What the null case would have silently returned instead.
    expect(computePositionSize({ ...plan, pointValue: 1 })).toBeCloseTo(10);
  });

  it("still rejects a zero or negative point value", () => {
    expect(computePositionSize({ ...plan, pointValue: 0 })).toBeNull();
    expect(computePositionSize({ ...plan, pointValue: -50 })).toBeNull();
  });
});
