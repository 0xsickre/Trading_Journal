import { describe, expect, it } from "vitest";
import { computeHoldTime, durationBucket } from "./hold-time";
import { resolveBreakevenRange } from "./breakeven";
import type { RealizedTrade } from "./analytics";
import type { PositionStat, TradeRow } from "./types";

const MIN = 60;

function trade(
  id: string,
  net: number,
  durationSeconds: number | null,
): RealizedTrade {
  const stats = { duration_seconds: durationSeconds } as PositionStat;
  return {
    id,
    closedAt: "2026-01-10T00:00:00Z",
    net,
    gross: net,
    r: null,
    row: { id, stats } as unknown as TradeRow,
  };
}

describe("computeHoldTime", () => {
  it("splits average hold time by outcome", () => {
    const stats = computeHoldTime([
      trade("w1", 100, 2 * MIN),
      trade("w2", 50, 4 * MIN),
      trade("l1", -80, 10 * MIN),
    ]);
    expect(stats.count).toBe(3);
    expect(stats.avgSeconds).toBe((16 / 3) * MIN);
    expect(stats.avgWinnerSeconds).toBe(3 * MIN);
    expect(stats.avgLoserSeconds).toBe(10 * MIN);
    expect(stats.avgBreakevenSeconds).toBeNull();
  });

  it("routes fee-only trades into the breakeven bucket when a band is set", () => {
    const range = resolveBreakevenRange({
      breakeven_from: -40,
      breakeven_to: 0,
      breakeven_unit: "currency",
      starting_balance: 10_000,
    });
    const stats = computeHoldTime(
      [trade("w1", 500, 1 * MIN), trade("be", -12.4, 9 * MIN)],
      range,
    );
    expect(stats.avgBreakevenSeconds).toBe(9 * MIN);
    expect(stats.avgLoserSeconds).toBeNull();
  });

  it("identifies the longest trade", () => {
    const stats = computeHoldTime([
      trade("a", 10, 3 * MIN),
      trade("b", 10, 21 * MIN),
      trade("c", 10, 1 * MIN),
    ]);
    expect(stats.longestSeconds).toBe(21 * MIN);
    expect(stats.longestTradeId).toBe("b");
    expect(stats.maxMinutes).toBe(21);
  });

  it("skips trades with no duration instead of counting them as zero", () => {
    const stats = computeHoldTime([
      trade("a", 10, 4 * MIN),
      trade("b", 10, null),
    ]);
    expect(stats.count).toBe(1);
    expect(stats.avgMinutes).toBe(4);
  });

  it("returns empty stats when nothing has a duration", () => {
    const stats = computeHoldTime([trade("a", 10, null)]);
    expect(stats.count).toBe(0);
    expect(stats.avgSeconds).toBeNull();
  });
});

describe("durationBucket", () => {
  it("buckets on minute boundaries (F5.1, decision L2)", () => {
    expect(durationBucket(30)).toBe("<1m");
    expect(durationBucket(59.9)).toBe("<1m");
    expect(durationBucket(1 * MIN)).toBe("1–5m");
    expect(durationBucket(4.9 * MIN)).toBe("1–5m");
    expect(durationBucket(5 * MIN)).toBe("5–15m");
    expect(durationBucket(14.9 * MIN)).toBe("5–15m");
    expect(durationBucket(15 * MIN)).toBe("15–60m");
    expect(durationBucket(59.9 * MIN)).toBe("15–60m");
    expect(durationBucket(60 * MIN)).toBe(">60m");
    expect(durationBucket(6 * 3600)).toBe(">60m");
  });

  it("returns null rather than a bucket for missing data", () => {
    expect(durationBucket(null)).toBeNull();
    expect(durationBucket(-1)).toBeNull();
  });
});

describe("hold time in minutes", () => {
  it("derives minutes from seconds for both the average and the longest", () => {
    const t = (id: string, secs: number) =>
      ({
        id,
        account_id: null,
        trade_no: null,
        status: "closed",
        source: "manual",
        needs_review: false,
        created_at: "2026-03-01T00:00:00Z",
        stats: {
          position_id: id,
          avg_entry: 100,
          avg_exit: 101,
          entry_qty: 1,
          exit_qty: 1,
          gross_pl: 1,
          net_pl: 1,
          total_fees: 0,
          realized_r: 1,
          realized_r_net: 1,
          opened_at: "2026-03-01T00:00:00Z",
          closed_at: "2026-03-02T00:00:00Z",
          duration_seconds: secs,
          point_value: 1,
          tick_size: null,
          point_value_source: "snapshot" as const,
        },
      }) as never;

    const h = computeHoldTime(
      [{ row: t("a", 60), net: 1, gross: 1, r: 1, id: "a", closedAt: "2026-03-02T00:00:00Z" }, // 1 min
       { row: t("b", 3 * 60), net: 1, gross: 1, r: 1, id: "b", closedAt: "2026-03-04T00:00:00Z" }] as never,
      resolveBreakevenRange({ breakeven_from: 0, breakeven_to: 0, breakeven_unit: "currency", starting_balance: 0 } as never),
    );
    expect(h.avgMinutes).toBeCloseTo(2, 10);
    expect(h.maxMinutes).toBeCloseTo(3, 10);
    expect(h.longestTradeId).toBe("b");
  });

  it("leaves the minute figures null when nothing has a duration", () => {
    const h = computeHoldTime([], resolveBreakevenRange({ breakeven_from: 0, breakeven_to: 0, breakeven_unit: "currency", starting_balance: 0 } as never));
    expect(h.avgMinutes).toBeNull();
    expect(h.maxMinutes).toBeNull();
  });
});
