import { describe, expect, it } from "vitest";

import { equityAtEntryPatch } from "./equity-at-entry";

describe("equityAtEntryPatch", () => {
  it("stamps the denominator when a plan becomes a position", () => {
    expect(equityAtEntryPatch("open", { equity_at_entry: null }, 10_000)).toEqual({
      equity_at_entry: 10_000,
    });
  });

  it("stamps on every status that means the trade was entered", () => {
    for (const status of ["open", "partial", "closed"] as const) {
      expect(equityAtEntryPatch(status, null, 10_000), status).toEqual({
        equity_at_entry: 10_000,
      });
    }
  });

  it("never restates a value already on the row", () => {
    // Editing a fill a week later changes how much was risked, but not what
    // the account was worth on the day it was risked.
    expect(equityAtEntryPatch("closed", { equity_at_entry: 10_000 }, 12_500)).toEqual({});
  });

  it("says nothing about a plan that never had one", () => {
    // An empty patch, so the dynamic UPDATE never names the column.
    expect(equityAtEntryPatch("planned", { equity_at_entry: null }, 10_000)).toEqual({});
    expect(equityAtEntryPatch("missed", null, 10_000)).toEqual({});
  });

  it("clears the denominator when the fills are taken away", () => {
    // restoreTradeToPlanned: no entry, so no equity-at-entry. Keeping it would
    // let a later reactivation silently reuse a stale denominator.
    expect(equityAtEntryPatch("planned", { equity_at_entry: 10_000 }, null)).toEqual({
      equity_at_entry: null,
    });
  });

  it("withholds a denominator that could not be computed", () => {
    // An unpriced trade earlier in the book breaks the equity ladder. Writing
    // a zero would render as a real percentage against nothing.
    expect(equityAtEntryPatch("open", null, null)).toEqual({});
    expect(equityAtEntryPatch("open", null, 0)).toEqual({});
    expect(equityAtEntryPatch("open", null, -500)).toEqual({});
  });
});
