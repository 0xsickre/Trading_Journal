import { describe, expect, it } from "vitest";
import {
  computePlannedRewardR,
  computePositionSize,
  formatPlannedRewardR,
  inferDirectionFromPrices,
  parsePlannedRewardR,
  parseRiskPct,
  computeRiskAmount,
  matchRiskOption,
  riskPlanFieldVisible,
  thesisGroupVisible,
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

  it("scale-out plan appears with the target, not before it", () => {
    // How much comes off on the way is part of the same decision as where you
    // are going.
    expect(vis("scale_out_plan", 100, 98, null, 1)).toBe(false);
    expect(vis("scale_out_plan", 100, 98, 104, 1)).toBe(true);
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

describe("guard clauses that exist to refuse, not to compute", () => {
  it("parseRiskPct rejects everything that is not a positive number", () => {
    expect(parseRiskPct("1%")).toBe(1);
    expect(parseRiskPct(" 0.5 ")).toBe(0.5);
    for (const v of [null, undefined, "", "abc", "0", "-1", "%"]) {
      expect(parseRiskPct(v)).toBeNull();
    }
  });

  it("computePlannedRewardR refuses a short whose prices contradict it", () => {
    // A short needs stop ABOVE and target BELOW entry. Anything else is a typo,
    // and returning a number for it would put a fictional R:R on the plan.
    const rr = (stop: number, target: number) =>
      computePlannedRewardR({ direction: "Short", entry: 100, stop, target });
    expect(rr(105, 90)).toBeCloseTo(2, 10);
    expect(rr(95, 90)).toBeNull(); // stop below entry
    expect(rr(105, 110)).toBeNull(); // target above entry
  });

  it("computePlannedRewardR refuses a zero-width stop or target", () => {
    const rr = (stop: number, target: number) =>
      computePlannedRewardR({ direction: null, entry: 100, stop, target });
    expect(rr(100, 110)).toBeNull();
    expect(rr(95, 100)).toBeNull();
  });

  it("computePositionSize refuses a zero stop distance instead of dividing", () => {
    const size = (stop: number) =>
      computePositionSize({
        balance: 10_000,
        riskPct: 1,
        entry: 100,
        stop,
        pointValue: 1,
      });
    expect(size(100)).toBeNull();
    expect(size(95)).toBeCloseTo(20, 10);
  });

  it("computePositionSize refuses a non-positive balance", () => {
    expect(
      computePositionSize({
        balance: 0,
        riskPct: 1,
        entry: 100,
        stop: 95,
        pointValue: 1,
      }),
    ).toBeNull();
  });

  it("riskPlanFieldVisible reveals each field only once its inputs exist", () => {
    // entry, stop, target, riskPct — positional.
    expect(riskPlanFieldVisible("entry_price", null, null, null, null)).toBe(true);
    expect(riskPlanFieldVisible("stop_price", null, null, null, null)).toBe(false);
    expect(riskPlanFieldVisible("stop_price", 100, null, null, null)).toBe(true);
    expect(riskPlanFieldVisible("direction", 100, null, null, null)).toBe(false);
    expect(riskPlanFieldVisible("direction", 100, 95, null, null)).toBe(true);
    expect(riskPlanFieldVisible("risk_pct", 100, 95, null, null)).toBe(true);
    expect(riskPlanFieldVisible("position_size", 100, 95, null, null)).toBe(false);
    expect(riskPlanFieldVisible("position_size", 100, 95, null, 1)).toBe(true);
    expect(riskPlanFieldVisible("planned_rr", 100, 95, null, 1)).toBe(false);
    expect(riskPlanFieldVisible("planned_rr", 100, 95, 110, 1)).toBe(true);
    // Anything outside the progressive plan is always shown.
    expect(riskPlanFieldVisible("instrument", null, null, null, null)).toBe(true);
  });
});

describe("thesisGroupVisible", () => {
  it("stays hidden until entry AND stop define a trade", () => {
    // The regression this pins: the three fields it gates used to live inside
    // `risk_plan`, where `riskPlanFieldVisible` answers `true` for any name it
    // does not recognise. All three showed on a completely blank form — Entry
    // Price, then three large textareas — which is exactly what the progressive
    // reveal exists to prevent.
    expect(thesisGroupVisible(null, null)).toBe(false);
    expect(thesisGroupVisible(100, null)).toBe(false);
    expect(thesisGroupVisible(null, 98)).toBe(false);
    expect(thesisGroupVisible(100, 98)).toBe(true);
  });

  it("does not care whether the trade is long or short", () => {
    expect(thesisGroupVisible(100, 102)).toBe(true);
  });
});

describe("computeRiskAmount", () => {
  it("is the percentage of current equity", () => {
    expect(computeRiskAmount({ balance: 42_000, riskPct: 1 })).toBe(420);
    expect(computeRiskAmount({ balance: 42_000, riskPct: 0.25 })).toBe(105);
  });

  it("refuses rather than answering zero", () => {
    // Same contract as every other calculator here: a refusal must not render
    // as a confident 0, which reads as "you are risking nothing".
    expect(computeRiskAmount({ balance: 42_000, riskPct: null })).toBeNull();
    expect(computeRiskAmount({ balance: 0, riskPct: 1 })).toBeNull();
    expect(computeRiskAmount({ balance: -100, riskPct: 1 })).toBeNull();
    expect(computeRiskAmount({ balance: Number.NaN, riskPct: 1 })).toBeNull();
  });

  it("agrees with the sizing formula it was extracted from", () => {
    // computePositionSize = riskAmount / (stopDist × pointValue). One
    // implementation of the first step, so the two can never drift.
    const balance = 42_000;
    const riskPct = 1;
    const size = computePositionSize({
      balance,
      riskPct,
      entry: 100,
      stop: 98,
      pointValue: 1,
    });
    const risk = computeRiskAmount({ balance, riskPct });
    expect(size).toBeCloseTo(risk! / (2 * 1), 10);
  });
});

describe("matchRiskOption", () => {
  const OPTIONS = [{ value: "0.5%" }, { value: "1%" }, { value: "2%" }];

  it("finds the option a playbook default stands for", () => {
    expect(matchRiskOption(OPTIONS, 1)).toBe("1%");
    expect(matchRiskOption(OPTIONS, 0.5)).toBe("0.5%");
  });

  it("compares as numbers, not as strings", () => {
    // The user's list may spell it "1.0 %"; the playbook stores 1.
    expect(matchRiskOption([{ value: "1.0 %" }], 1)).toBe("1.0 %");
  });

  it("offers nothing when the list has no such option", () => {
    // Writing "3%" into a select without it would leave the control blank while
    // the form believed a risk was chosen — a blank that looks answered.
    expect(matchRiskOption(OPTIONS, 3)).toBeNull();
    expect(matchRiskOption([], 1)).toBeNull();
  });

  it("offers nothing for a playbook with no default", () => {
    expect(matchRiskOption(OPTIONS, null)).toBeNull();
    expect(matchRiskOption(OPTIONS, undefined)).toBeNull();
  });
});
