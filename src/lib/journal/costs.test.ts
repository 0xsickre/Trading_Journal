import { describe, expect, it } from "vitest";
import { computeCostStats } from "./costs";
import type { RealizedTrade } from "./analytics";
import type { PositionStat, TradeRow } from "./types";

const DAY = 86_400;

function trade(
  id: string,
  gross: number,
  fees: number,
  durationSeconds: number | null = DAY,
): RealizedTrade {
  const stats = {
    total_fees: fees,
    duration_seconds: durationSeconds,
  } as PositionStat;
  return {
    id,
    closedAt: "2026-01-10T00:00:00Z",
    net: gross - fees,
    gross,
    r: null,
    row: { id, stats } as unknown as TradeRow,
  };
}

describe("computeCostStats", () => {
  it("totals the fees", () => {
    const c = computeCostStats([trade("a", 1_000, 12), trade("b", -200, 8)]);
    expect(c.totalFees).toBe(20);
    expect(c.totalCosts).toBe(20);
  });

  it("measures cost against gross profit, not against net", () => {
    // Only the winner contributes gross profit: 1000. Costs 100 → 10 %.
    const c = computeCostStats([
      trade("win", 1_000, 100),
      trade("lose", -400, 0),
    ]);
    expect(c.grossProfit).toBe(1_000);
    expect(c.costPctOfGross).toBe(10);
  });

  it("reports a fee rebate as a negative share, not a cost", () => {
    // A negative fee is money credited back; an absolute value here would flip
    // it into an apparent expense.
    const c = computeCostStats([trade("win", 1_000, -50)]);
    expect(c.totalCosts).toBe(-50);
    expect(c.costPctOfGross).toBe(-5);
  });

  it("reports no cost ratio when there was no gross profit", () => {
    const c = computeCostStats([trade("lose", -400, 15)]);
    expect(c.grossProfit).toBe(0);
    expect(c.costPctOfGross).toBeNull();
  });

  it("distinguishes zero costs from absent cost data", () => {
    // Totals are 0 either way, so the coverage count is what tells the truth.
    const noData = computeCostStats([trade("a", 100, 0), trade("b", 50, 0)]);
    expect(noData.totalCosts).toBe(0);
    expect(noData.count).toBe(2);
    expect(noData.withCostData).toBe(0);

    const someData = computeCostStats([
      trade("a", 100, 3),
      trade("b", 50, 0),
    ]);
    expect(someData.withCostData).toBe(1);
  });

  it("returns empty stats for an empty scope", () => {
    expect(computeCostStats([]).count).toBe(0);
  });
});
