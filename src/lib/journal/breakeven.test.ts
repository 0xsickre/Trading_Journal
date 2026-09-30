import { describe, expect, it } from "vitest";
import {
  classifyOutcome,
  hasBreakevenBand,
  resolveBreakevenRange,
  tradeOutcome,
} from "./breakeven";
import { computeStats, toRealized } from "./analytics";
import type { PositionStat, TradeRow } from "./types";

const cfg = (
  from: number,
  to: number,
  unit: "currency" | "pct" = "currency",
  balance = 10_000,
) => ({
  breakeven_from: from,
  breakeven_to: to,
  breakeven_unit: unit,
  starting_balance: balance,
});

describe("resolveBreakevenRange", () => {
  it("passes currency ranges through untouched", () => {
    expect(resolveBreakevenRange(cfg(-37.5, 0))).toEqual({
      from: -37.5,
      to: 0,
    });
  });

  it("resolves a percentage range against the starting balance", () => {
    expect(resolveBreakevenRange(cfg(-0.25, 0.1, "pct", 10_000))).toEqual({
      from: -25,
      to: 10,
    });
  });

  it("falls back to exact zero when no account is in scope", () => {
    expect(resolveBreakevenRange(null)).toEqual({ from: 0, to: 0 });
  });
});

describe("classifyOutcome", () => {
  it("reproduces exact-zero behaviour with the default 0..0 band", () => {
    const range = resolveBreakevenRange(cfg(0, 0));
    expect(classifyOutcome(0.01, range)).toBe("win");
    expect(classifyOutcome(0, range)).toBe("breakeven");
    expect(classifyOutcome(-0.01, range)).toBe("loss");
  });

  it("treats an asymmetric band as breakeven on both ends inclusive", () => {
    const range = resolveBreakevenRange(cfg(-37.5, 0));
    expect(classifyOutcome(-37.5, range)).toBe("breakeven");
    expect(classifyOutcome(-20, range)).toBe("breakeven");
    expect(classifyOutcome(0, range)).toBe("breakeven");
    expect(classifyOutcome(-37.51, range)).toBe("loss");
    expect(classifyOutcome(0.01, range)).toBe("win");
  });

  it("does not treat the band as symmetric", () => {
    // -37.50..0 must NOT swallow +37.50; that would inflate the breakeven bucket
    // with real winners.
    const range = resolveBreakevenRange(cfg(-37.5, 0));
    expect(classifyOutcome(37.5, range)).toBe("win");
  });

  it("classifies a fee-only loss as breakeven once a band is configured", () => {
    // The case the old `p === 0` test could never catch.
    const range = resolveBreakevenRange(cfg(-40, 0));
    expect(classifyOutcome(-12.4, range)).toBe("breakeven");
  });

  it("defaults to exact zero when no range is passed", () => {
    expect(classifyOutcome(0)).toBe("breakeven");
    expect(classifyOutcome(-1)).toBe("loss");
  });
});

describe("hasBreakevenBand", () => {
  it("is false for the default band and true once configured", () => {
    expect(hasBreakevenBand({ from: 0, to: 0 })).toBe(false);
    expect(hasBreakevenBand({ from: -37.5, to: 0 })).toBe(true);
  });
});

const cfgRange = (from: number, to: number) => resolveBreakevenRange(cfg(from, to));

describe("a Topstep account's band is fixed by its plan (K4)", () => {
  const topstep = (plan: string) => ({ ...cfg(-500, 500), topstep_mode: true, topstep_plan: plan });

  it("is ±0.1R of the plan's starting risk budget, whatever the columns say", () => {
    // 12.5 % of the room above the MLL: 250 on a 50K, 375 on a 100K, 562.5 on a 150K.
    expect(resolveBreakevenRange(topstep("50K"))).toEqual({ from: -25, to: 25, riskShare: 0.1 });
    expect(resolveBreakevenRange(topstep("100K"))).toEqual({ from: -38, to: 38, riskShare: 0.1 });
    expect(resolveBreakevenRange(topstep("150K"))).toEqual({ from: -56, to: 56, riskShare: 0.1 });
  });

  it("classifies a scratch as breakeven and a real result as a win or a loss", () => {
    const band = resolveBreakevenRange(topstep("50K"));
    expect(classifyOutcome(-24.5, band)).toBe("breakeven");
    expect(classifyOutcome(26, band)).toBe("win");
    expect(classifyOutcome(-30, band)).toBe("loss");
  });

  it("judges a trade with a stop against its own risk, not the plan's (30.09.2026)", () => {
    const band = resolveBreakevenRange(topstep("50K"));
    // One MES contract stopped out: −$22.25 on $18.75 of risk is −1.19R — a loss,
    // though it sits inside ±$25.
    expect(classifyOutcome(-22.25, band, 18.75)).toBe("loss");
    // Two MES contracts out at +1 tick: +$0.50 on $40 of risk is a scratch.
    expect(classifyOutcome(0.5, band, 40)).toBe("breakeven");
    // The edge is inclusive, as the money band is.
    expect(classifyOutcome(4, band, 40)).toBe("breakeven");
    expect(classifyOutcome(4.01, band, 40)).toBe("win");
    // A big position: $30 on $600 of risk is 0.05R, a scratch, though past ±$25.
    expect(classifyOutcome(-30, band, 600)).toBe("breakeven");
  });

  it("falls back to the plan's money band for a trade with no known risk", () => {
    const band = resolveBreakevenRange(topstep("50K"));
    expect(classifyOutcome(-22.25, band, null)).toBe("breakeven");
    expect(classifyOutcome(-22.25, band, 0)).toBe("breakeven");
    expect(classifyOutcome(-26, band)).toBe("loss");
  });

  it("an account's own columns ignore the trade's risk", () => {
    expect(classifyOutcome(-22.25, cfgRange(-25, 25), 18.75)).toBe("breakeven");
  });

  it("an account not in Topstep mode keeps its own columns", () => {
    expect(resolveBreakevenRange({ ...cfg(-10, 0), topstep_mode: false, topstep_plan: "50K" })).toEqual({
      from: -10,
      to: 0,
    });
  });
});

describe("the book's statistics judge each trade against its own risk (30.09.2026)", () => {
  // The mock book's #2 and #8: one MES contract stopped out, and two scratched at +1 tick.
  const mes = (id: string, qty: number, stop: number, net: number, avgEntry: number): TradeRow =>
    ({
      id,
      account_id: "ts",
      trade_no: 1,
      status: "closed",
      source: "manual",
      needs_review: false,
      created_at: "2026-09-22T13:00:00Z",
      entry_price: avgEntry,
      stop_price: stop,
      stats: {
        position_id: id,
        avg_entry: avgEntry,
        entry_qty: qty,
        point_value: 5,
        fx_rate: 1,
        net_pl: net,
        gross_pl: net,
        realized_r: net / (Math.abs(avgEntry - stop) * qty * 5),
        opened_at: "2026-09-22T15:10:00Z",
        closed_at: "2026-09-22T15:24:00Z",
      } as PositionStat,
      tv_images: {},
    }) as unknown as TradeRow;
  const band = resolveBreakevenRange({ ...cfg(0, 0), topstep_mode: true, topstep_plan: "50K" });

  it("counts a stopped micro trade as a loss and a one-tick exit as a scratch", () => {
    const stopped = mes("a", 1, 7704, -22.25, 7700.25);
    const scratch = mes("b", 2, 7716, 0.5, 7720);
    expect(tradeOutcome(stopped, -22.25, band)).toBe("loss");
    expect(tradeOutcome(scratch, 0.5, band)).toBe("breakeven");

    const s = computeStats(toRealized([stopped, scratch]), "net", band);
    expect([s.wins, s.losses, s.breakeven]).toEqual([0, 1, 1]);
    expect(s.expectancySample).toBe(1);
  });

  it("uses the money band for a trade with no stop", () => {
    const noStop = { ...mes("c", 1, 7704, -22.25, 7700.25), stop_price: null } as TradeRow;
    expect(tradeOutcome(noStop, -22.25, band)).toBe("breakeven");
  });
});
