import { describe, expect, it } from "vitest";
import {
  MAX_SCALE_OUT_PCT,
  incompleteScaleOutRows,
  levelsToScaleOutRows,
  parseScaleOutLevels,
  scaleOutRowsToLevels,
  totalScaleOutPct,
} from "./scale-out";

const row = (pct: string, price: string) => ({ pct, price });

describe("parseScaleOutLevels — the column is jsonb, so everything inside is untrusted", () => {
  it("keeps well-formed levels", () => {
    expect(parseScaleOutLevels([{ pct: 60, price: 1.085 }])).toEqual([
      { pct: 60, price: 1.085 },
    ]);
  });

  it("answers an empty list for anything that is not an array", () => {
    // The CHECK only guarantees `jsonb_typeof = 'array'`, and hand-written SQL
    // can bypass even that. None of these should reach a component.
    expect(parseScaleOutLevels(null)).toEqual([]);
    expect(parseScaleOutLevels("60% at 1R")).toEqual([]);
    expect(parseScaleOutLevels({ pct: 60 })).toEqual([]);
  });

  it("DROPS A MALFORMED LEVEL RATHER THAN THROWING, so one bad row cannot hide a trade", () => {
    const levels = parseScaleOutLevels([
      { pct: 60, price: 1.085 },
      { pct: "60", price: 1.09 }, // string pct — an older client
      { pct: 40 }, // no price
      { pct: 0, price: 1.09 }, // zero is not a share
      { pct: 40, price: -1 }, // negative price
      null,
      { pct: 40, price: 1.09 },
    ]);
    expect(levels).toEqual([
      { pct: 60, price: 1.085 },
      { pct: 40, price: 1.09 },
    ]);
  });
});

describe("incompleteScaleOutRows — a started row blocks the save", () => {
  it("treats a fully empty row as nothing at all", () => {
    // The editor always shows a blank row to type into; that is not an error.
    expect(incompleteScaleOutRows([row("", "")])).toEqual([]);
  });

  it("NAMES A HALF-FILLED ROW instead of silently dropping it", () => {
    // Same contract as `incompleteExecRows`. "60%" with no price is an
    // unfinished intention; swallowing it tells the trader it was saved.
    expect(incompleteScaleOutRows([row("60", "")])).toEqual([0]);
    expect(incompleteScaleOutRows([row("", "1.085")])).toEqual([0]);
  });

  it("reports every offending index, not just the first", () => {
    expect(
      incompleteScaleOutRows([row("60", "1.08"), row("40", ""), row("", "1.09")]),
    ).toEqual([1, 2]);
  });

  it("rejects a non-positive or unparseable share", () => {
    expect(incompleteScaleOutRows([row("0", "1.08")])).toEqual([0]);
    expect(incompleteScaleOutRows([row("abc", "1.08")])).toEqual([0]);
  });
});

describe("totalScaleOutPct", () => {
  it("adds up the complete rows", () => {
    expect(totalScaleOutPct([row("60", "1.08"), row("40", "1.09")])).toBe(100);
  });

  it("ignores incomplete rows, which block the save on their own", () => {
    // Counting them would produce a second, contradictory complaint about a
    // row that is already being complained about.
    expect(totalScaleOutPct([row("60", "1.08"), row("40", "")])).toBe(60);
  });

  it("EXACTLY 100 IS LEGAL — a full staged exit, not an error", () => {
    // The reason the guard fires on `> 100` and never on `>= 100`.
    expect(totalScaleOutPct([row("50", "1.08"), row("50", "1.09")])).toBe(
      MAX_SCALE_OUT_PCT,
    );
    expect(totalScaleOutPct([row("60", "1.08"), row("60", "1.09")])).toBe(120);
  });
});

describe("round trip through the editor", () => {
  it("drops empty rows on the way to the column", () => {
    expect(
      scaleOutRowsToLevels([row("60", "1.08"), row("", ""), row("40", "1.09")]),
    ).toEqual([
      { pct: 60, price: 1.08 },
      { pct: 40, price: 1.09 },
    ]);
  });

  it("survives a round trip unchanged", () => {
    const levels = [
      { pct: 60, price: 1.08 },
      { pct: 40, price: 1.09 },
    ];
    expect(scaleOutRowsToLevels(levelsToScaleOutRows(levels))).toEqual(levels);
  });
});
