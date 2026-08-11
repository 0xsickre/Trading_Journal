import { describe, expect, it } from "vitest";
import { defaultRiskPctOption, getTradeFormPrefs, setTradeFormPrefs } from "./trade-form-prefs";

/**
 * Environment-agnostic half of this module's tests. `getTradeFormPrefs` /
 * `setTradeFormPrefs` guard on `typeof window === "undefined"` for SSR — the
 * `lib` project genuinely has no `window` (`environment: "node"`), so this is
 * the one place that guard is tested for real rather than by deleting a
 * global mid-test. The localStorage-backed round trip needs a real browser
 * `Storage`, and lives in `trade-form-prefs.render.test.tsx` under jsdom.
 */

describe("getTradeFormPrefs / setTradeFormPrefs — no window (SSR)", () => {
  it("getTradeFormPrefs returns {} rather than throwing when there is no window", () => {
    expect(getTradeFormPrefs()).toEqual({});
  });

  it("setTradeFormPrefs is a no-op rather than throwing when there is no window", () => {
    expect(() => setTradeFormPrefs({ accountId: "acc-1" })).not.toThrow();
  });
});

describe("defaultRiskPctOption", () => {
  it("prefers an option literally valued or labelled 1%", () => {
    const options = [
      { value: "0.5%", label: "0.5%" },
      { value: "1%", label: "One percent" },
      { value: "2%", label: "2%" },
    ];
    expect(defaultRiskPctOption(options)).toBe("1%");
  });

  it("matches a 1% label with irregular spacing too", () => {
    const options = [{ value: "r1", label: "1 %" }];
    expect(defaultRiskPctOption(options)).toBe("r1");
  });

  it("falls back to the first option when nothing reads as 1%", () => {
    const options = [
      { value: "0.5%", label: "0.5%" },
      { value: "2%", label: "2%" },
    ];
    expect(defaultRiskPctOption(options)).toBe("0.5%");
  });

  it("returns undefined for an empty list", () => {
    expect(defaultRiskPctOption([])).toBeUndefined();
  });
});
