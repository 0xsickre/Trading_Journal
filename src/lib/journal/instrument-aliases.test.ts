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
