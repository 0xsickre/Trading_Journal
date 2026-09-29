import { describe, expect, it } from "vitest";
import { loggedAfterEntry, plannedEntryOf } from "./plan-snapshot";
import { slippageFromTrade } from "./entry-slippage";
import { riskMoneyAtEntry } from "./risk-taken";
import { plannedRewardFromTrade } from "./exit-efficiency";
import { excursionFromTrade } from "./excursion";
import type { TradeRow } from "./types";

/**
 * A market order written up after the close (`/trades/log`), then matched by the
 * TopstepX export: the typed entry says 30010, the statement's fill is 30012.5,
 * the stop is 29990. Planned before the entry, the same numbers are a limit that
 * slipped. The two must read differently.
 */
const trade = (createdAt: string): TradeRow =>
  ({
    id: "t",
    direction: "Long",
    created_at: createdAt,
    entry_price: 30010,
    stop_price: 29990,
    target_price: 30070,
    planned_rr: "3",
    max_drawdown_price: 30001.25,
    plan_snapshot: { entry_price: 30010, stop_price: 29990, target_price: 30070 },
    stats: {
      opened_at: "2026-09-29T13:40:00Z",
      avg_entry: 30012.5,
      entry_qty: 2,
      point_value: 2,
      fx_rate: 1,
      realized_r: 1,
    },
  }) as unknown as TradeRow;

const logged = trade("2026-09-29T14:05:00Z"); // written after the fill
const planned = trade("2026-09-29T13:20:00Z"); // written before it

describe("a trade logged after its entry is measured from the fill (market orders)", () => {
  it("knows which is which, and says no when a time is missing", () => {
    expect(loggedAfterEntry(logged)).toBe(true);
    expect(loggedAfterEntry(planned)).toBe(false);
    expect(loggedAfterEntry({ ...logged, stats: null } as unknown as TradeRow)).toBe(false);
    expect(plannedEntryOf(logged)).toBeNull();
    expect(plannedEntryOf(planned)).toBe(30010);
  });

  it("has no entry slippage — the typed price against the fill is the typing", () => {
    expect(slippageFromTrade(logged)).toBeNull();
    // Planned before: 2.5 points worse on a 20-point plan is 0.125R of slippage.
    expect(slippageFromTrade(planned)?.slippageR).toBeCloseTo(0.125, 10);
  });

  it("takes its risk from the fill to the stop", () => {
    // 22.5 points × 2 contracts × $2 = $90; from the typed 30010 it would be $80.
    expect(riskMoneyAtEntry(logged)).toBeCloseTo(90, 10);
    expect(riskMoneyAtEntry(planned)).toBeCloseTo(80, 10);
  });

  it("measures the planned reward from the fill, not the stored ratio typed off the rough price", () => {
    // (30070 − 30012.5) / 22.5
    expect(plannedRewardFromTrade(logged)).toBeCloseTo(57.5 / 22.5, 10);
    expect(plannedRewardFromTrade(planned)).toBe(3);
  });

  it("puts MAE on the same R as realized R", () => {
    // 30012.5 − 30001.25 = 11.25 points against a 22.5-point R.
    expect(excursionFromTrade(logged).maeR).toBeCloseTo(0.5, 10);
    expect(excursionFromTrade(planned).maeR).toBeCloseTo(11.25 / 20, 10);
  });
});
