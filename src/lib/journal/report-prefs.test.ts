import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getStoredReportKind, setStoredReportKind } from "./report-prefs";

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
  it("remembers nothing and never throws", () => {
    expect(getStoredReportKind()).toBeNull();
    expect(() => setStoredReportKind("live")).not.toThrow();
  });
});

describe("in the browser", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {} as Window & typeof globalThis);
    vi.stubGlobal("localStorage", fakeStorage());
  });
  afterEach(() => vi.unstubAllGlobals());

  it("reads back the kind last shown", () => {
    expect(getStoredReportKind()).toBeNull();
    setStoredReportKind("backtest");
    expect(getStoredReportKind()).toBe("backtest");
  });

  it("ignores a stored value that is not a kind", () => {
    localStorage.setItem("tj:reports_kind", "demo");
    expect(getStoredReportKind()).toBeNull();
  });

  it("a storage that throws costs the preference, never the page", () => {
    const blocked = () => {
      throw new Error("blocked");
    };
    vi.stubGlobal("localStorage", { ...fakeStorage(), getItem: blocked, setItem: blocked });
    expect(() => setStoredReportKind("all")).not.toThrow();
    expect(getStoredReportKind()).toBeNull();
  });
});
