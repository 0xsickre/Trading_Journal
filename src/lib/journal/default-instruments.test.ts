import { describe, expect, it } from "vitest";
import {
  ARCHIVED_INSTRUMENT_SYMBOLS,
  DEFAULT_INSTRUMENTS,
  DEFAULT_INSTRUMENT_SYMBOLS,
} from "./default-instruments";

/** Mirrors Trading data `_meta/tools/instrument_registry.py` TRADE + RADAR (B6). */
const VAULT_UNIVERSE = [
  "EURUSD",
  "GBPUSD",
  "USDJPY",
  "USDCAD",
  "AUDUSD",
  "SP500",
  "NAS100",
  "XAUUSD",
  "HG",
  "RTY",
] as const;

describe("default-instruments B6 universe", () => {
  it("matches vault TRADE + RADAR symbols", () => {
    expect(DEFAULT_INSTRUMENT_SYMBOLS).toEqual([...VAULT_UNIVERSE]);
  });

  it("has no archived symbols", () => {
    for (const sym of DEFAULT_INSTRUMENT_SYMBOLS) {
      expect(ARCHIVED_INSTRUMENT_SYMBOLS).not.toContain(sym);
    }
  });

  it("has unique sort_order", () => {
    const orders = DEFAULT_INSTRUMENTS.map((i) => i.sort_order);
    expect(new Set(orders).size).toBe(orders.length);
  });
});
