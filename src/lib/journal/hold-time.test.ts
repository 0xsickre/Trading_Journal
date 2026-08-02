import { describe, expect, it } from "vitest";
import { computeHoldTime, durationBucket } from "./hold-time";
import { resolveBreakevenRange } from "./breakeven";
import type { RealizedTrade } from "./analytics";
import type { PositionStat, TradeRow } from "./types";

const DAY = 86_400;

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
      trade("w1", 100, 2 * DAY),
      trade("w2", 50, 4 * DAY),
      trade("l1", -80, 10 * DAY),
    ]);
    expect(stats.count).toBe(3);
    expect(stats.avgSeconds).toBe((16 / 3) * DAY);
    expect(stats.avgWinnerSeconds).toBe(3 * DAY);
    expect(stats.avgLoserSeconds).toBe(10 * DAY);
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
      [trade("w1", 500, 1 * DAY), trade("be", -12.4, 9 * DAY)],
      range,
    );
    expect(stats.avgBreakevenSeconds).toBe(9 * DAY);
    expect(stats.avgLoserSeconds).toBeNull();
  });

  it("identifies the longest trade", () => {
    const stats = computeHoldTime([
      trade("a", 10, 3 * DAY),
      trade("b", 10, 21 * DAY),
      trade("c", 10, 1 * DAY),
    ]);
    expect(stats.longestSeconds).toBe(21 * DAY);
    expect(stats.longestTradeId).toBe("b");
    expect(stats.maxDays).toBe(21);
  });

  it("skips trades with no duration instead of counting them as zero", () => {
    const stats = computeHoldTime([
      trade("a", 10, 4 * DAY),
      trade("b", 10, null),
    ]);
    expect(stats.count).toBe(1);
    expect(stats.avgDays).toBe(4);
  });

  it("returns empty stats when nothing has a duration", () => {
    const stats = computeHoldTime([trade("a", 10, null)]);
    expect(stats.count).toBe(0);
    expect(stats.avgSeconds).toBeNull();
  });
});

describe("durationBucket", () => {
  it("buckets on swing boundaries", () => {
    expect(durationBucket(3600)).toBe("<1d");
    expect(durationBucket(1 * DAY)).toBe("1–3d");
    expect(durationBucket(2.9 * DAY)).toBe("1–3d");
    expect(durationBucket(3 * DAY)).toBe("3–7d");
    expect(durationBucket(6.9 * DAY)).toBe("3–7d");
    expect(durationBucket(7 * DAY)).toBe("1–2w");
    expect(durationBucket(13.9 * DAY)).toBe("1–2w");
    expect(durationBucket(14 * DAY)).toBe(">2w");
    expect(durationBucket(60 * DAY)).toBe(">2w");
  });

  it("returns null rather than a bucket for missing data", () => {
    expect(durationBucket(null)).toBeNull();
    expect(durationBucket(-1)).toBeNull();
  });
});

describe("hold time in days", () => {
  it("derives days from seconds for both the average and the longest", () => {
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
          total_swap: 0,
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
      [{ row: t("a", 86_400), net: 1, gross: 1, r: 1, id: "a", closedAt: "2026-03-02T00:00:00Z" }, // 1d
       { row: t("b", 3 * 86_400), net: 1, gross: 1, r: 1, id: "b", closedAt: "2026-03-04T00:00:00Z" }] as never,
      resolveBreakevenRange({ breakeven_from: 0, breakeven_to: 0, breakeven_unit: "currency", starting_balance: 0 } as never),
    );
    expect(h.avgDays).toBeCloseTo(2, 10);
    expect(h.maxDays).toBeCloseTo(3, 10);
    expect(h.longestTradeId).toBe("b");
  });

  it("leaves the day figures null when nothing has a duration", () => {
    const h = computeHoldTime([], resolveBreakevenRange({ breakeven_from: 0, breakeven_to: 0, breakeven_unit: "currency", starting_balance: 0 } as never));
    expect(h.avgDays).toBeNull();
    expect(h.maxDays).toBeNull();
  });
});
