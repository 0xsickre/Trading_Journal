import { describe, expect, it } from "vitest";
import {
  arrayFieldValue,
  displayFieldValue,
  fieldValue,
  flattenCustom,
  numberFieldValue,
  splitFieldsByStorage,
  stringFieldValue,
} from "./field-values";

/**
 * The point of the accessor is that a reader cannot tell where a field lives.
 * Every assertion below is therefore run TWICE over the same logical row — once
 * with the value as a column, once with it inside `custom` — and both must give
 * the same answer. If they ever diverge, moving a field into `custom` silently
 * changes a statistic, which is exactly the failure this file exists to catch.
 */
const asColumn = (key: string, value: unknown) => ({ id: "t1", [key]: value });
const asCustom = (key: string, value: unknown) => ({
  id: "t1",
  custom: { [key]: value },
});

const bothWays = (key: string, value: unknown) => [
  ["column", asColumn(key, value)] as const,
  ["custom", asCustom(key, value)] as const,
];

describe("fieldValue", () => {
  it("reads the same value from a column or from the custom bag", () => {
    for (const [where, row] of bothWays("htf_bias", "Bullish")) {
      expect(fieldValue(row, "htf_bias"), where).toBe("Bullish");
      expect(stringFieldValue(row, "htf_bias"), where).toBe("Bullish");
    }
  });

  it("reads arrays the same either way", () => {
    for (const [where, row] of bothWays("technical_tags", ["FVG", "OTE"])) {
      expect(arrayFieldValue(row, "technical_tags"), where).toEqual(["FVG", "OTE"]);
      expect(displayFieldValue(row, "technical_tags"), where).toBe("FVG, OTE");
    }
  });

  it("reads numbers the same either way, including numeric strings", () => {
    for (const [where, row] of bothWays("entry_price", 1.2345)) {
      expect(numberFieldValue(row, "entry_price"), where).toBe(1.2345);
    }
    for (const [where, row] of bothWays("entry_price", "1.2345")) {
      expect(numberFieldValue(row, "entry_price"), where).toBe(1.2345);
    }
  });

  it("returns undefined for a key stored nowhere", () => {
    expect(fieldValue({ id: "t1" }, "nope")).toBeUndefined();
    expect(stringFieldValue({ id: "t1", custom: {} }, "nope")).toBeNull();
  });

  it("treats a null column as an answer, not as a miss", () => {
    // A cleared column must NOT fall through to a stale custom entry — that
    // would resurrect a value the user explicitly deleted.
    const row = { id: "t1", htf_bias: null, custom: { htf_bias: "Bullish" } };
    expect(fieldValue(row, "htf_bias")).toBeNull();
    expect(stringFieldValue(row, "htf_bias")).toBeNull();
  });

  it("lets a real column win over the custom bag", () => {
    const row = { id: "t1", htf_bias: "Bearish", custom: { htf_bias: "Bullish" } };
    expect(stringFieldValue(row, "htf_bias")).toBe("Bearish");
  });

  it("ignores a custom bag that is not an object", () => {
    expect(fieldValue({ id: "t1", custom: "junk" }, "x")).toBeUndefined();
    expect(fieldValue({ id: "t1", custom: ["junk"] }, "x")).toBeUndefined();
    expect(fieldValue({ id: "t1", custom: null }, "x")).toBeUndefined();
  });

  it("rejects blank strings and empty arrays as values", () => {
    expect(stringFieldValue(asCustom("a", "   "), "a")).toBeNull();
    expect(arrayFieldValue(asCustom("a", []), "a")).toBeNull();
    expect(arrayFieldValue(asCustom("a", ["", ""]), "a")).toBeNull();
  });

  it("rejects NaN rather than propagating it into arithmetic", () => {
    expect(numberFieldValue(asCustom("a", Number.NaN), "a")).toBeNull();
    expect(numberFieldValue(asCustom("a", "abc"), "a")).toBeNull();
  });
});

describe("splitFieldsByStorage", () => {
  it("routes declared custom keys to the bag and the rest to columns", () => {
    const split = splitFieldsByStorage(
      { instrument: "NQ", htf_bias: "Bullish", my_idea: "yes" },
      new Set(["htf_bias", "my_idea"]),
    );
    expect(split.columns).toEqual({ instrument: "NQ" });
    expect(split.custom).toEqual({ htf_bias: "Bullish", my_idea: "yes" });
  });

  it("keeps nulls, so clearing a field actually clears it", () => {
    const split = splitFieldsByStorage(
      { instrument: null, htf_bias: null },
      new Set(["htf_bias"]),
    );
    expect(split.columns).toEqual({ instrument: null });
    expect(split.custom).toEqual({ htf_bias: null });
  });
});

describe("flattenCustom", () => {
  it("lifts the bag onto a flat record for the edit form", () => {
    const out = flattenCustom(
      { id: "t1", custom: { htf_bias: "Bullish", tags: ["FVG"] } },
      { instrument: "NQ" },
    );
    expect(out).toEqual({
      instrument: "NQ",
      htf_bias: "Bullish",
      tags: ["FVG"],
    });
  });

  it("drops nulls so an empty custom field does not overwrite a form default", () => {
    expect(flattenCustom({ id: "t1", custom: { a: null, b: "x" } })).toEqual({
      b: "x",
    });
  });

  it("is a no-op when there is no bag", () => {
    expect(flattenCustom({ id: "t1" }, { a: 1 })).toEqual({ a: 1 });
  });
});
