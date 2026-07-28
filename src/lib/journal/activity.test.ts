import { describe, expect, it } from "vitest";
import {
  computeDirectionSplit,
  countLoggedDays,
  tradingDayKeysFromRows,
} from "./activity";
import type { RealizedTrade } from "./analytics";
import type { PositionStat, TradeRow } from "./types";

function trade(
  id: string,
  direction: string,
  net: number,
  openedAt: string | null = "2026-01-05T10:00:00Z",
  closedAt: string | null = "2026-01-09T10:00:00Z",
): RealizedTrade {
  return {
    id,
    closedAt,
    net,
    gross: net,
    r: null,
    row: {
      id,
      direction,
      stats: { opened_at: openedAt } as PositionStat,
    } as unknown as TradeRow,
  };
}

describe("computeDirectionSplit", () => {
  it("splits counts and win rate by direction", () => {
    const s = computeDirectionSplit([
      trade("a", "Long", 100),
      trade("b", "Long", -50),
      trade("c", "Short", 200),
      trade("d", "Short", 300),
    ]);
    expect(s.longs.count).toBe(2);
    expect(s.longs.winRate).toBe(50);
    expect(s.shorts.count).toBe(2);
    expect(s.shorts.winRate).toBe(100);
    expect(s.shorts.net).toBe(500);
  });

  it("treats an unknown direction as long rather than dropping the trade", () => {
    const s = computeDirectionSplit([trade("a", "", 100)]);
    expect(s.longs.count).toBe(1);
    expect(s.shorts.count).toBe(0);
  });

  it("reports a zero win rate when every trade was breakeven", () => {
    const s = computeDirectionSplit([trade("a", "Long", 0)]);
    expect(s.longs.breakeven).toBe(1);
    expect(s.longs.winRate).toBe(0);
  });
});

describe("countLoggedDays", () => {
  it("counts distinct journal dates", () => {
    expect(countLoggedDays(["2026-01-05", "2026-01-05", "2026-01-06"])).toBe(2);
  });

  it("respects a date window", () => {
    const dates = ["2026-01-01", "2026-01-15", "2026-02-01"];
    expect(countLoggedDays(dates, "2026-01-10", "2026-01-31")).toBe(1);
  });

  it("ignores empty entries", () => {
    expect(countLoggedDays(["", "2026-01-05"])).toBe(1);
  });
});

describe("tradingDayKeysFromRows", () => {
  it("counts open positions, not just closed ones", () => {
    // A position opened this week and still running is a day the market was
    // engaged; counting only realized trades would omit it.
    const rows = [
      { account_id: "a", stats: { opened_at: "2026-01-05T09:00:00Z" } },
      { account_id: "a", stats: { opened_at: "2026-01-06T09:00:00Z" } },
    ] as unknown as TradeRow[];
    expect([...tradingDayKeysFromRows(rows, () => "UTC")]).toEqual([
      "2026-01-05",
      "2026-01-06",
    ]);
  });

  it("falls back to the close date and skips rows with neither", () => {
    const rows = [
      { stats: { opened_at: null, closed_at: "2026-02-02T09:00:00Z" } },
      { stats: { opened_at: null, closed_at: null } },
      { stats: null },
    ] as unknown as TradeRow[];
    expect([...tradingDayKeysFromRows(rows, () => "UTC")]).toEqual([
      "2026-02-02",
    ]);
  });
});
