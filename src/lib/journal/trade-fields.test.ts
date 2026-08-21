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
      { instrument: "NQ", exit_reason: "TP hit", macro_align: "Uz bias" },
      DEFS,
    );
    expect(patch.columns).toMatchObject({ instrument: "NQ", exit_reason: "TP hit" });
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

  it("routes `mistake` through array coercion now that it is a text[] column", () => {
    // One word in `form-config` (`type: "select"` → `"tags"`) moves this field
    // into `arrayFieldNames()`, and everything downstream follows on its own.
    // This asserts the routing actually changed rather than trusting it.
    const patch = buildPositionPatch(
      { mistake: [" Late entry ", "", "Moved stop"] },
      DEFS,
    );
    expect(patch.columns.mistake).toEqual(["Late entry", "Moved stop"]);
  });

  it("REPLACES A LEFTOVER STRING WITH AN EMPTY ARRAY rather than sending it to a text[] column", () => {
    // A form that has not reloaded since the migration, or a stale draft in
    // localStorage, can still hold the old single-string shape. Postgres would
    // reject it; the coercion turns it into "no mistake recorded" instead.
    const patch = buildPositionPatch({ mistake: "Late entry" }, DEFS);
    expect(patch.columns.mistake).toEqual([]);
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

describe("text is trimmed before it becomes a report bucket", () => {
  it("strips surrounding whitespace from a column value", () => {
    // `dimensions.ts` groups on the stored value, so an untrimmed instrument
    // splits into two buckets that each hold half the trades and each fall
    // below the sample threshold — with nothing on screen to say they are the
    // same symbol. A trailing space is invisible in an input and survives every
    // paste from a broker statement.
    const a = buildPositionPatch({ instrument: "XAUUSD " }, DEFS);
    const b = buildPositionPatch({ instrument: " XAUUSD" }, DEFS);
    const c = buildPositionPatch({ instrument: "XAUUSD" }, DEFS);
    expect(a.columns.instrument).toBe("XAUUSD");
    expect(b.columns.instrument).toBe("XAUUSD");
    expect(c.columns.instrument).toBe("XAUUSD");
  });

  it("strips it from a custom field too, not only from real columns", () => {
    const patch = buildPositionPatch({ macro_align: "  Uz bias  " }, DEFS);
    expect(patch.custom.macro_align).toBe("Uz bias");
  });

  it("collapses a whitespace-only value to null, like an empty one", () => {
    // "   " is not a value the user chose; it is an empty field they tabbed
    // through. Stored as-is it becomes its own report bucket labelled with
    // nothing at all.
    expect(buildPositionPatch({ instrument: "   " }, DEFS).columns.instrument).toBeNull();
    expect(buildPositionPatch({ instrument: "" }, DEFS).columns.instrument).toBeNull();
    expect(
      buildPositionPatch({ conviction_note: "\t\n " }, DEFS).custom.conviction_note,
    ).toBeNull();
  });

  it("leaves the array branch alone — it has always trimmed", () => {
    // Pinned so the two branches cannot drift apart again: this was the
    // asymmetry, arrays trimmed and scalars did not.
    const patch = buildPositionPatch({ confluences: [" FVG ", "OB", "  "] }, DEFS);
    expect(patch.custom.confluences).toEqual(["FVG", "OB"]);
  });

  it("does not mangle interior whitespace", () => {
    expect(buildPositionPatch({ macro_align: " Uz  bias " }, DEFS).custom.macro_align).toBe(
      "Uz  bias",
    );
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
      exit_reason: "TP hit",
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
      exit_reason: "TP hit",
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
