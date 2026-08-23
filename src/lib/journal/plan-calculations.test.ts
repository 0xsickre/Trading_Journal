import { describe, expect, it } from "vitest";
import {
  blendedPlannedRewardR,
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

  it("refuses anything that is not a positive multiple", () => {
    // `planned_rr` is stored as TEXT, so the column itself guarantees nothing —
    // this parser is the only validation between a stored string and every R
    // figure derived from a plan. A garbage value must come back null rather
    // than as NaN, which would spread silently through avg planned R and
    // target attainment.
    expect(parsePlannedRewardR("abc")).toBeNull();
    expect(parsePlannedRewardR("0")).toBeNull();
    expect(parsePlannedRewardR("-2")).toBeNull();
    expect(parsePlannedRewardR(null)).toBeNull();
    expect(parsePlannedRewardR("")).toBeNull();
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

  it("computePositionSize refuses a non-finite balance", () => {
    // `balance <= 0` does NOT catch these: both `NaN <= 0` and `Infinity <= 0`
    // are false, so a non-finite equity walks past the entry guard and is
    // stopped only by the `computeRiskAmount` refusal one line before the
    // division. That refusal is the sole thing standing between a corrupt
    // equity figure and a position size written into the trade, and it was
    // reachable but unexercised — the 100 % floor on this module is what
    // surfaced it.
    const size = (balance: number) =>
      computePositionSize({
        balance,
        riskPct: 1,
        entry: 100,
        stop: 95,
        pointValue: 1,
      });
    expect(size(Number.NaN)).toBeNull();
    expect(size(Number.POSITIVE_INFINITY)).toBeNull();
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

describe("blendedPlannedRewardR", () => {
  // Long from 100 with the stop at 90: one R is 10 points.
  const LONG = { direction: "Long", entry: 100, stop: 90 };

  it("is entry-to-target when nothing is scaled out", () => {
    expect(blendedPlannedRewardR({ ...LONG, target: 130, levels: [] })).toBe(3);
  });

  /**
   * The case that motivated this. 30 % at 1R, 30 % at 2R, the remaining 40 % at
   * 3R is a plan worth 0.3 + 0.6 + 1.2 = 2.1R. Reading the furthest level alone
   * would call it 3R and, because this is the DENOMINATOR of Target attainment,
   * mark the trader down for scaling out.
   */
  it("weighs each piece by the share of the position it closes", () => {
    const r = blendedPlannedRewardR({
      ...LONG,
      target: 130,
      levels: [
        { pct: 30, price: 110 },
        { pct: 30, price: 120 },
      ],
    });
    expect(r).toBeCloseTo(2.1, 10);
  });

  it("is neither the nearest nor the furthest level", () => {
    const r = blendedPlannedRewardR({
      ...LONG,
      target: 130,
      levels: [{ pct: 50, price: 110 }],
    })!;
    expect(r).toBeGreaterThan(1); // not the nearest
    expect(r).toBeLessThan(3); // not the furthest
    expect(r).toBeCloseTo(2, 10); // 0.5x1 + 0.5x3
  });

  it("needs no target when the levels close the whole position", () => {
    const r = blendedPlannedRewardR({
      ...LONG,
      target: null,
      levels: [
        { pct: 50, price: 110 },
        { pct: 50, price: 120 },
      ],
    });
    expect(r).toBeCloseTo(1.5, 10);
  });

  it("refuses when a remainder is left with nowhere to exit", () => {
    // 40 % of the position is unaccounted for and no target says where it goes.
    // A blend over the 60 % that IS known would silently describe a different,
    // smaller trade.
    expect(
      blendedPlannedRewardR({ ...LONG, target: null, levels: [{ pct: 60, price: 110 }] }),
    ).toBeNull();
  });

  it("refuses a level that closes none of the position", () => {
    // A level at 0 % (or below) takes nothing off, so it contributes nothing to
    // the blend while still claiming to be part of the plan. Weighting it would
    // quietly drop it; refusing says the plan is broken.
    expect(
      blendedPlannedRewardR({ ...LONG, target: 130, levels: [{ pct: 0, price: 110 }] }),
    ).toBeNull();
    expect(
      blendedPlannedRewardR({ ...LONG, target: 130, levels: [{ pct: -10, price: 110 }] }),
    ).toBeNull();
  });

  it("refuses a level priced on the losing side of entry", () => {
    // 95 is below a long's entry: that is not a take profit, and blending it as
    // a negative reward would produce a number that looks like an answer.
    expect(
      blendedPlannedRewardR({ ...LONG, target: 130, levels: [{ pct: 30, price: 95 }] }),
    ).toBeNull();
  });

  it("refuses percentages that add up to more than the position", () => {
    expect(
      blendedPlannedRewardR({
        ...LONG,
        target: 130,
        levels: [
          { pct: 70, price: 110 },
          { pct: 50, price: 120 },
        ],
      }),
    ).toBeNull();
  });

  it("weighs a short the same way", () => {
    // Short from 100, stop 110: one R is still 10 points, in the other direction.
    const r = blendedPlannedRewardR({
      direction: "Short",
      entry: 100,
      stop: 110,
      target: 70,
      levels: [
        { pct: 30, price: 90 },
        { pct: 30, price: 80 },
      ],
    });
    expect(r).toBeCloseTo(2.1, 10);
  });

  it("stays null when the trade has no usable geometry at all", () => {
    expect(blendedPlannedRewardR({ ...LONG, target: null, levels: [] })).toBeNull();
    expect(
      blendedPlannedRewardR({ direction: "Long", entry: null, stop: 90, target: 130, levels: [] }),
    ).toBeNull();
  });
});
