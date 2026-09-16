import { describe, expect, it } from "vitest";
import {
  ARCHIVED_INSTRUMENT_SYMBOLS,
  DEFAULT_INSTRUMENTS,
  DEFAULT_INSTRUMENT_SYMBOLS,
} from "./default-instruments";

describe("the instrument catalogue", () => {
  it("point_value × tick_size = tick_value on every futures contract", () => {
    // The only mistake this catalogue can carry is a mistake in copying an
    // exchange spec, and that one gives itself away: the exchange publishes both
    // the tick and its value, so those are two independently copied numbers that
    // have to agree. ES: 50 × 0.25 = 12.50. ZB: 1000 × 1/32 = 31.25.
    const withTickValue = DEFAULT_INSTRUMENTS.filter((i) => i.tick_value != null);
    expect(withTickValue.length).toBeGreaterThan(30);

    for (const i of withTickValue) {
      expect(i.tick_size, `${i.symbol} has a tick_value but no tick_size`).not.toBeNull();
      expect(
        i.point_value * i.tick_size!,
        `${i.symbol}: ${i.point_value} × ${i.tick_size} ≠ ${i.tick_value}`,
      ).toBeCloseTo(i.tick_value!, 8);
    }
  });

  it("CFDs carry no tick_value, because for them it is not exchange data", () => {
    for (const i of DEFAULT_INSTRUMENTS) {
      if (i.asset_class.includes("Futures")) continue;
      expect(i.tick_value, `${i.symbol} is CFD/spot yet carries a tick_value`).toBeNull();
    }
  });

  it("CFDs and futures are kept apart by asset_class", () => {
    const classes = new Set(DEFAULT_INSTRUMENTS.map((i) => i.asset_class));
    // The split exists because the same underlying has a different spec
    // depending on how it is traded: gold is 100 per point as a spot CFD and 100
    // as GC futures, but copper is 1 as a CFD and 25,000 as HG futures.
    expect(classes).toContain("Index CFD");
    expect(classes).toContain("Index Futures");
    expect(classes).toContain("Metals CFD");
    expect(classes).toContain("Metals Futures");
    expect(classes).toContain("Energy CFD");
    expect(classes).toContain("Energy Futures");
  });

  it("every spot FX pair carries the quote currency that is the second half of the symbol", () => {
    // This is the figure that was wrong until 20260815130000: everything stood
    // at 'USD' because that was the DEFAULT of a column nobody filled in.
    for (const i of DEFAULT_INSTRUMENTS) {
      if (i.asset_class !== "Forex") continue;
      expect(i.symbol, `${i.symbol} is not a six-letter pair`).toHaveLength(6);
      expect(i.quote_currency, `${i.symbol} quotes in the wrong currency`).toBe(
        i.symbol.slice(3),
      );
    }
  });

  it("JPY pairs quote to three decimals, the rest to five", () => {
    for (const i of DEFAULT_INSTRUMENTS) {
      if (i.asset_class !== "Forex") continue;
      expect(i.tick_size, i.symbol).toBe(i.quote_currency === "JPY" ? 0.001 : 0.00001);
    }
  });

  it("the quote currency is a three-letter code everywhere, as the DB CHECK demands", () => {
    for (const i of DEFAULT_INSTRUMENTS) {
      expect(i.quote_currency, i.symbol).toMatch(/^[A-Z]{3}$/);
    }
  });

  it("point_value is positive everywhere, as the DB CHECK demands", () => {
    for (const i of DEFAULT_INSTRUMENTS) {
      expect(i.point_value, i.symbol).toBeGreaterThan(0);
      if (i.tick_size != null) expect(i.tick_size, i.symbol).toBeGreaterThan(0);
    }
  });

  it("symbols and sort_order are unique", () => {
    const syms = DEFAULT_INSTRUMENTS.map((i) => i.symbol);
    expect(new Set(syms).size).toBe(syms.length);
    const orders = DEFAULT_INSTRUMENTS.map((i) => i.sort_order);
    expect(new Set(orders).size).toBe(orders.length);
  });

  it("no archived name made it into the catalogue", () => {
    for (const sym of DEFAULT_INSTRUMENT_SYMBOLS) {
      expect(ARCHIVED_INSTRUMENT_SYMBOLS).not.toContain(sym);
    }
  });

  it("the whole catalogue is active — no instrument hides from the form", () => {
    // The first version activated eleven symbols and left eighty switched off,
    // "so the dropdown would not grow". The consequence was an instrument that
    // exists in Settings but cannot be picked while entering a trade — the
    // opposite of the reason the catalogue was wanted in the first place.
    //
    // A long list is solved by grouping, not by hiding: the form groups by
    // `asset_class`.
    expect(DEFAULT_INSTRUMENTS.every((i) => i.is_active)).toBe(true);
  });
});
