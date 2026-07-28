import { describe, expect, it } from "vitest";
import {
  avgWinLossRatio,
  computePlannedRStats,
  consistencyScore,
  recoveryFactor,
} from "./risk-metrics";
import type { RealizedTrade } from "./analytics";
import type { PositionStat, TradeRow } from "./types";

function trade(
  id: string,
  plannedRr: string | null,
  realizedR: number | null,
): RealizedTrade {
  return {
    id,
    closedAt: "2026-01-10T00:00:00Z",
    net: 0,
    gross: 0,
    r: realizedR,
    row: {
      id,
      planned_rr: plannedRr,
      stats: { realized_r: realizedR } as PositionStat,
    } as unknown as TradeRow,
  };
}

describe("recoveryFactor", () => {
  it("divides net profit by the worst drawdown", () => {
    expect(recoveryFactor(3_500, -1_000)).toBe(3.5);
    expect(recoveryFactor(3_500, 1_000)).toBe(3.5); // sign-agnostic
  });

  it("is undefined rather than infinite when there was no drawdown", () => {
    expect(recoveryFactor(3_500, 0)).toBeNull();
  });

  it("goes negative for a losing book", () => {
    expect(recoveryFactor(-500, -1_000)).toBe(-0.5);
  });
});

describe("consistencyScore", () => {
  it("scores a perfectly even set at 100", () => {
    const r = consistencyScore([100, 100, 100, 100]);
    expect(r.stdev).toBe(0);
    expect(r.score).toBe(100);
  });

  it("penalises a lumpy set more than an even one", () => {
    const even = consistencyScore([100, 110, 90, 100]);
    const lumpy = consistencyScore([400, 10, 5, -15]);
    expect(lumpy.score).toBeLessThan(even.score);
  });

  it("scores zero when the book is losing", () => {
    expect(consistencyScore([-100, 50, -80]).score).toBe(0);
    expect(consistencyScore([-100, 50, -80]).raw).toBeNull();
  });

  it("handles a single trade without dividing by zero", () => {
    const r = consistencyScore([250]);
    expect(r.stdev).toBe(0);
    expect(r.score).toBe(100);
  });

  it("returns a zero score for an empty set", () => {
    const r = consistencyScore([]);
    expect(r.count).toBe(0);
    expect(r.score).toBe(0);
  });

  it("clamps into 0..100", () => {
    // Huge dispersion against a tiny total would otherwise go negative.
    const r = consistencyScore([1_000, -999, 1]);
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
  });
});

describe("computePlannedRStats", () => {
  it("averages planned and realized R over the same trades", () => {
    const stats = computePlannedRStats([
      trade("a", "2", 1),
      trade("b", "4", 2),
    ]);
    expect(stats.count).toBe(2);
    expect(stats.avgPlannedR).toBe(3);
    expect(stats.avgRealizedR).toBe(1.5);
    expect(stats.deltaR).toBe(-1.5);
  });

  it("excludes trades missing either side, so the delta stays comparable", () => {
    const stats = computePlannedRStats([
      trade("a", "2", 1),
      trade("no-plan", null, 5),
      trade("no-result", "3", null),
    ]);
    expect(stats.count).toBe(1);
    expect(stats.avgPlannedR).toBe(2);
    expect(stats.avgRealizedR).toBe(1);
  });

  it("accepts the legacy 1:N planned_rr format", () => {
    const stats = computePlannedRStats([trade("a", "1:3.00", 1.5)]);
    expect(stats.avgPlannedR).toBe(3);
  });

  it("returns nulls when nothing qualifies", () => {
    const stats = computePlannedRStats([trade("a", null, null)]);
    expect(stats.count).toBe(0);
    expect(stats.deltaR).toBeNull();
  });
});

describe("avgWinLossRatio", () => {
  it("compares magnitudes regardless of the loss sign", () => {
    expect(avgWinLossRatio(2.5, -1)).toBe(2.5);
    expect(avgWinLossRatio(2.5, 1)).toBe(2.5);
  });

  it("is undefined without losses or without wins", () => {
    expect(avgWinLossRatio(2.5, 0)).toBeNull();
    expect(avgWinLossRatio(0, -1)).toBeNull();
  });
});
