import { describe, expect, it } from "vitest";
import { computeTimeStop } from "./time-stop";
import type { RealizedTrade } from "./analytics";
import type { PositionStat, TradeRow } from "./types";

const MIN = 60;

function trade(
  id: string,
  net: number,
  durationSeconds: number | null,
  lastUnderwater: number | null,
  underwaterPct: number | null,
): RealizedTrade {
  const stats = { duration_seconds: durationSeconds } as PositionStat;
  return {
    id,
    closedAt: "2026-10-09T15:00:00Z",
    net,
    gross: net,
    r: null,
    row: {
      id,
      stats,
      last_underwater_seconds: lastUnderwater,
      time_underwater_pct: underwaterPct,
    } as unknown as TradeRow,
  };
}

describe("computeTimeStop", () => {
  it("reads the winners' time to green and the losers' time in the red", () => {
    const s = computeTimeStop([
      trade("w1", 100, 10 * MIN, 0, 0),
      trade("w2", 100, 10 * MIN, 2 * MIN, 20),
      trade("w3", 100, 20 * MIN, 4 * MIN, 20),
      trade("l1", -50, 6 * MIN, 6 * MIN, 50),
      trade("l2", -50, 2 * MIN, 2 * MIN, 100),
    ]);
    expect(s.winners).toBe(3);
    expect(s.winnersNeverRed).toBe(1);
    expect(s.medianToGreenSeconds).toBe(2 * MIN);
    expect(s.losers).toBe(2);
    // 50 % of 6 min and 100 % of 2 min
    expect(s.avgLoserRedSeconds).toBe(2.5 * MIN);
    expect(s.avgLoserSeconds).toBe(4 * MIN);
  });

  it("puts winners cut and losers still open side by side per minute", () => {
    const s = computeTimeStop([
      trade("w1", 100, 10 * MIN, 0, 0),
      trade("w2", 100, 10 * MIN, 2 * MIN, 20),
      trade("w3", 100, 20 * MIN, 4 * MIN, 20),
      trade("l1", -50, 6 * MIN, 6 * MIN, 50),
      trade("l2", -50, 2 * MIN, 2 * MIN, 100),
    ]);
    const at = (m: number) => s.ladder.find((r) => r.minutes === m)!;
    // green exactly at N counts as green — the boundary is inclusive
    expect(at(2).winnersGreenPct).toBeCloseTo(200 / 3);
    expect(at(2).losersOpenPct).toBe(50);
    expect(at(5).winnersGreenPct).toBe(100);
    expect(at(5).losersOpenPct).toBe(50);
    expect(at(10).losersOpenPct).toBe(0);
  });

  it("skips what was never measured instead of counting it as zero", () => {
    const s = computeTimeStop([
      trade("w1", 100, 10 * MIN, null, null),
      trade("l1", -50, 6 * MIN, null, null),
      trade("l2", -50, null, null, 40),
    ]);
    expect(s.winners).toBe(0);
    expect(s.losers).toBe(0);
    expect(s.medianToGreenSeconds).toBeNull();
    expect(s.ladder.every((r) => r.winnersGreenPct == null && r.losersOpenPct == null)).toBe(true);
  });

  it("leaves breakeven trades out of both sides", () => {
    const s = computeTimeStop([trade("b1", 0, 5 * MIN, 5 * MIN, 100)]);
    expect(s.winners + s.losers).toBe(0);
  });
});
