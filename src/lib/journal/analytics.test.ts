import { describe, expect, it } from "vitest";
import { computeStats, toRealized } from "./analytics";
import type { TradeRow } from "./types";

function trade(
  partial: Partial<TradeRow> & {
    id: string;
    status: string;
    net_pl: number;
    realized_r?: number | null;
  },
): TradeRow {
  return {
    id: partial.id,
    account_id: null,
    trade_no: null,
    status: partial.status,
    source: "manual",
    needs_review: false,
    created_at: "2026-01-01T00:00:00Z",
    stats: {
      position_id: partial.id,
      avg_entry: null,
      avg_exit: null,
      entry_qty: 1,
      exit_qty: 1,
      gross_pl: partial.net_pl,
      net_pl: partial.net_pl,
      total_fees: 0,
      total_swap: 0,
      realized_r: partial.realized_r ?? null,
      realized_r_net: null,
      opened_at: "2026-01-01T00:00:00Z",
      closed_at: partial.status === "closed" ? "2026-01-02T00:00:00Z" : null,
      duration_seconds: null,
      point_value: 1,
    },
    ...partial,
  };
}

describe("toRealized", () => {
  it("excludes partial by default", () => {
    const trades = [
      trade({ id: "a", status: "closed", net_pl: 100, realized_r: 1 }),
      trade({ id: "b", status: "partial", net_pl: 50, realized_r: 0.5 }),
    ];
    expect(toRealized(trades)).toHaveLength(1);
    expect(toRealized(trades)[0].id).toBe("a");
  });

  it("includes partial when opted in", () => {
    const trades = [
      trade({ id: "b", status: "partial", net_pl: 50, realized_r: 0.5 }),
    ];
    expect(toRealized(trades, { includePartial: true })).toHaveLength(1);
  });
});

describe("computeStats", () => {
  it("profit factor and win rate on closed trades", () => {
    const trades = toRealized([
      trade({ id: "w", status: "closed", net_pl: 200, realized_r: 2 }),
      trade({ id: "l", status: "closed", net_pl: -100, realized_r: -1 }),
    ]);
    const s = computeStats(trades, "net");
    expect(s.winRate).toBe(50);
    expect(s.profitFactor).toBe(2);
    expect(s.totalR).toBe(1);
  });

  it("avgWin/avgLoss only from trades with valid R", () => {
    const trades = toRealized([
      trade({ id: "w1", status: "closed", net_pl: 100, realized_r: 2 }),
      trade({ id: "w2", status: "closed", net_pl: 50, realized_r: null }),
      trade({ id: "l1", status: "closed", net_pl: -100, realized_r: -1 }),
    ]);
    const s = computeStats(trades, "net");
    expect(s.wins).toBe(2);
    expect(s.avgWin).toBe(2);
    expect(s.avgLoss).toBe(-1);
    // 2W / 1L → winRate 66.7%; expectancy uses R averages only where present
    expect(s.expectancy).toBeCloseTo(1);
  });

  it("max drawdown on cumulative net", () => {
    const trades = toRealized([
      trade({ id: "1", status: "closed", net_pl: 100, realized_r: 1 }),
      trade({ id: "2", status: "closed", net_pl: -150, realized_r: -1.5 }),
      trade({ id: "3", status: "closed", net_pl: 50, realized_r: 0.5 }),
    ]);
    const s = computeStats(trades, "net");
    expect(s.maxDrawdown).toBe(-150);
  });
});
