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

describe("an unpriceable trade yields no money, matching the view", () => {
  const fills = [
    { side: "entry" as const, price: 5000, qty: 2 },
    { side: "exit" as const, price: 5010, qty: 2 },
  ];

  it("nulls gross_pl and net_pl when no point value is known", () => {
    const s = computePositionStats({
      direction: "Long",
      entry_price: 5000,
      stop_price: 4990,
      executions: fills,
    });
    expect(s.gross_pl).toBeNull();
    expect(s.net_pl).toBeNull();
    expect(s.realized_r_net).toBeNull();
    // Points and R live in price space and survive a missing spec, exactly as
    // tj_position_stats has them.
    expect(s.gross_points).toBeCloseTo(20);
    expect(s.realized_r).toBeCloseTo(1);
  });

  it("prices normally once the spec is present", () => {
    const s = computePositionStats({
      direction: "Long",
      entry_price: 5000,
      stop_price: 4990,
      point_value: 50,
      executions: fills,
    });
    expect(s.gross_pl).toBeCloseTo(1000);
    expect(s.net_pl).toBeCloseTo(1000);
  });
});

describe("golden vector read back off the live SQL view", () => {
  /**
   * The file header says this module "must stay in sync with `tj_position_stats`
   * SQL view", and until now nothing enforced it — the two could drift and only
   * a hand-comparison of two languages would notice.
   *
   * These numbers are not hand-derived. The same position and the same two
   * fills were inserted into the deployed database inside a rolled-back
   * transaction, and the view's own output was read off and pasted here. A
   * failure means the TypeScript twin has moved away from the SQL, or the SQL
   * has moved and this vector needs re-reading — either way, the two disagree.
   *
   * The case is chosen to exercise everything that differs between naive and
   * correct: a SHORT (sign flip), a PARTIAL exit (2 of 3, so entry_qty and
   * exit_qty diverge), fees and swap on both legs, and a planned entry of 100
   * against an average fill of 101 — so the R denominator uses the PLAN while
   * the numerator uses the FILL, which is the convention most likely to be
   * "simplified" by someone who has not read `excursion.ts`.
   */
  const stats = computePositionStats({
    direction: "Short",
    entry_price: 100,
    stop_price: 105,
    point_value: 2,
    executions: [
      { side: "entry", price: 101, qty: 3, fee: 1.0, swap_funding: 0.5 },
      { side: "exit", price: 96, qty: 2, fee: 0.7, swap_funding: 0.2 },
    ],
  });

  it("agrees with the view on quantities and averages", () => {
    expect(stats.entry_qty).toBe(3);
    expect(stats.exit_qty).toBe(2);
    expect(stats.avg_entry).toBe(101);
    expect(stats.avg_exit).toBe(96);
  });

  it("agrees on costs", () => {
    expect(stats.total_fees).toBeCloseTo(1.7, 10);
    expect(stats.total_swap).toBeCloseTo(0.7, 10);
  });

  it("agrees on points and money, sign flip included", () => {
    // Short: price fell from a 101 average to 96, so the move is FAVOURABLE and
    // gross_points is positive despite exit < entry.
    expect(stats.gross_points).toBeCloseTo(10, 10);
    expect(stats.gross_pl).toBeCloseTo(20, 10);
    expect(stats.net_pl).toBeCloseTo(17.6, 10);
  });

  it("agrees on R, on the plan-vs-fill convention", () => {
    // risk_pts = |planned entry 100 − stop 105| = 5, NOT |101 − 105|.
    expect(stats.planned_risk_pts).toBe(5);
    // Diluted by the whole position, not the closed part — see the note at the
    // point of calculation.
    expect(stats.realized_r).toBeCloseTo(0.66666667, 8);
    expect(stats.realized_r_net).toBeCloseTo(0.58666667, 8);
  });
});
