import { describe, expect, it } from "vitest";
import { DEFAULT_INSTRUMENTS, DEFAULT_INSTRUMENT_SYMBOLS } from "./default-instruments";

/**
 * The catalog is a transcription of one broker's contract sheets, and a
 * transcription error is the only kind of mistake it can carry. Every check
 * here is a fact from those sheets, written a second way.
 */

describe("the instrument catalog is the two books traded", () => {
  it("holds exactly the ten CFDs of the FTMO book and the six Topstep futures", () => {
    expect(DEFAULT_INSTRUMENT_SYMBOLS).toEqual([
      "EURUSD",
      "GBPUSD",
      "AUDUSD",
      "NZDUSD",
      "USDCAD",
      "USDCHF",
      "USDJPY",
      "XAUUSD",
      "XCUUSD",
      "US100.cash",
      "NQ",
      "MNQ",
      "ES",
      "MES",
      "6E",
      "M6E",
    ]);
  });

  it("symbols and sort_order are unique, and everything is offered in the form", () => {
    const syms = DEFAULT_INSTRUMENTS.map((i) => i.symbol);
    expect(new Set(syms).size).toBe(syms.length);
    const orders = DEFAULT_INSTRUMENTS.map((i) => i.sort_order);
    expect(new Set(orders).size).toBe(orders.length);
    expect(DEFAULT_INSTRUMENTS.every((i) => i.is_active)).toBe(true);
  });
});

describe("contract specs", () => {
  it("every FX pair is a 100k lot quoted in the second half of its symbol", () => {
    for (const i of DEFAULT_INSTRUMENTS) {
      if (i.asset_class !== "Forex") continue;
      expect(i.symbol, `${i.symbol} is not a six-letter pair`).toHaveLength(6);
      expect(i.quote_currency, `${i.symbol} quotes in the wrong currency`).toBe(i.symbol.slice(3));
      expect(i.point_value, i.symbol).toBe(100_000);
      // The broker's "Digits": three on the JPY pair, five on the rest.
      expect(i.tick_size, i.symbol).toBe(i.quote_currency === "JPY" ? 0.001 : 0.00001);
    }
  });

  it("the CFDs carry the broker's contract size as point_value", () => {
    const bySymbol = new Map(DEFAULT_INSTRUMENTS.map((i) => [i.symbol, i]));
    expect(bySymbol.get("XAUUSD")!.point_value).toBe(100); // 100 ounces
    expect(bySymbol.get("XCUUSD")!.point_value).toBe(100);
    expect(bySymbol.get("US100.cash")!.point_value).toBe(1);
    for (const sym of ["XAUUSD", "XCUUSD", "US100.cash"]) {
      expect(bySymbol.get(sym)!.tick_size, sym).toBe(0.01); // two digits
    }
  });

  it("the futures carry the CME multiplier and tick, a micro a tenth of its mini", () => {
    const f = new Map(DEFAULT_INSTRUMENTS.map((i) => [i.symbol, i]));
    const spec: [string, number, number][] = [
      ["NQ", 20, 0.25],
      ["MNQ", 2, 0.25],
      ["ES", 50, 0.25],
      ["MES", 5, 0.25],
      ["6E", 125_000, 0.00005],
      ["M6E", 12_500, 0.0001],
    ];
    for (const [sym, pv, tick] of spec) {
      expect(f.get(sym)!.asset_class, sym).toBe("Futures");
      expect(f.get(sym)!.point_value, sym).toBe(pv);
      expect(f.get(sym)!.tick_size, sym).toBe(tick);
      expect(f.get(sym)!.quote_currency, sym).toBe("USD");
    }
    for (const [mini, micro] of [["NQ", "MNQ"], ["ES", "MES"], ["6E", "M6E"]]) {
      expect(f.get(micro)!.point_value * 10, micro).toBe(f.get(mini)!.point_value);
    }
  });

  it("carries no tick_value — for a CFD it is the broker's decision, not exchange data", () => {
    for (const i of DEFAULT_INSTRUMENTS) {
      expect(i.tick_value, `${i.symbol} carries a tick_value`).toBeNull();
    }
  });

  it("point_value and tick_size are positive, and the currency is a three-letter code", () => {
    for (const i of DEFAULT_INSTRUMENTS) {
      expect(i.point_value, i.symbol).toBeGreaterThan(0);
      expect(i.tick_size, i.symbol).toBeGreaterThan(0);
      expect(i.quote_currency, i.symbol).toMatch(/^[A-Z]{3}$/);
      expect(i.commission_currency, i.symbol).toMatch(/^[A-Z]{3}$/);
    }
  });
});

describe("what the broker charges", () => {
  it("FX is 2.50 a lot per side; the metals are a share of notional; the index is free", () => {
    for (const i of DEFAULT_INSTRUMENTS) {
      if (i.asset_class === "Forex") {
        expect(i.commission_per_lot, i.symbol).toBe(2.5);
        expect(i.commission_pct, i.symbol).toBe(0);
      }
      if (i.asset_class === "Metals CFD") {
        expect(i.commission_per_lot, i.symbol).toBe(0);
        expect(i.commission_pct, i.symbol).toBe(0.0007);
      }
    }
    const index = DEFAULT_INSTRUMENTS.find((i) => i.symbol === "US100.cash")!;
    expect(index.commission_per_lot + index.commission_pct).toBe(0);
  });

  it("Topstep charges the futures per contract: half its round turn on each side", () => {
    const roundTurn: Record<string, number> = { NQ: 3.78, MNQ: 1.22, ES: 3.78, MES: 1.22, "6E": 4.22, M6E: 1.0 };
    for (const i of DEFAULT_INSTRUMENTS) {
      if (i.asset_class !== "Futures") continue;
      expect(i.commission_per_lot * 2, i.symbol).toBeCloseTo(roundTurn[i.symbol], 10);
      expect(i.commission_pct, i.symbol).toBe(0);
      expect(i.commission_currency, i.symbol).toBe("USD");
    }
  });

  it("the weekend is collected on Wednesday, except on the index where it is Friday", () => {
    for (const i of DEFAULT_INSTRUMENTS) {
      expect(i.swap_triple_day, i.symbol).toBe(i.symbol === "US100.cash" ? 5 : 3);
    }
  });

  it("no CFD swap is left at zero on both sides — that would be a row nobody filled in", () => {
    for (const i of DEFAULT_INSTRUMENTS) {
      if (i.asset_class === "Futures") continue;
      expect(Math.abs(i.swap_long) + Math.abs(i.swap_short), i.symbol).toBeGreaterThan(0);
    }
  });

  it("a future pays no swap — its financing is in the price", () => {
    for (const i of DEFAULT_INSTRUMENTS) {
      if (i.asset_class !== "Futures") continue;
      expect([i.swap_long, i.swap_short], i.symbol).toEqual([0, 0]);
    }
  });
});
