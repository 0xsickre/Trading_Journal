import { describe, expect, it } from "vitest";
import {
  cleanInstrumentKey,
  instrumentsMatch,
  normalizeInstrumentSymbol,
} from "./instrument-aliases";

describe("cleanInstrumentKey", () => {
  it("strips FTMO suffixes", () => {
    expect(cleanInstrumentKey("US500.cash")).toBe("US500CASH");
    expect(cleanInstrumentKey("US100.cash")).toBe("US100CASH");
  });
});

describe("normalizeInstrumentSymbol", () => {
  it("maps every name the index is exported under to the broker's own", () => {
    expect(normalizeInstrumentSymbol("US100.cash")).toBe("US100.cash");
    expect(normalizeInstrumentSymbol("NAS100")).toBe("US100.cash");
    expect(normalizeInstrumentSymbol("USTEC")).toBe("US100.cash");
  });

  it("maps gold and copper", () => {
    expect(normalizeInstrumentSymbol("GOLD")).toBe("XAUUSD");
    expect(normalizeInstrumentSymbol("Copper")).toBe("XCUUSD");
  });

  it("leaves a symbol this book does not trade as itself", () => {
    // The catalog is one broker's ten instruments now; anything else comes
    // back cleaned rather than bent onto a symbol that is not there.
    expect(normalizeInstrumentSymbol("US500.cash")).toBe("US500CASH");
  });

  it("reads a futures contract as its catalog root, whatever platform wrote it", () => {
    expect(normalizeInstrumentSymbol("MNQZ6")).toBe("MNQ");
    expect(normalizeInstrumentSymbol("/MNQZ26")).toBe("MNQ"); // TopstepX
    expect(normalizeInstrumentSymbol("NQ1!")).toBe("NQ"); // TradingView continuous
    expect(normalizeInstrumentSymbol("ESH7")).toBe("ES");
    expect(normalizeInstrumentSymbol("M6EZ6")).toBe("M6E");
    expect(normalizeInstrumentSymbol("6E")).toBe("6E");
  });

  it("does not read the CFD index as the future, nor the future as the CFD", () => {
    expect(normalizeInstrumentSymbol("NDX")).toBe("US100.cash");
    expect(instrumentsMatch("NQZ6", "US100.cash")).toBe(false);
    expect(instrumentsMatch("MNQZ6", "NQ")).toBe(false); // a micro is not its mini
  });

  it("passes through canonical FX", () => {
    expect(normalizeInstrumentSymbol("eurusd")).toBe("EURUSD");
    expect(normalizeInstrumentSymbol("USDCAD")).toBe("USDCAD");
  });

  it("returns null for empty", () => {
    expect(normalizeInstrumentSymbol("")).toBeNull();
    expect(normalizeInstrumentSymbol("  ")).toBeNull();
  });
});

describe("instrumentsMatch", () => {
  it("matches alias to canonical", () => {
    expect(instrumentsMatch("NAS100USD", "US100.cash")).toBe(true);
    expect(instrumentsMatch("gold", "XAUUSD")).toBe(true);
  });

  it("rejects different instruments", () => {
    expect(instrumentsMatch("EURUSD", "GBPUSD")).toBe(false);
  });
});
