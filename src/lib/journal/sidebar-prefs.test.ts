import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSidebarPinned, setSidebarPinned } from "./sidebar-prefs";

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
  it("reads unpinned and writes nothing, without throwing", () => {
    expect(typeof window).toBe("undefined");
    expect(getSidebarPinned()).toBe(false);
    expect(() => setSidebarPinned(true)).not.toThrow();
  });
});

describe("in the browser", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {} as Window & typeof globalThis);
    vi.stubGlobal("localStorage", fakeStorage());
  });
  afterEach(() => vi.unstubAllGlobals());

  it("is unpinned — auto-hiding — until the reader pins it", () => {
    expect(getSidebarPinned()).toBe(false);
    setSidebarPinned(true);
    expect(getSidebarPinned()).toBe(true);
    setSidebarPinned(false);
    expect(getSidebarPinned()).toBe(false);
  });

  it("a storage that throws costs the preference, never the page", () => {
    const blocked = () => {
      throw new Error("blocked");
    };
    vi.stubGlobal("localStorage", { ...fakeStorage(), getItem: blocked, setItem: blocked });
    expect(() => setSidebarPinned(true)).not.toThrow();
    expect(getSidebarPinned()).toBe(false);
  });
});
