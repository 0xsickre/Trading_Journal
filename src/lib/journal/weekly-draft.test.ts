import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearWeeklyDraft,
  draftDiffers,
  pruned,
  readWeeklyDraft,
  writeWeeklyDraft,
  type WeeklyDraftFields,
} from "./weekly-draft";

/**
 * The module exists so five paragraphs written once a week cannot vanish with a
 * click on an arrow. What is asserted here is the part that decides whether the
 * trader is ever told about a draft, and the part that stops the key growing
 * for the life of the browser profile.
 */

/** The lib project runs on node, so the browser store is stubbed in. */
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

const fields = (over: Partial<WeeklyDraftFields> = {}): WeeklyDraftFields => ({
  week_grade: null,
  went_well: "",
  went_badly: "",
  one_pattern: "",
  one_change: "",
  next_week_catalysts: "",
  ...over,
});

beforeEach(() => {
  vi.stubGlobal("window", {} as Window & typeof globalThis);
  vi.stubGlobal("localStorage", fakeStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("with no browser", () => {
  it("remembers nothing and never throws", () => {
    vi.unstubAllGlobals();
    expect(readWeeklyDraft("2026-01-05")).toBeNull();
    expect(() => writeWeeklyDraft("2026-01-05", fields())).not.toThrow();
    expect(() => clearWeeklyDraft("2026-01-05")).not.toThrow();
  });
});

describe("a draft per week", () => {
  it("round-trips, and one week never reads another's", () => {
    writeWeeklyDraft("2026-01-05", fields({ went_well: "Waited for the sweep" }));
    writeWeeklyDraft("2026-01-12", fields({ went_well: "Chased twice" }));

    expect(readWeeklyDraft("2026-01-05")?.fields.went_well).toBe("Waited for the sweep");
    expect(readWeeklyDraft("2026-01-12")?.fields.went_well).toBe("Chased twice");
    expect(readWeeklyDraft("2026-01-19")).toBeNull();
  });

  it("clearing removes only that week", () => {
    writeWeeklyDraft("2026-01-05", fields({ one_change: "a" }));
    writeWeeklyDraft("2026-01-12", fields({ one_change: "b" }));
    clearWeeklyDraft("2026-01-05");
    expect(readWeeklyDraft("2026-01-05")).toBeNull();
    expect(readWeeklyDraft("2026-01-12")).not.toBeNull();
  });

  it("reads nothing rather than throwing on a corrupt store", () => {
    localStorage.setItem("tj:weekly-draft", "{not json");
    expect(readWeeklyDraft("2026-01-05")).toBeNull();
  });

  it("a refused write is silent — a full quota must not break the form", () => {
    vi.stubGlobal("localStorage", {
      ...fakeStorage(),
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    } as unknown as Storage);
    expect(() => writeWeeklyDraft("2026-01-05", fields({ went_well: "x" }))).not.toThrow();
  });
});

describe("pruned", () => {
  const entry = (savedAt: string) => ({ savedAt, fields: fields() });

  it("drops what nobody came back for, keeps the recent", () => {
    const now = new Date("2026-02-01T00:00:00Z");
    const out = pruned(
      {
        "2025-12-01": entry("2025-12-02T00:00:00Z"),
        "2026-01-26": entry("2026-01-27T00:00:00Z"),
      },
      now,
    );
    expect(Object.keys(out)).toEqual(["2026-01-26"]);
  });

  it("keeps an entry whose timestamp cannot be read, rather than losing the text", () => {
    const out = pruned({ "2026-01-05": entry("not a date") }, new Date("2026-02-01T00:00:00Z"));
    expect(Object.keys(out)).toEqual(["2026-01-05"]);
  });
});

describe("draftDiffers — when the trader is told about a draft at all", () => {
  it("is false for a draft that only repeats the saved review", () => {
    const saved = fields({ went_well: "Waited", week_grade: 4 });
    expect(draftDiffers(saved, fields({ went_well: "Waited", week_grade: 4 }))).toBe(false);
  });

  it("ignores whitespace, because the database trims on the way in", () => {
    expect(draftDiffers(fields({ one_change: "Cut earlier" }), fields({ one_change: "  Cut earlier  " }))).toBe(
      false,
    );
  });

  it("is true for a changed answer or a changed grade", () => {
    expect(draftDiffers(fields({ went_badly: "" }), fields({ went_badly: "Moved a stop" }))).toBe(true);
    expect(draftDiffers(fields({ week_grade: 3 }), fields({ week_grade: 4 }))).toBe(true);
  });
});
