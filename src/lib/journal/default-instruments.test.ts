import { describe, expect, it } from "vitest";
import { DEFAULT_INSTRUMENTS, DEFAULT_INSTRUMENT_SYMBOLS, MICRO_OF, MINI_OF } from "./default-instruments";

/**
 * The catalog is a transcription of the exchange's contract terms and the platform's
 * fee table, and a transcription error is the only kind of mistake it can carry.
 * Every check here is a fact from those sources, written a second way.
 */

describe("the instrument catalog is the futures book", () => {
  it("holds exactly the eight futures traded on it", () => {
    expect(DEFAULT_INSTRUMENT_SYMBOLS).toEqual(["NQ", "MNQ", "ES", "MES", "6E", "M6E", "GC", "MGC"]);
  });

  it("symbols and sort_order are unique, and everything is offered in the form", () => {
    const syms = DEFAULT_INSTRUMENTS.map((i) => i.symbol);
    expect(new Set(syms).size).toBe(syms.length);
    const orders = DEFAULT_INSTRUMENTS.map((i) => i.sort_order);
    expect(new Set(orders).size).toBe(orders.length);
    expect(DEFAULT_INSTRUMENTS.every((i) => i.is_active)).toBe(true);
    expect(DEFAULT_INSTRUMENTS.every((i) => i.asset_class === "Futures")).toBe(true);
  });
});

describe("contract specs", () => {
  it("carry the CME multiplier and tick", () => {
    const f = new Map(DEFAULT_INSTRUMENTS.map((i) => [i.symbol, i]));
    const spec: [string, number, number][] = [
      ["NQ", 20, 0.25],
      ["MNQ", 2, 0.25],
      ["ES", 50, 0.25],
      ["MES", 5, 0.25],
      ["6E", 125_000, 0.00005],
      ["M6E", 12_500, 0.0001],
      ["GC", 100, 0.1],
      ["MGC", 10, 0.1],
    ];
    for (const [sym, pv, tick] of spec) {
      expect(f.get(sym)!.point_value, sym).toBe(pv);
      expect(f.get(sym)!.tick_size, sym).toBe(tick);
      expect(f.get(sym)!.quote_currency, sym).toBe("USD");
    }
  });

  it("a micro is a tenth of its mini, and the pairs point at each other", () => {
    const f = new Map(DEFAULT_INSTRUMENTS.map((i) => [i.symbol, i]));
    for (const [mini, micro] of Object.entries(MICRO_OF)) {
      expect(f.get(micro)!.point_value * 10, micro).toBe(f.get(mini)!.point_value);
      expect(MINI_OF[micro]).toBe(mini);
    }
  });

  it("a tick is worth what the exchange says: NQ $5, MNQ $0.50, ES $12.50, 6E $6.25, GC $10, MGC $1", () => {
    const tick = (s: string) => {
      const i = DEFAULT_INSTRUMENTS.find((x) => x.symbol === s)!;
      return Math.round(i.point_value * i.tick_size! * 100) / 100;
    };
    expect([tick("NQ"), tick("MNQ"), tick("ES"), tick("MES"), tick("6E"), tick("M6E")]).toEqual([5, 0.5, 12.5, 1.25, 6.25, 1.25]);
    expect([tick("GC"), tick("MGC")]).toEqual([10, 1]);
  });

  it("carries no tick_value — it is point_value × tick_size, and one copy cannot disagree", () => {
    for (const i of DEFAULT_INSTRUMENTS) expect(i.tick_value, i.symbol).toBeNull();
  });
});

describe("no broker's commission (phase X5, X-8 A)", () => {
  it("is 0 on every contract — the trader types the broker's own in Settings", () => {
    for (const i of DEFAULT_INSTRUMENTS) {
      expect(i.commission_per_lot, i.symbol).toBe(0);
      expect(i.commission_pct, i.symbol).toBe(0);
      expect(i.commission_currency, i.symbol).toBe("USD");
    }
  });
});
