import { describe, expect, it } from "vitest";
import { getAllFormFields } from "./form-config";
import {
  listProtection,
  moveRefusal,
  newCategoryKey,
  parseSettingsNumber,
  pgTextArrayLiteral,
  renameCollision,
  selectionChangeRefusal,
  siblingLists,
  trackerRuleMayHardDelete,
} from "./settings-rules";

// The exact call shape the server actions use: no custom definitions merged.
const BUILT_IN = getAllFormFields([]);

describe("listProtection — the seeded categories cannot be deleted (A2)", () => {
  it.each(["technical_tag", "exit_reason", "mistake", "emotion", "discipline", "miss_reason"])(
    "%s is protected even with getAllFormFields([]) and no definition rows",
    (key) => {
      expect(listProtection(key, [], BUILT_IN)).not.toBeNull();
    },
  );

  it("risk_pct stays protected as a built-in field", () => {
    expect(listProtection("risk_pct", [], BUILT_IN)).not.toBeNull();
  });

  it("a list backing a column-backed definition is protected whatever its key", () => {
    expect(
      listProtection("renamed_list", [{ key: "mistake", list_key: "renamed_list" }], BUILT_IN),
    ).not.toBeNull();
  });

  it("the trader's own category can be deleted", () => {
    expect(listProtection("htf_bias", [{ key: "htf_bias", list_key: "htf_bias" }], BUILT_IN)).toBeNull();
  });
});

describe("selectionChangeRefusal — one ↔ several (A3)", () => {
  it("refuses a column-backed category", () => {
    expect(selectionChangeRefusal("mistake", [], 0)).toMatch(/trade column/);
  });
  it("allows a custom category no trade uses", () => {
    expect(selectionChangeRefusal("htf_bias", [{ key: "htf_bias", list_key: "htf_bias" }], 0)).toBeNull();
  });
  it("refuses a custom category trades already use, and an unknown count", () => {
    expect(selectionChangeRefusal("htf_bias", [], 3)).toMatch(/3 trades/);
    expect(selectionChangeRefusal("htf_bias", [], -1)).toMatch(/Could not check/);
  });
});

describe("renameCollision (A5)", () => {
  it("refuses a name the category already has, case-blind", () => {
    expect(renameCollision("fomo", "Greed", ["FOMO", "Greed"])).toMatch(/already exists/);
  });
  it("allows re-casing the same tag", () => {
    expect(renameCollision("FOMO", "Fomo", ["Fomo", "Greed"])).toBeNull();
  });
  it("allows a new name", () => {
    expect(renameCollision("Revenge", "Fomo", ["Fomo", "Greed"])).toBeNull();
  });
});

describe("siblingLists", () => {
  it("emotion and discipline feed one column", () => {
    expect(siblingLists("emotion")).toEqual(["emotion", "discipline"]);
    expect(siblingLists("discipline")).toEqual(["emotion", "discipline"]);
  });
  it("any other list stands alone", () => {
    expect(siblingLists("mistake")).toEqual(["mistake"]);
  });
});

describe("moveRefusal (A6)", () => {
  it("allows a move between lists feeding the same column, even with trades", () => {
    expect(moveRefusal("emotion", "discipline", 12, true)).toBeNull();
  });
  it("refuses a move into a protected category", () => {
    expect(moveRefusal("htf_bias", "mistake", 0, true)).toMatch(/built-in/);
  });
  it("refuses a move of a tag trades use", () => {
    expect(moveRefusal("htf_bias", "entry_tf", 2, false)).toMatch(/2 trades/);
  });
  it("refuses when the count failed, allows when nothing uses it", () => {
    expect(moveRefusal("htf_bias", "entry_tf", -1, false)).toMatch(/Could not check/);
    expect(moveRefusal("htf_bias", "entry_tf", 0, false)).toBeNull();
  });
});

describe("newCategoryKey (A7)", () => {
  it("strips accents and keeps a leading letter", () => {
    expect(newCategoryKey("Čekirano", [])).toEqual({ ok: true, key: "cekirano" });
    expect(newCategoryKey("1st setup", [])).toEqual({ ok: true, key: "f_1st_setup" });
  });
  it("refuses a name with nothing to key on", () => {
    expect(newCategoryKey("!!!", []).ok).toBe(false);
    expect(newCategoryKey("   ", []).ok).toBe(false);
  });
  it("refuses a reserved column name and an existing key", () => {
    expect(newCategoryKey("Mistake", []).ok).toBe(false);
    expect(newCategoryKey("HTF bias", ["htf_bias"])).toEqual({
      ok: false,
      error: "A category with that name already exists.",
    });
  });
});

describe("pgTextArrayLiteral (A4)", () => {
  it("keeps a tag with a comma as ONE element", () => {
    expect(pgTextArrayLiteral(["Late, no confirmation"])).toBe('{"Late, no confirmation"}');
  });
  it("escapes quotes and backslashes", () => {
    expect(pgTextArrayLiteral(['say "hi"', "a\\b"])).toBe('{"say \\"hi\\"","a\\\\b"}');
  });
});

describe("trackerRuleMayHardDelete (A9)", () => {
  const base = { createdDay: "2026-09-19", today: "2026-09-19", answered: false, mandatory: false };
  it("only a rule made today and never answered", () => {
    expect(trackerRuleMayHardDelete(base)).toBe(true);
  });
  it("an older rule is retired, not deleted", () => {
    expect(trackerRuleMayHardDelete({ ...base, createdDay: "2026-09-18" })).toBe(false);
  });
  it("an answered or mandatory rule is retired", () => {
    expect(trackerRuleMayHardDelete({ ...base, answered: true })).toBe(false);
    expect(trackerRuleMayHardDelete({ ...base, mandatory: true })).toBe(false);
  });
});

describe("parseSettingsNumber (A10)", () => {
  it("reads grouped and European numbers the way they are meant", () => {
    expect(parseSettingsNumber("10.000,50")).toEqual({ ok: true, value: 10000.5 });
    expect(parseSettingsNumber("10,000.50")).toEqual({ ok: true, value: 10000.5 });
    expect(parseSettingsNumber("-37,50")).toEqual({ ok: true, value: -37.5 });
  });
  it("refuses a thousands-or-decimal guess instead of picking one", () => {
    expect(parseSettingsNumber("25.000")).toEqual({ ok: false, error: "Ambiguous — write 25000 or 25.0." });
    expect(parseSettingsNumber("1,500")).toEqual({ ok: false, error: "Ambiguous — write 1500 or 1.5." });
    expect(parseSettingsNumber("0.5")).toEqual({ ok: true, value: 0.5 });
  });
  it("a zero in front is not a thousands group — a tick size of 0.001 saves", () => {
    expect(parseSettingsNumber("0.001", { min: 0 })).toEqual({ ok: true, value: 0.001 });
    expect(parseSettingsNumber("0,001", { min: 0 })).toEqual({ ok: true, value: 0.001 });
    expect(parseSettingsNumber("0.250", { min: 0 })).toEqual({ ok: true, value: 0.25 });
  });
  it("refuses instead of saving 0", () => {
    expect(parseSettingsNumber("")).toEqual({ ok: false, error: "Required." });
    expect(parseSettingsNumber("abc")).toEqual({ ok: false, error: "Not a number." });
  });
  it("empty is null when allowed", () => {
    expect(parseSettingsNumber("", { allowEmpty: true })).toEqual({ ok: true, value: null });
  });
  it("applies ranges and whole-number rules", () => {
    expect(parseSettingsNumber("120", { max: 100 }).ok).toBe(false);
    expect(parseSettingsNumber("-1", { min: 0 }).ok).toBe(false);
    expect(parseSettingsNumber("2.5", { integer: true }).ok).toBe(false);
  });
});
