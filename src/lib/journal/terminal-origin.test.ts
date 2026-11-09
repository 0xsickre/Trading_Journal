import { describe, expect, it } from "vitest";
import { terminalOrigin } from "./terminal-origin";

describe("terminalOrigin (phase TR): was the trade opened through the Terminal panel?", () => {
  it("an entry order named by the Terminal panel is a Terminal entry, keyed by that name", () => {
    expect(terminalOrigin("RP Ulaz 3f9a1c")).toEqual({ kind: "terminal", id: "RP Ulaz 3f9a1c" });
  });

  it("any other name from NinjaTrader — Chart Trader, SuperDOM, none at all — is outside the Terminal", () => {
    expect(terminalOrigin("Entry")).toEqual({ kind: "van" });
    expect(terminalOrigin("")).toEqual({ kind: "van" });
    expect(terminalOrigin("RP Stop")).toEqual({ kind: "van" });
  });

  it("a trade the sync never named (manual, CSV, before phase TR) says nothing", () => {
    expect(terminalOrigin(null)).toBeNull();
    expect(terminalOrigin(undefined)).toBeNull();
  });
});
