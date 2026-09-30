import { describe, expect, it } from "vitest";

import { equityAtEntryPatch, riskBudgetAtEntryPatch, roomAtEntryPatch } from "./equity-at-entry";

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

describe("riskBudgetAtEntryPatch (F3, E4) — the same three rules", () => {
  it("writes the budget on the save that first gives the trade an entry", () => {
    expect(riskBudgetAtEntryPatch("closed", null, 250)).toEqual({ risk_budget_at_entry: 250 });
    expect(riskBudgetAtEntryPatch("open", { risk_budget_at_entry: null }, 180)).toEqual({ risk_budget_at_entry: 180 });
  });

  it("writes a 0 — an account with no room allowed nothing, and that is the record", () => {
    expect(riskBudgetAtEntryPatch("closed", null, 0)).toEqual({ risk_budget_at_entry: 0 });
  });

  it("never overwrites one already sealed", () => {
    expect(riskBudgetAtEntryPatch("closed", { risk_budget_at_entry: 250 }, 120)).toEqual({});
  });

  it("clears it when the trade goes back to a plan, and says nothing for a plan that never had one", () => {
    expect(riskBudgetAtEntryPatch("planned", { risk_budget_at_entry: 250 }, null)).toEqual({ risk_budget_at_entry: null });
    expect(riskBudgetAtEntryPatch("planned", null, 250)).toEqual({});
  });

  it("writes nothing it does not know — not a Topstep account, or no entry instant", () => {
    expect(riskBudgetAtEntryPatch("closed", null, null)).toEqual({});
  });
});

describe("roomAtEntryPatch (30.09.2026) — the same three rules", () => {
  it("writes the room on the save that first gives the trade an entry, 0 included", () => {
    expect(roomAtEntryPatch("closed", null, 4_500)).toEqual({ room_at_entry: 4_500 });
    expect(roomAtEntryPatch("open", { room_at_entry: null }, 0)).toEqual({ room_at_entry: 0 });
  });

  it("never overwrites a sealed room, and clears it on the way back to a plan", () => {
    expect(roomAtEntryPatch("closed", { room_at_entry: 4_500 }, 3_000)).toEqual({});
    expect(roomAtEntryPatch("planned", { room_at_entry: 4_500 }, null)).toEqual({ room_at_entry: null });
    expect(roomAtEntryPatch("planned", null, null)).toEqual({});
  });

  it("writes nothing when the room is unknown", () => {
    expect(roomAtEntryPatch("closed", null, null)).toEqual({});
  });
});
