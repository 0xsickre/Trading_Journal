import { afterEach, describe, expect, it } from "vitest";
import { getTradeFormPrefs, setTradeFormPrefs } from "./trade-form-prefs";

/**
 * The browser half of `trade-form-prefs.test.ts` — real `localStorage`,
 * which only exists under jsdom (`environment: "node"` in the `lib` project
 * has no `window` at all, let alone `Storage`). `.tsx` purely to land in the
 * `components` project; nothing here renders anything.
 */

afterEach(() => localStorage.clear());

describe("getTradeFormPrefs / setTradeFormPrefs — real localStorage", () => {
  it("returns {} when nothing has been stored yet", () => {
    expect(getTradeFormPrefs()).toEqual({});
  });

  it("round-trips what was set", () => {
    setTradeFormPrefs({ accountId: "acc-1", riskPct: "1%" });
    expect(getTradeFormPrefs()).toEqual({ accountId: "acc-1", riskPct: "1%" });
  });

  it("merges rather than overwriting on a second write", () => {
    setTradeFormPrefs({ accountId: "acc-1" });
    setTradeFormPrefs({ riskPct: "2%" });
    expect(getTradeFormPrefs()).toEqual({ accountId: "acc-1", riskPct: "2%" });
  });

  it("returns {} instead of throwing on malformed stored JSON", () => {
    localStorage.setItem("tj:trade_form_prefs", "{not json");
    expect(getTradeFormPrefs()).toEqual({});
  });

  it("returns {} when the stored value parses to something other than an object", () => {
    localStorage.setItem("tj:trade_form_prefs", "42");
    expect(getTradeFormPrefs()).toEqual({});
  });

  it("setTradeFormPrefs does not throw even if localStorage.setItem fails", () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error("quota exceeded");
    };
    try {
      expect(() => setTradeFormPrefs({ accountId: "acc-1" })).not.toThrow();
    } finally {
      Storage.prototype.setItem = original;
    }
  });
});
