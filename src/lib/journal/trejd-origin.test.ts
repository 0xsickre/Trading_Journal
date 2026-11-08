import { describe, expect, it } from "vitest";
import { trejdOrigin } from "./trejd-origin";

describe("trejdOrigin (phase TR): was the trade opened through the Trejd panel?", () => {
  it("an entry order named by the Trejd panel is a Trejd entry, keyed by that name", () => {
    expect(trejdOrigin("RP Ulaz 3f9a1c")).toEqual({ kind: "trejd", id: "RP Ulaz 3f9a1c" });
  });

  it("any other name from NinjaTrader — Chart Trader, SuperDOM, none at all — is outside Trejd", () => {
    expect(trejdOrigin("Entry")).toEqual({ kind: "van" });
    expect(trejdOrigin("")).toEqual({ kind: "van" });
    expect(trejdOrigin("RP Stop")).toEqual({ kind: "van" });
  });

  it("a trade the sync never named (manual, CSV, before phase TR) says nothing", () => {
    expect(trejdOrigin(null)).toBeNull();
    expect(trejdOrigin(undefined)).toBeNull();
  });
});
