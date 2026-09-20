import { describe, expect, it } from "vitest";
import {
  commissionPerSide,
  notionalValue,
  swapCharge,
  swapNights,
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
  swap_long: -11.06,
  swap_short: 0.59,
  swap_triple_day: 3,
};

const XAUUSD: InstrumentCostSpec = {
  point_value: 100,
  tick_size: 0.01,
  commission_per_lot: 0,
  commission_pct: 0.0007,
  swap_long: -83,
  swap_short: -8.3,
  swap_triple_day: 3,
};

const US100: InstrumentCostSpec = {
  point_value: 1,
  tick_size: 0.01,
  commission_per_lot: 0,
  commission_pct: 0,
  swap_long: -634.31,
  swap_short: 27.37,
  swap_triple_day: 5,
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

describe("swapNights — the weekend is collected by the triple day, not twice", () => {
  it("counts the nights a hold begins, skipping Saturday and Sunday", () => {
    // Mon 2026-01-05 → Thu 2026-01-08: nights beginning Mon, Tue, Wed.
    // Wednesday counts three times: 1 + 1 + 3 = 5.
    expect(swapNights("2026-01-05", "2026-01-08", 3)).toBe(5);
  });

  it("a hold over the weekend pays nothing extra for Saturday or Sunday", () => {
    // Fri → Mon: only Friday's night, and Friday is not the triple day here.
    expect(swapNights("2026-01-09", "2026-01-12", 3)).toBe(1);
    // …but it is for the index, which collects the weekend on Friday.
    expect(swapNights("2026-01-09", "2026-01-12", 5)).toBe(3);
  });

  it("a same-day round trip pays nothing", () => {
    expect(swapNights("2026-01-05", "2026-01-05", 3)).toBe(0);
    expect(swapNights("2026-01-06", "2026-01-05", 3)).toBe(0);
  });
});

describe("swapCharge — points become money, and a cost is positive", () => {
  it("reads the broker's points as money per lot per night", () => {
    // One night, long 1 lot: −11.06 points × 0.00001 × 100,000 = −11.06 USD,
    // stored as a cost of +11.06.
    expect(
      swapCharge({ spec: EURUSD, lots: 1, direction: "long", openDay: "2026-01-05", closeDay: "2026-01-06" }),
    ).toBe(11.06);
  });

  it("a positive broker swap is a credit, so the stored cost is negative", () => {
    expect(
      swapCharge({ spec: EURUSD, lots: 1, direction: "short", openDay: "2026-01-05", closeDay: "2026-01-06" }),
    ).toBe(-0.59);
  });

  it("scales with lots and with the triple day", () => {
    // Gold, 0.5 lots, Wednesday night: −83 × 0.01 × 100 × 0.5 × 3 = −124.50.
    expect(
      swapCharge({ spec: XAUUSD, lots: 0.5, direction: "long", openDay: "2026-01-07", closeDay: "2026-01-08" }),
    ).toBe(124.5);
  });

  it("is nothing for an intraday trade, or without a tick size", () => {
    expect(
      swapCharge({ spec: XAUUSD, lots: 1, direction: "long", openDay: "2026-01-07", closeDay: "2026-01-07" }),
    ).toBe(0);
    expect(
      swapCharge({
        spec: { ...XAUUSD, tick_size: null },
        lots: 1,
        direction: "long",
        openDay: "2026-01-05",
        closeDay: "2026-01-06",
      }),
    ).toBe(0);
  });
});
