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
  it("maps FTMO index names", () => {
    expect(normalizeInstrumentSymbol("US500.cash")).toBe("SP500");
    expect(normalizeInstrumentSymbol("US100.cash")).toBe("NAS100");
  });

  it("maps legacy journal symbols", () => {
    expect(normalizeInstrumentSymbol("SPX500USD")).toBe("SP500");
    expect(normalizeInstrumentSymbol("NAS100USD")).toBe("NAS100");
  });

  it("maps gold and copper", () => {
    expect(normalizeInstrumentSymbol("GOLD")).toBe("XAUUSD");
    expect(normalizeInstrumentSymbol("Copper")).toBe("HG");
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
    expect(instrumentsMatch("US500.cash", "SP500")).toBe(true);
    expect(instrumentsMatch("NAS100USD", "NAS100")).toBe(true);
  });

  it("rejects different instruments", () => {
    expect(instrumentsMatch("EURUSD", "GBPUSD")).toBe(false);
  });
});
