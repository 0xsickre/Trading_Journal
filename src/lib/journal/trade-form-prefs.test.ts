import { describe, expect, it } from "vitest";
import { getTradeFormPrefs, setTradeFormPrefs } from "./trade-form-prefs";

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
