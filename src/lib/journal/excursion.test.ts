import { describe, expect, it } from "vitest";
import { computeExcursionStats, excursionFromTrade } from "./excursion";
import type { PositionStat, TradeRow } from "./types";

function row(overrides: Record<string, unknown>): TradeRow {
  return {
    id: "t",
    direction: "Long",
    entry_price: 100,
    stop_price: 90, // risk = 10 points
    stats: { avg_entry: 100, realized_r: null } as PositionStat,
    ...overrides,
  } as unknown as TradeRow;
}

describe("excursionFromTrade — long", () => {
  it("expresses adverse excursion in R", () => {
    // Went to 95: 5 points offside on 10 points of risk = 0.5R.
    const e = excursionFromTrade(row({ max_drawdown_price: 95 }));
    expect(e.maeR).toBe(0.5);
  });

  it("expresses favourable excursion in R", () => {
    const e = excursionFromTrade(row({ max_profit_price: 130 }));
    expect(e.mfeR).toBe(3);
  });

  it("records zero rather than null when the trade never went offside", () => {
    // MAE above entry means it was never adverse — that is data, not absence.
    const e = excursionFromTrade(row({ max_drawdown_price: 102 }));
    expect(e.maeR).toBe(0);
  });

  it("computes capture as realized R over MFE R", () => {
    const e = excursionFromTrade(
      row({
        max_profit_price: 130,
        stats: { avg_entry: 100, realized_r: 1.5 } as PositionStat,
      }),
    );
    expect(e.mfeR).toBe(3);
    expect(e.capturePct).toBe(50);
  });
});

describe("excursionFromTrade — short", () => {
  it("inverts the geometry", () => {
    const short = row({
      direction: "Short",
      entry_price: 100,
      stop_price: 110, // risk = 10
      max_drawdown_price: 105, // 5 offside for a short
      max_profit_price: 80, // 20 onside
    });
    const e = excursionFromTrade(short);
    expect(e.maeR).toBe(0.5);
    expect(e.mfeR).toBe(2);
  });
});

describe("excursionFromTrade — missing inputs", () => {
  it("returns nulls without a stop", () => {
    const e = excursionFromTrade(row({ stop_price: null, max_drawdown_price: 95 }));
    expect(e).toEqual({ maeR: null, mfeR: null, capturePct: null });
  });

  it("returns nulls without an average entry", () => {
    const e = excursionFromTrade(
      row({ stats: { avg_entry: null } as PositionStat, max_drawdown_price: 95 }),
    );
    expect(e.maeR).toBeNull();
  });

  it("leaves an unrecorded excursion null rather than zero", () => {
    const e = excursionFromTrade(row({}));
    expect(e.maeR).toBeNull();
    expect(e.mfeR).toBeNull();
  });

  it("falls back to the average fill when there is no planned entry", () => {
    const e = excursionFromTrade(
      row({
        entry_price: null,
        stats: { avg_entry: 100, realized_r: null } as PositionStat,
        max_drawdown_price: 95,
      }),
    );
    expect(e.maeR).toBe(0.5);
  });
});

describe("computeExcursionStats", () => {
  it("averages only over trades that recorded an excursion", () => {
    const stats = computeExcursionStats([
      { row: row({ max_drawdown_price: 95 }) }, // 0.5R
      { row: row({ max_drawdown_price: 85 }) }, // 1.5R
      { row: row({}) }, // no MAE recorded
    ]);
    expect(stats.maeCount).toBe(2);
    expect(stats.avgMaeR).toBe(1);
    expect(stats.worstMaeR).toBe(1.5);
  });

  it("counts trades that never went into drawdown", () => {
    const stats = computeExcursionStats([
      { row: row({ max_drawdown_price: 101 }) },
      { row: row({ max_drawdown_price: 95 }) },
    ]);
    expect(stats.noDrawdownCount).toBe(1);
  });

  it("reports nulls for an empty scope", () => {
    const stats = computeExcursionStats([]);
    expect(stats.avgMaeR).toBeNull();
    expect(stats.worstMaeR).toBeNull();
  });
});

describe("R convention: fill-based numerator, plan-based denominator", () => {
  // A slipped entry is the case that separates the two references: planned
  // entry 100, actual fill 101, stop 90.
  const slipped = {
    direction: "Long",
    entry_price: 100,
    stop_price: 90,
    max_profit_price: 120,
    max_drawdown_price: 95,
    stats: { avg_entry: 101, realized_r: null },
  } as unknown as TradeRow;

  it("measures movement from the actual fill, not the planned entry", () => {
    const e = excursionFromTrade(slipped);
    // MFE points = 120 - 101 (fill), NOT 120 - 100 (plan). Risk = |100-90| = 10.
    expect(e.mfeR).toBeCloseTo(19 / 10, 10);
    // MAE points = 101 - 95 = 6, over the same planned 10-point risk.
    expect(e.maeR).toBeCloseTo(6 / 10, 10);
  });

  it("keeps capturePct consistent with how realized_r is computed", () => {
    // realized_r is (exit - avg_entry) / (|plan entry - stop|) — fill-based
    // numerator, plan-based denominator. Reproduce it for an exit at 120 and
    // confirm capture reads as a full 100%: the trade captured the entire
    // favourable move. If mfeR were re-based onto the planned entry while
    // realized_r stayed as it is, this would silently drift off 100%.
    const realizedR = (120 - 101) / Math.abs(100 - 90);
    const withExit = {
      ...slipped,
      stats: { avg_entry: 101, realized_r: realizedR },
    } as unknown as TradeRow;

    const e = excursionFromTrade(withExit);
    expect(e.capturePct).toBeCloseTo(100, 10);
  });
});
