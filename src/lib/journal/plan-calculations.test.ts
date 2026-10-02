import { describe, expect, it } from "vitest";
import {
  blendedPlannedRewardR,
  computePlannedRewardR,
  formatPlannedRewardR,
  inferDirectionFromPrices,
  parsePlannedRewardR,
  computeFuturesContracts,
  computeTopstepRisk,
  ticksBetween,
  riskPlanFieldVisible,
  thesisGroupVisible,
} from "./plan-calculations";

describe("riskPlanFieldVisible", () => {
  const vis = (name: string, e: number | null, s: number | null, t: number | null) =>
    riskPlanFieldVisible(name, e, s, t);

  it("only entry when no prices", () => {
    expect(vis("entry_price", null, null, null)).toBe(true);
    expect(vis("stop_price", null, null, null)).toBe(false);
    expect(vis("target_price", null, null, null)).toBe(false);
  });

  it("entry + stop when entry set", () => {
    expect(vis("stop_price", 100, null, null)).toBe(true);
    expect(vis("target_price", 100, null, null)).toBe(false);
  });

  it("target and size after stop — the size is the Topstep rule's, no Risk % first (H2)", () => {
    expect(vis("target_price", 100, 98, null)).toBe(true);
    expect(vis("position_size", 100, 98, null)).toBe(true);
    expect(vis("position_size", 100, null, null)).toBe(false);
    expect(vis("planned_rr", 100, 98, null)).toBe(false);
  });

  it("planned R:R after target", () => {
    expect(vis("planned_rr", 100, 98, 104)).toBe(true);
  });

  it("scale-out plan appears with the target, not before it", () => {
    // How much comes off on the way is part of the same decision as where you
    // are going.
    expect(vis("scale_out_plan", 100, 98, null)).toBe(false);
    expect(vis("scale_out_plan", 100, 98, 104)).toBe(true);
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

describe("guard clauses that exist to refuse, not to compute", () => {
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

  it("riskPlanFieldVisible reveals each field only once its inputs exist", () => {
    // entry, stop, target — positional.
    expect(riskPlanFieldVisible("entry_price", null, null, null)).toBe(true);
    expect(riskPlanFieldVisible("stop_price", null, null, null)).toBe(false);
    expect(riskPlanFieldVisible("stop_price", 100, null, null)).toBe(true);
    expect(riskPlanFieldVisible("direction", 100, null, null)).toBe(false);
    expect(riskPlanFieldVisible("direction", 100, 95, null)).toBe(true);
    expect(riskPlanFieldVisible("position_size", 100, null, null)).toBe(false);
    expect(riskPlanFieldVisible("position_size", 100, 95, null)).toBe(true);
    expect(riskPlanFieldVisible("planned_rr", 100, 95, null)).toBe(false);
    expect(riskPlanFieldVisible("planned_rr", 100, 95, 110)).toBe(true);
    // Anything outside the progressive plan is always shown.
    expect(riskPlanFieldVisible("instrument", null, null, null)).toBe(true);
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

/**
 * The trader's own rule, from futures-trading izlaz/Uputstvo_rizik.pdf: risk is
 * 8 % of the room above the MLL, $60–$300 on a 50K, contracts ROUNDED DOWN.
 * The worked examples of that document are the tests.
 */
describe("computeTopstepRisk", () => {
  // 50K: the floor holds from a third of the MLL up (R3, 30.09.2026).
  const rule = { pct: 8, min: 60, max: 300, dllLeft: 1000, minFromRoom: 2_000 / 3 };

  it("example 1 — 50K on its first day: room 2 000 → 160", () => {
    expect(computeTopstepRisk({ ...rule, room: 50_000 - 48_000 })).toEqual({ amount: 160, threeStopsFitDll: true });
  });

  it("example 4 — MLL locked at 50 000, balance 55 000: 8 % is 400, the ceiling is 300", () => {
    expect(computeTopstepRisk({ ...rule, room: 5_000 })!.amount).toBe(300);
  });

  it("from a third of the MLL up, a small share is held at the floor of the range", () => {
    expect(computeTopstepRisk({ ...rule, room: 400, minFromRoom: 400 })!.amount).toBe(60);
    // 150K at 8 %: $2 000 of room is $160, lifted to the plan's $180.
    expect(
      computeTopstepRisk({ room: 2_000, pct: 8, min: 180, max: 900, dllLeft: 1_200, minFromRoom: 1_500 })!.amount,
    ).toBe(180);
  });

  it("under a third of the MLL the floor is gone: the risk falls with the room (R3)", () => {
    expect(computeTopstepRisk({ ...rule, room: 400 })!.amount).toBe(32);
    // 150K, $400 left: 8 % is $32, not the plan's $180 — 45 % of what is left.
    expect(
      computeTopstepRisk({ room: 400, pct: 8, min: 180, max: 900, dllLeft: 1_200, minFromRoom: 1_500 })!.amount,
    ).toBe(32);
    expect(
      computeTopstepRisk({ room: 1_500, pct: 8, min: 180, max: 900, dllLeft: 1_200, minFromRoom: 1_500 })!.amount,
    ).toBe(180);
  });

  it("never more than today's DLL allows, and says when three stops no longer fit", () => {
    expect(computeTopstepRisk({ ...rule, room: 2_000, dllLeft: 100 })).toEqual({ amount: 100, threeStopsFitDll: false });
  });

  it("never more than the room itself", () => {
    expect(computeTopstepRisk({ ...rule, room: 40, minFromRoom: 0 })!.amount).toBe(40);
  });

  it("nothing to risk on the floor, or with the day's DLL spent", () => {
    expect(computeTopstepRisk({ ...rule, room: 0 })).toBeNull();
    expect(computeTopstepRisk({ ...rule, room: 2_000, dllLeft: 0 })).toBeNull();
  });
});

describe("computeFuturesContracts", () => {
  const mnq = { pointValue: 2, commissionPerSide: 0.61, maxContracts: 50, tickSize: 0.25 };

  it("250 at a 50-point MNQ stop is 2 contracts — rounded down, commission and a tick of slippage in", () => {
    const r = computeFuturesContracts({ ...mnq, riskAmount: 250, entry: 30_600, stop: 30_550 })!;
    expect(r.contracts).toBe(2); // 250 / (50 × 2 + 1.22 + 0.50) = 2.46
    expect(r.perContract).toBeCloseTo(101.72, 10);
    expect(r.risk).toBeCloseTo(203.44, 10);
    expect(r.capped).toBe(false);
  });

  it("the mini at the same stop does not fit: 0 contracts, not a fraction", () => {
    const r = computeFuturesContracts({ riskAmount: 250, entry: 30_600, stop: 30_550, pointValue: 20, commissionPerSide: 1.89, maxContracts: 5, tickSize: 0.25 })!;
    expect(r.contracts).toBe(0);
    expect(r.risk).toBe(0);
  });

  it("example 2 — 6E, 150 at an 8-pip stop: 1 6E, or 12 M6E once the stop's tick is counted", () => {
    const e = { riskAmount: 150, entry: 1.1400, stop: 1.1392 };
    expect(computeFuturesContracts({ ...e, pointValue: 125_000, commissionPerSide: 2.11, maxContracts: 5, tickSize: 0.00005 })!.contracts).toBe(1);
    // 150 / (10 + 1.00 + 1.25) = 12.2 — without the tick it was 13, and a slipped stop on 13 is $159.
    expect(computeFuturesContracts({ ...e, pointValue: 12_500, commissionPerSide: 0.5, maxContracts: 50, tickSize: 0.0001 })!.contracts).toBe(12);
  });

  it("a tick of slippage on the stop is part of the loss (R4): 562.50 at a 10-point MNQ stop is 25, not 26", () => {
    const r = computeFuturesContracts({ ...mnq, maxContracts: 150, riskAmount: 562.5, entry: 30_600, stop: 30_590 })!;
    expect(r.perContract).toBeCloseTo(21.72, 10); // 10 × 2 + 1.22 + 0.25 × 2
    expect(r.contracts).toBe(25);
  });

  it("on a tight ES stop the tick is an eighth of the loss", () => {
    const es = { riskAmount: 900, entry: 6_700, stop: 6_698, pointValue: 50, commissionPerSide: 1.89, maxContracts: 15 };
    expect(computeFuturesContracts({ ...es, tickSize: null })!.contracts).toBe(8); // 900 / 103.78
    expect(computeFuturesContracts({ ...es, tickSize: 0.25 })!.contracts).toBe(7); // 900 / 116.28
  });

  it("without a tick size nothing is added — the old arithmetic, not a guessed tick", () => {
    expect(computeFuturesContracts({ ...mnq, tickSize: null, riskAmount: 250, entry: 30_600, stop: 30_550 })!.perContract).toBeCloseTo(101.22, 10);
    expect(computeFuturesContracts({ ...mnq, tickSize: 0, riskAmount: 250, entry: 30_600, stop: 30_550 })!.perContract).toBeCloseTo(101.22, 10);
  });

  it("an exact fit is not lost to floating point", () => {
    expect(computeFuturesContracts({ riskAmount: 250, entry: 100, stop: 37.5, pointValue: 2, commissionPerSide: 0, maxContracts: null, tickSize: null })!.contracts).toBe(2);
  });

  it("is capped at what the account may hold, and says so", () => {
    const r = computeFuturesContracts({ ...mnq, maxContracts: 150, riskAmount: 900, entry: 30_600, stop: 30_598 })!;
    expect(r.contracts).toBe(150);
    expect(r.capped).toBe(true);
  });

  it("refuses to size without a price, a stop distance or a point value", () => {
    const base = { ...mnq, riskAmount: 250, entry: 30_600, stop: 30_550 };
    expect(computeFuturesContracts({ ...base, riskAmount: null })).toBeNull();
    expect(computeFuturesContracts({ ...base, entry: null })).toBeNull();
    expect(computeFuturesContracts({ ...base, stop: null })).toBeNull();
    expect(computeFuturesContracts({ ...base, pointValue: null })).toBeNull();
    expect(computeFuturesContracts({ ...base, pointValue: 0 })).toBeNull();
    expect(computeFuturesContracts({ ...base, stop: 30_600 })).toBeNull();
  });

  it("a negative commission is not a rebate on the stop", () => {
    expect(computeFuturesContracts({ ...mnq, tickSize: null, commissionPerSide: -5, riskAmount: 200, entry: 110, stop: 60 })!.perContract).toBe(100);
  });
});

describe("ticksBetween", () => {
  it("is the distance a bracket asks for", () => {
    expect(ticksBetween(30_600, 30_584, 0.25)).toBe(64);
    expect(ticksBetween(1.14, 1.1392, 0.00005)).toBe(16);
  });

  it("is null without both prices or a tick size", () => {
    expect(ticksBetween(null, 1, 0.25)).toBeNull();
    expect(ticksBetween(1, null, 0.25)).toBeNull();
    expect(ticksBetween(1, 2, null)).toBeNull();
    expect(ticksBetween(1, 2, 0)).toBeNull();
  });
});
