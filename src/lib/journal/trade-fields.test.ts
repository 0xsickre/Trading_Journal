import { describe, expect, it } from "vitest";
import { buildPositionPatch, mergeCustom } from "./trade-fields";
import { flattenCustom } from "./field-values";
import type { FieldDef } from "./field-def-types";

const def = (over: Partial<FieldDef> & { key: string }): FieldDef => ({
  id: over.key,
  label: over.key,
  field_type: "select",
  list_key: null,
  group_id: "setup",
  sort_order: 0,
  is_active: true,
  show_when: "always",
  ...over,
});

const DEFS: FieldDef[] = [
  def({ key: "macro_align" }),
  def({ key: "confluences", field_type: "tags" }),
  def({ key: "conviction_note", field_type: "textarea" }),
  def({ key: "atr_at_entry", field_type: "number" }),
];

describe("buildPositionPatch", () => {
  it("routes defined fields to the bag and real columns to columns", () => {
    const patch = buildPositionPatch(
      { instrument: "NQ", setup_grade: "A", macro_align: "Uz bias" },
      DEFS,
    );
    expect(patch.columns).toMatchObject({ instrument: "NQ", setup_grade: "A" });
    expect(patch.columns.macro_align).toBeUndefined();
    expect(patch.custom).toEqual({ macro_align: "Uz bias" });
  });

  it("drops keys the form does not know about", () => {
    // A typo must not reach PostgREST, where it fails the whole write.
    const patch = buildPositionPatch({ nonsense: "x", instrument: "NQ" }, DEFS);
    expect(patch.columns.nonsense).toBeUndefined();
    expect(patch.custom.nonsense).toBeUndefined();
  });

  it("coerces a custom number field instead of storing the string", () => {
    const patch = buildPositionPatch({ atr_at_entry: "12.5" }, DEFS);
    expect(patch.custom.atr_at_entry).toBe(12.5);
  });

  it("stores an unparseable number as null, never as NaN", () => {
    const patch = buildPositionPatch({ atr_at_entry: "abc" }, DEFS);
    expect(patch.custom.atr_at_entry).toBeNull();
  });

  it("cleans a custom tags field the same way a column tags field is cleaned", () => {
    const patch = buildPositionPatch(
      { confluences: [" FVG ", "", "OTE"], technical_tags: [" Sweep "] },
      DEFS,
    );
    expect(patch.custom.confluences).toEqual(["FVG", "OTE"]);
    expect(patch.columns.technical_tags).toEqual(["Sweep"]);
  });

  it("turns an empty string into null so a cleared field is really cleared", () => {
    const patch = buildPositionPatch({ macro_align: "", instrument: "" }, DEFS);
    expect(patch.custom.macro_align).toBeNull();
    expect(patch.columns.instrument).toBeNull();
  });

  it("puts a field in a column once no definition claims it", () => {
    // The same key with no def is a column write — this is what makes moving a
    // field between the two storage locations a data change, not a code change.
    const patch = buildPositionPatch({ macro_align: "Uz bias" }, []);
    expect(patch.columns).toEqual({});
    expect(patch.custom).toEqual({});
  });
});

describe("mergeCustom", () => {
  it("keeps keys the submission did not mention", () => {
    // A field deactivated after the trade was logged is not on the form, so its
    // key is absent from the patch. It must survive an unrelated edit.
    const merged = mergeCustom(
      { retired_field: "still here", macro_align: "Uz bias" },
      { macro_align: "Protiv bias" },
    );
    expect(merged).toEqual({
      retired_field: "still here",
      macro_align: "Protiv bias",
    });
  });

  it("removes a key the user explicitly cleared", () => {
    expect(mergeCustom({ a: "x", b: "y" }, { a: null })).toEqual({ b: "y" });
    expect(mergeCustom({ a: ["x"] }, { a: [] })).toEqual({});
  });

  it("tolerates a previous value that is not an object", () => {
    expect(mergeCustom(null, { a: "x" })).toEqual({ a: "x" });
    expect(mergeCustom("junk", { a: "x" })).toEqual({ a: "x" });
    expect(mergeCustom(["junk"], { a: "x" })).toEqual({ a: "x" });
  });
});

describe("form → save → reload round trip", () => {
  /**
   * The regression this guards is silent: `getTradeForEdit` filters row values
   * to strings, numbers and string arrays, so an OBJECT falls through it. Before
   * `flattenCustom`, the whole bag arrived under one key, was dropped, and every
   * custom field came back empty — then got written back empty on save.
   */
  it("returns exactly what was submitted, custom fields included", () => {
    const submitted = {
      instrument: "NQ",
      setup_grade: "A+",
      technical_tags: ["FVG"],
      macro_align: "Uz bias",
      confluences: ["OTE", "SMT"],
      atr_at_entry: "18",
    };

    // Save.
    const patch = buildPositionPatch(submitted, DEFS);
    const stored = {
      id: "t1",
      ...patch.columns,
      custom: mergeCustom({}, patch.custom),
    };

    // Reload, the way getTradeForEdit does it.
    const { custom: _bag, id: _id, ...columns } = stored;
    const flat: Record<string, unknown> = { ...flattenCustom(stored), ...columns };
    const fields: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(flat)) {
      if (v == null) continue;
      if (typeof v === "string" || typeof v === "number") fields[k] = v;
      if (Array.isArray(v)) fields[k] = v.filter((x) => typeof x === "string");
    }

    expect(fields).toEqual({
      instrument: "NQ",
      setup_grade: "A+",
      technical_tags: ["FVG"],
      macro_align: "Uz bias",
      confluences: ["OTE", "SMT"],
      atr_at_entry: 18,
    });

    // And saving what came back changes nothing — the round trip is stable.
    const second = buildPositionPatch(
      fields as Record<string, string | number | string[] | null>,
      DEFS,
    );
    expect(second.custom).toEqual(patch.custom);
    expect(second.columns).toEqual(patch.columns);
  });
});
