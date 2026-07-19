import { describe, expect, it } from "vitest";
import {
  exitEfficiencyFromTrade,
  fmtExitEfficiencyPct,
  parsePlannedRewardR,
  plannedRewardFromTrade,
} from "./exit-efficiency";
import type { TradeRow } from "./types";

describe("parsePlannedRewardR", () => {
  it("parses 1:X formats", () => {
    expect(parsePlannedRewardR("1:3.00")).toBe(3);
    expect(parsePlannedRewardR("1:2")).toBe(2);
    expect(parsePlannedRewardR("1:5+")).toBe(5);
  });

  it("returns null for invalid", () => {
    expect(parsePlannedRewardR(null)).toBeNull();
    expect(parsePlannedRewardR("")).toBeNull();
    expect(parsePlannedRewardR("1:0")).toBeNull();
  });
});

describe("plannedRewardFromTrade", () => {
  it("uses planned_rr first", () => {
    const row = { planned_rr: "1:4" } as unknown as TradeRow;
    expect(plannedRewardFromTrade(row)).toBe(4);
  });

  it("falls back to prices", () => {
    const row = {
      entry_price: 100,
      stop_price: 98,
      target_price: 106,
    } as unknown as TradeRow;
    expect(plannedRewardFromTrade(row)).toBe(3);
  });
});

describe("exitEfficiencyFromTrade", () => {
  it("winner partial capture", () => {
    const row = {
      planned_rr: "1:3.00",
      stats: { realized_r: 1.2 },
    } as unknown as TradeRow;
    const r = exitEfficiencyFromTrade(row)!;
    expect(r.pct).toBeCloseTo(40);
    expect(r.ratio).toBeCloseTo(0.4);
  });

  it("loser", () => {
    const row = {
      planned_rr: "1:3.00",
      stats: { realized_r: -1 },
    } as unknown as TradeRow;
    expect(exitEfficiencyFromTrade(row)!.pct).toBeCloseTo(-33.333, 1);
  });

  it("null without planned or realized", () => {
    expect(exitEfficiencyFromTrade({ stats: {} } as TradeRow)).toBeNull();
  });
});

describe("fmtExitEfficiencyPct", () => {
  it("formats percent", () => {
    expect(fmtExitEfficiencyPct(40)).toBe("40%");
    expect(fmtExitEfficiencyPct(-33)).toBe("-33%");
  });
});
