import { describe, expect, it } from "vitest";
import { bucketByPeriod, summarizePeriods } from "./period-stats";
import type { RealizedTrade } from "./analytics";
import type { PositionStat, TradeRow } from "./types";

const UTC = () => "UTC";

function trade(id: string, closedAt: string, net: number): RealizedTrade {
  return {
    id,
    closedAt,
    net,
    gross: net,
    r: null,
    row: { id, stats: {} as PositionStat } as unknown as TradeRow,
  };
}

describe("bucketByPeriod — week", () => {
  it("groups by ISO week Monday", () => {
    const rows = bucketByPeriod(
      [
        // Thu 2026-01-08 and Fri 2026-01-09 are the same ISO week (Mon 01-05).
        trade("a", "2026-01-08T12:00:00Z", 100),
        trade("b", "2026-01-09T12:00:00Z", -40),
        // Mon 2026-01-12 starts the next week.
        trade("c", "2026-01-12T12:00:00Z", 25),
      ],
      "week",
      UTC,
    );
    expect(rows.map((r) => r.key)).toEqual(["2026-01-05", "2026-01-12"]);
    expect(rows[0].net).toBe(60);
    expect(rows[0].trades).toBe(2);
    expect(rows[1].net).toBe(25);
  });

  it("attributes a multi-week swing to the week it closed", () => {
    // Opened in December, closed in January — the money arrived in January.
    const rows = bucketByPeriod(
      [trade("swing", "2026-01-08T12:00:00Z", 900)],
      "week",
      UTC,
    );
    expect(rows[0].key).toBe("2026-01-05");
  });

  it("counts wins, losses and breakeven per period", () => {
    const rows = bucketByPeriod(
      [
        trade("a", "2026-01-08T12:00:00Z", 100),
        trade("b", "2026-01-08T13:00:00Z", -50),
        trade("c", "2026-01-08T14:00:00Z", 0),
      ],
      "week",
      UTC,
    );
    expect(rows[0]).toMatchObject({ wins: 1, losses: 1, breakeven: 1 });
  });

  it("ignores trades that never closed", () => {
    const open = trade("open", "", 0);
    open.closedAt = null;
    expect(bucketByPeriod([open], "week", UTC)).toEqual([]);
  });
});

describe("bucketByPeriod — month", () => {
  it("groups by calendar month", () => {
    const rows = bucketByPeriod(
      [
        trade("a", "2026-01-31T12:00:00Z", 100),
        trade("b", "2026-02-01T12:00:00Z", 50),
      ],
      "month",
      UTC,
    );
    expect(rows.map((r) => r.key)).toEqual(["2026-01", "2026-02"]);
  });
});

describe("summarizePeriods", () => {
  const rows = [
    { key: "w1", net: 500, gross: 500, trades: 3, wins: 2, losses: 1, breakeven: 0, fees: 0, volume: 0 },
    { key: "w2", net: -200, gross: -200, trades: 2, wins: 0, losses: 2, breakeven: 0, fees: 0, volume: 0 },
    { key: "w3", net: -100, gross: -100, trades: 1, wins: 0, losses: 1, breakeven: 0, fees: 0, volume: 0 },
    { key: "w4", net: 300, gross: 300, trades: 2, wins: 2, losses: 0, breakeven: 0, fees: 0, volume: 0 },
  ];

  it("computes the period win rate on total P&L", () => {
    const s = summarizePeriods(rows);
    expect(s.periods).toBe(4);
    expect(s.winning).toBe(2);
    expect(s.losing).toBe(2);
    expect(s.winPct).toBe(50);
  });

  it("finds the best and worst period", () => {
    const s = summarizePeriods(rows);
    expect(s.largest?.key).toBe("w1");
    expect(s.smallest?.key).toBe("w2");
  });

  it("tracks consecutive winning and losing runs", () => {
    const s = summarizePeriods(rows);
    expect(s.maxConsecutiveLosing).toBe(2);
    expect(s.maxConsecutiveWinning).toBe(1);
  });

  it("averages overall and by outcome", () => {
    const s = summarizePeriods(rows);
    expect(s.avgPnl).toBe(125);
    expect(s.avgWinningPnl).toBe(400);
    expect(s.avgLosingPnl).toBe(-150);
  });

  it("excludes flat periods from the win rate denominator", () => {
    const s = summarizePeriods([
      { key: "a", net: 100, gross: 100, trades: 1, wins: 1, losses: 0, breakeven: 0, fees: 0, volume: 0 },
      { key: "b", net: 0, gross: 0, trades: 1, wins: 0, losses: 0, breakeven: 1, fees: 0, volume: 0 },
    ]);
    expect(s.flat).toBe(1);
    expect(s.winPct).toBe(100);
  });

  it("returns an empty summary for no periods", () => {
    expect(summarizePeriods([]).periods).toBe(0);
  });

  it("summarizes on whichever basis it is given", () => {
    // Same rows, different basis: net is negative, gross is positive.
    const mixed = [
      { key: "w1", net: -50, gross: 200, trades: 2, wins: 1, losses: 1, breakeven: 0, fees: 0, volume: 0 },
    ];
    expect(summarizePeriods(mixed).winPct).toBe(0);
    expect(summarizePeriods(mixed, (r) => r.gross).winPct).toBe(100);
  });

  it("reports best and worst P&L on the selected basis", () => {
    const mixed = [
      { key: "w1", net: 10, gross: 500, trades: 1, wins: 1, losses: 0, breakeven: 0, fees: 0, volume: 0 },
      { key: "w2", net: 400, gross: 50, trades: 1, wins: 1, losses: 0, breakeven: 0, fees: 0, volume: 0 },
    ];
    const net = summarizePeriods(mixed);
    expect(net.largest?.key).toBe("w2");
    expect(net.largestPnl).toBe(400);

    const gross = summarizePeriods(mixed, (r) => r.gross);
    expect(gross.largest?.key).toBe("w1");
    expect(gross.largestPnl).toBe(500);
  });
});

describe("bucketByPeriod — day", () => {
  /** A trade carrying the stats fields the day bucket sums. */
  const priced = (
    id: string,
    closedAt: string,
    net: number,
    stats: Partial<PositionStat>,
  ): RealizedTrade => ({
    id,
    closedAt,
    net,
    gross: net,
    r: null,
    row: { id, stats: stats as PositionStat } as unknown as TradeRow,
  });

  it("groups by the close DAY, and a swing lands on the day it closed", () => {
    // The whole point of close-date attribution: a position opened in December
    // pays out on the January day the money arrived, not the day the idea did.
    const rows = bucketByPeriod(
      [
        trade("a", "2026-01-08T09:00:00Z", 100),
        trade("b", "2026-01-08T21:00:00Z", -40),
        trade("swing", "2026-01-09T12:00:00Z", 900),
      ],
      "day",
      UTC,
    );
    expect(rows.map((r) => r.key)).toEqual(["2026-01-08", "2026-01-09"]);
    expect(rows[0].net).toBe(60);
    expect(rows[0].trades).toBe(2);
    expect(rows[1].net).toBe(900);
  });

  it("agrees with the week and month buckets over the same input", () => {
    // Three granularities, one attribution rule. If these ever disagree, the
    // calendar's cells and its side column would describe different books.
    const input = [
      trade("a", "2026-01-08T12:00:00Z", 100),
      trade("b", "2026-01-09T12:00:00Z", -40),
      trade("c", "2026-01-12T12:00:00Z", 25),
    ];
    const sum = (g: "day" | "week" | "month") =>
      bucketByPeriod(input, g, UTC).reduce((s, r) => s + r.net, 0);
    expect(sum("day")).toBe(85);
    expect(sum("week")).toBe(85);
    expect(sum("month")).toBe(85);
    expect(bucketByPeriod(input, "day", UTC)).toHaveLength(3);
    expect(bucketByPeriod(input, "month", UTC)).toHaveLength(1);
  });

  it("sums entry_qty as volume — a quantity, not a trade count", () => {
    const rows = bucketByPeriod(
      [
        priced("a", "2026-01-08T12:00:00Z", 100, { entry_qty: 5, total_fees: 2 }),
        priced("b", "2026-01-08T13:00:00Z", 50, { entry_qty: 3, total_fees: 1.5 }),
      ],
      "day",
      UTC,
    );
    expect(rows[0].volume).toBe(8);
    expect(rows[0].trades).toBe(2);
    expect(rows[0].fees).toBe(3.5);
  });

  it("treats a missing quantity or fee as zero, never as NaN", () => {
    // An unpriced instrument nulls the money columns; one such trade must not
    // turn the whole day's volume into NaN.
    const rows = bucketByPeriod(
      [
        priced("a", "2026-01-08T12:00:00Z", 100, { entry_qty: 4, total_fees: 1 }),
        priced("b", "2026-01-08T13:00:00Z", 0, { entry_qty: null, total_fees: null }),
      ],
      "day",
      UTC,
    );
    expect(rows[0].volume).toBe(4);
    expect(rows[0].fees).toBe(1);
  });

  it("keeps a day the trader closed nothing out of the result entirely", () => {
    const rows = bucketByPeriod([], "day", UTC);
    expect(rows).toEqual([]);
  });
});
