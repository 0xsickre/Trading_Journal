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
