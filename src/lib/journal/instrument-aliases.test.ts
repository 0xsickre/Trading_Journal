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
  it("leaves the CFD names as themselves now that the catalog holds no CFD", () => {
    // The aliases stay for an FTMO book added back in Settings, but they only
    // bend a name onto a symbol the catalog HAS — none of these is there now.
    expect(normalizeInstrumentSymbol("US100.cash")).toBe("US100CASH");
    expect(normalizeInstrumentSymbol("NAS100")).toBe("NAS100");
    expect(normalizeInstrumentSymbol("GOLD")).toBe("GOLD");
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
    expect(normalizeInstrumentSymbol("NDX")).toBe("NDX"); // the index is not NQ
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
  it("matches a contract to its catalog root, whatever case or platform", () => {
    expect(instrumentsMatch("mnqz6", "MNQ")).toBe(true);
    expect(instrumentsMatch("/ESH27", "es")).toBe(true);
  });

  it("rejects different instruments", () => {
    expect(instrumentsMatch("EURUSD", "GBPUSD")).toBe(false);
  });
});
