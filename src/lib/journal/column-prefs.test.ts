import { describe, expect, it } from "vitest";
import { hiddenToVisibility, toggleHidden, visibleCount } from "./column-prefs";

const KNOWN = ["trade_no", "date", "net", "capture", "status"];

describe("hiddenToVisibility", () => {
  it("shows everything when nothing is hidden", () => {
    const v = hiddenToVisibility([], KNOWN);
    expect(Object.values(v).every(Boolean)).toBe(true);
    expect(Object.keys(v)).toEqual(KNOWN);
  });

  it("hides exactly what is named", () => {
    const v = hiddenToVisibility(["net", "status"], KNOWN);
    expect(v.net).toBe(false);
    expect(v.status).toBe(false);
    expect(v.date).toBe(true);
  });

  it("shows a column the stored preference has never heard of", () => {
    // The reason hidden is stored rather than visible: a column added after the
    // user last configured their grid must appear, not stay invisible to exactly
    // the people who bothered to configure it.
    const v = hiddenToVisibility(["net"], [...KNOWN, "brand_new"]);
    expect(v.brand_new).toBe(true);
  });

  it("ignores an id that matches no column", () => {
    // Left behind by a renamed or removed column. It must do nothing at all
    // rather than blank the grid.
    const v = hiddenToVisibility(["net", "column_that_was_deleted"], KNOWN);
    expect(v.net).toBe(false);
    expect(Object.keys(v)).toEqual(KNOWN);
    expect(v).not.toHaveProperty("column_that_was_deleted");
  });
});

describe("toggleHidden", () => {
  it("hides a visible column and shows a hidden one", () => {
    expect(toggleHidden([], KNOWN, "net")).toEqual(["net"]);
    expect(toggleHidden(["net"], KNOWN, "net")).toEqual([]);
  });

  it("refuses to hide the last visible column", () => {
    // An empty grid is not a configuration anyone wants; it is a page that looks
    // broken with no way back except knowing the picker is still there.
    const allButOne = KNOWN.slice(1);
    expect(visibleCount(allButOne, KNOWN)).toBe(1);
    expect(toggleHidden(allButOne, KNOWN, KNOWN[0])).toEqual(allButOne);
  });

  it("still lets the last hidden column be brought back", () => {
    const allHiddenButOne = KNOWN.slice(1);
    expect(toggleHidden(allHiddenButOne, KNOWN, "date")).not.toContain("date");
  });

  it("ignores a toggle for an unknown column", () => {
    expect(toggleHidden(["net"], KNOWN, "nonsense")).toEqual(["net"]);
  });

  it("stores in the grid's own column order, so the value is stable", () => {
    // Two users hiding the same set must produce the same array, or a no-op save
    // looks like a change.
    const a = toggleHidden(toggleHidden([], KNOWN, "status"), KNOWN, "date");
    const b = toggleHidden(toggleHidden([], KNOWN, "date"), KNOWN, "status");
    expect(a).toEqual(b);
    expect(a).toEqual(["date", "status"]);
  });

  it("does not mutate the array it was given", () => {
    const hidden = ["net"];
    toggleHidden(hidden, KNOWN, "date");
    expect(hidden).toEqual(["net"]);
  });
});

describe("visibleCount", () => {
  it("counts only known columns, never the stale ids", () => {
    expect(visibleCount([], KNOWN)).toBe(KNOWN.length);
    expect(visibleCount(["net", "gone_column"], KNOWN)).toBe(KNOWN.length - 1);
  });
});
