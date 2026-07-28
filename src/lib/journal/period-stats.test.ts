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
    { key: "w1", net: 500, gross: 500, trades: 3, wins: 2, losses: 1, breakeven: 0 },
    { key: "w2", net: -200, gross: -200, trades: 2, wins: 0, losses: 2, breakeven: 0 },
    { key: "w3", net: -100, gross: -100, trades: 1, wins: 0, losses: 1, breakeven: 0 },
    { key: "w4", net: 300, gross: 300, trades: 2, wins: 2, losses: 0, breakeven: 0 },
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
      { key: "a", net: 100, gross: 100, trades: 1, wins: 1, losses: 0, breakeven: 0 },
      { key: "b", net: 0, gross: 0, trades: 1, wins: 0, losses: 0, breakeven: 1 },
    ]);
    expect(s.flat).toBe(1);
    expect(s.winPct).toBe(100);
  });

  it("returns an empty summary for no periods", () => {
    expect(summarizePeriods([]).periods).toBe(0);
  });
});
