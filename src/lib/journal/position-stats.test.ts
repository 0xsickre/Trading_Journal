import { describe, expect, it } from "vitest";
import {
  computePositionStats,
  plannedRiskPts,
  tradeDirectionMultiplier,
} from "./position-stats";

describe("tradeDirectionMultiplier", () => {
  it("long vs short", () => {
    expect(tradeDirectionMultiplier("Long")).toBe(1);
    expect(tradeDirectionMultiplier("short")).toBe(-1);
  });
});

describe("plannedRiskPts", () => {
  it("prefers planned entry over avg fill", () => {
    expect(plannedRiskPts(100, 98, 100.5)).toBe(2);
  });

  it("falls back to avg entry", () => {
    expect(plannedRiskPts(null, 98, 100.5)).toBeCloseTo(2.5);
  });
});

describe("computePositionStats", () => {
  it("slippage scenario: plan 100, fill 100.5, stop 98, exit 104", () => {
    const s = computePositionStats({
      direction: "Long",
      entry_price: 100,
      stop_price: 98,
      point_value: 1,
      executions: [
        { side: "entry", price: 100.5, qty: 1 },
        { side: "exit", price: 104, qty: 1 },
      ],
    });
    expect(s.gross_points).toBeCloseTo(3.5);
    expect(s.realized_r).toBeCloseTo(1.75);
    expect(s.avg_entry).toBeCloseTo(100.5);
  });

  it("scale-out 50% @ +1R and 50% @ +3R ≈ +2R total", () => {
    const s = computePositionStats({
      direction: "Long",
      entry_price: 100,
      stop_price: 99,
      point_value: 1,
      executions: [
        { side: "entry", price: 100, qty: 2 },
        { side: "exit", price: 101, qty: 1 },
        { side: "exit", price: 103, qty: 1 },
      ],
    });
    // +1 pt on 1 lot + 3 pts on 1 lot = 4 pts; risk = 1 pt × 2 lots
    expect(s.gross_points).toBeCloseTo(4);
    expect(s.realized_r).toBeCloseTo(2);
  });

  it("fees reduce net R", () => {
    const s = computePositionStats({
      direction: "Long",
      entry_price: 100,
      stop_price: 98,
      point_value: 1,
      executions: [
        { side: "entry", price: 100, qty: 1, fee: 0 },
        { side: "exit", price: 104, qty: 1, fee: 20 },
      ],
    });
    expect(s.realized_r).toBeCloseTo(2);
    expect(s.net_pl).toBeCloseTo(-16);
    expect(s.realized_r_net).toBeCloseTo(-8);
  });

  it("short direction inverts P/L", () => {
    const s = computePositionStats({
      direction: "Short",
      entry_price: 100,
      stop_price: 102,
      point_value: 1,
      executions: [
        { side: "entry", price: 100, qty: 1 },
        { side: "exit", price: 98, qty: 1 },
      ],
    });
    expect(s.gross_points).toBeCloseTo(2);
    expect(s.realized_r).toBeCloseTo(1);
  });
});

describe("cost accrual matches the SQL view", () => {
  it("keeps the fee from a fill whose quantity is unusable", () => {
    // The view sums COALESCE(e.fee, 0) over EVERY execution row of the
    // position, with no quantity filter. This function used to `continue` past
    // the row before adding its fee, so a fee-only or malformed fill made the
    // form's live net P&L disagree with the stored figure.
    const s = computePositionStats({
      direction: "Long",
      entry_price: 100,
      stop_price: 90,
      point_value: 1,
      executions: [
        { side: "entry", price: 100, qty: 1, fee: 2, swap_funding: 0 },
        { side: "exit", price: 110, qty: 1, fee: 2, swap_funding: 1 },
        // A correction row carrying only a charge.
        { side: "exit", price: 0, qty: 0, fee: 5, swap_funding: 0.5 },
      ],
    });

    expect(s.total_fees).toBe(9);
    expect(s.total_swap).toBe(1.5);
    // The zero-qty row must not touch the price math...
    expect(s.exit_qty).toBe(1);
    expect(s.avg_exit).toBe(110);
    expect(s.gross_pl).toBe(10);
    // ...but must still be deducted from net.
    expect(s.net_pl).toBe(10 - 9 - 1.5);
  });

  it("still ignores unusable rows for quantity and price", () => {
    const s = computePositionStats({
      direction: "Long",
      entry_price: null,
      stop_price: null,
      point_value: 1,
      executions: [
        { side: "entry", price: 100, qty: 2, fee: 0, swap_funding: 0 },
        { side: "entry", price: Number.NaN, qty: 5, fee: 0, swap_funding: 0 },
        { side: "entry", price: 100, qty: -3, fee: 0, swap_funding: 0 },
      ],
    });
    expect(s.entry_qty).toBe(2);
    expect(s.avg_entry).toBe(100);
  });
});
