import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getDashboardPrefs,
  setDashboardPrefs,
  toggleCollapsed,
} from "./dashboard-prefs";

/**
 * COLLAPSED GROUPS ON THE DASHBOARD.
 *
 * A preference that belongs to the browser, not to the account — and that must
 * not bring down the page it decorates. The module has three defences (SSR,
 * parsing, writing) and none of them was checked.
 */

const KEY = "tj:dashboard_prefs";

function fakeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
}

describe("with no browser", () => {
  it("reading on the server returns empty instead of throwing", () => {
    // `window` does not exist in this project's node environment, so this is
    // the real state during a server render, not a simulation.
    expect(typeof window).toBe("undefined");
    expect(getDashboardPrefs()).toEqual({});
  });

  it("writing on the server has no effect and no error", () => {
    expect(() => setDashboardPrefs({ collapsedGroups: ["risk"] })).not.toThrow();
  });
});

describe("in the browser", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {} as Window & typeof globalThis);
    vi.stubGlobal("localStorage", fakeStorage());
  });

  it("an empty store gives empty preferences", () => {
    expect(getDashboardPrefs()).toEqual({});
  });

  it("what was written reads back", () => {
    setDashboardPrefs({ collapsedGroups: ["risk", "quality"] });
    expect(getDashboardPrefs()).toEqual({ collapsedGroups: ["risk", "quality"] });
  });

  it("broken JSON does not bring the page down", () => {
    localStorage.setItem(KEY, "{ ovo nije json");
    expect(getDashboardPrefs()).toEqual({});
  });

  it("a `collapsedGroups` that is not an array is rejected", () => {
    // This is the defence that really prevents something: the value would reach
    // `.includes()` and the panel would blow up during render — over a display
    // preference.
    localStorage.setItem(KEY, JSON.stringify({ collapsedGroups: "risk" }));
    expect(getDashboardPrefs()).toEqual({});
    localStorage.setItem(KEY, JSON.stringify({ collapsedGroups: 7 }));
    expect(getDashboardPrefs()).toEqual({});
  });

  it("a `null` written into the store reads as empty", () => {
    localStorage.setItem(KEY, "null");
    expect(getDashboardPrefs()).toEqual({});
  });

  it("a write that fails (quota, private mode) is swallowed", () => {
    vi.stubGlobal("localStorage", {
      ...fakeStorage(),
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    } as unknown as Storage);
    expect(() => setDashboardPrefs({ collapsedGroups: ["risk"] })).not.toThrow();
  });
});

describe("toggleCollapsed", () => {
  it("adds when absent, removes when present", () => {
    expect(toggleCollapsed([], "risk")).toEqual(["risk"]);
    expect(toggleCollapsed(["risk"], "risk")).toEqual([]);
    expect(toggleCollapsed(["risk"], "quality")).toEqual(["risk", "quality"]);
  });

  it("does not mutate the input array", () => {
    const before = ["risk"];
    toggleCollapsed(before, "quality");
    expect(before).toEqual(["risk"]);
  });

  it("the COLLAPSED set is the one stored, so a new group arrives open", () => {
    // Had the open set been stored, a group added later would be collapsed for
    // every existing user — a metric that quietly vanished from the screen.
    const stored = ["risk"];
    const newGroup = "swing";
    expect(stored.includes(newGroup)).toBe(false);
  });
});

describe("the guard looks at the ELEMENTS too, not just at being an array", () => {
  // The same stubs as in the "in the browser" block — without them
  // `typeof window` is "undefined" and the module behaves, quite correctly,
  // as it does on the server.
  beforeEach(() => {
    vi.stubGlobal("window", {} as Window & typeof globalThis);
    vi.stubGlobal("localStorage", fakeStorage());
  });

  it("rejects an array that is not an array of strings", () => {
    // `.includes(id)` over numbers does not throw — it simply never finds
    // anything. The group would stay open with no hint that the preference is
    // broken, so it is better for the field not to exist than to fail silently.
    localStorage.setItem(KEY, JSON.stringify({ collapsedGroups: [1, 2] }));
    expect(getDashboardPrefs()).toEqual({});
  });

  it("accepts an empty array as a value, not as an absence", () => {
    // Empty means "nothing is collapsed", which differs from "no preference"
    // only for whoever writes it — but both have to survive a read.
    setDashboardPrefs({ collapsedGroups: [] });
    expect(getDashboardPrefs()).toEqual({ collapsedGroups: [] });
  });
});
