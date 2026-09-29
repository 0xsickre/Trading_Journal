import { describe, expect, it } from "vitest";
import {
  commissionPerSide,
  notionalValue,
  type InstrumentCostSpec,
} from "./instrument-costs";

/**
 * The numbers here are the owner's broker's own contract specs, so a change
 * that silently re-reads "points" or "per lot" as something else fails loudly
 * against the sheet it was copied from.
 */

const EURUSD: InstrumentCostSpec = {
  point_value: 100_000,
  tick_size: 0.00001,
  commission_per_lot: 2.5,
  commission_pct: 0,
};

const XAUUSD: InstrumentCostSpec = {
  point_value: 100,
  tick_size: 0.01,
  commission_per_lot: 0,
  commission_pct: 0.0007,
};

const US100: InstrumentCostSpec = {
  point_value: 1,
  tick_size: 0.01,
  commission_per_lot: 0,
  commission_pct: 0,
};

describe("notional value — one lot is the contract, not one unit", () => {
  it("prices a lot of each kind", () => {
    expect(notionalValue(1, EURUSD, 1.085)).toBeCloseTo(108_500, 6);
    expect(notionalValue(0.5, XAUUSD, 4_000)).toBeCloseTo(200_000, 6);
    expect(notionalValue(2, US100, 21_500)).toBeCloseTo(43_000, 6);
  });
});

describe("commission, per side", () => {
  it("forex is a flat fee per lot, whatever the price", () => {
    expect(commissionPerSide(EURUSD, 1, 1.085)).toBe(2.5);
    expect(commissionPerSide(EURUSD, 0.2, 1.4)).toBe(0.5);
  });

  it("gold is a share of what the position is worth", () => {
    // 0.0007 % of 200,000 = 1.40
    expect(commissionPerSide(XAUUSD, 0.5, 4_000)).toBe(1.4);
  });

  it("the index costs nothing, and a missing size costs nothing", () => {
    expect(commissionPerSide(US100, 3, 21_500)).toBe(0);
    expect(commissionPerSide(EURUSD, 0, 1.085)).toBe(0);
  });

  it("is one side — a round turn is twice this, because the broker charges in and out", () => {
    const side = commissionPerSide(EURUSD, 1, 1.085);
    expect(side * 2).toBe(5);
  });
});
