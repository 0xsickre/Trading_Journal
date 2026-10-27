import { describe, expect, it } from "vitest";
import {
  breakevenRangeResolver,
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
      riskShare: 0.1,
    });
  });

  it("resolves a percentage range against the starting balance", () => {
    expect(resolveBreakevenRange(cfg(-0.25, 0.1, "pct", 10_000))).toEqual({
      from: -25,
      to: 10,
      riskShare: 0.1,
    });
  });

  it("falls back to exact zero when no account is in scope", () => {
    expect(resolveBreakevenRange(null)).toEqual({ from: 0, to: 0, riskShare: 0.1 });
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

describe("every account judges a trade with a stop by its own risk (K4; phase X)", () => {
  const band = cfgRange(-16, 16);

  it("ignores any prop firm's columns: the band is the account's own", () => {
    const withTopstep = { ...cfg(-10, 0), topstep_mode: true, topstep_plan: "50K" } as ReturnType<typeof cfg>;
    expect(resolveBreakevenRange(withTopstep)).toEqual({ from: -10, to: 0, riskShare: 0.1 });
  });

  it("judges a trade with a stop against a tenth of its own risk (30.09.2026)", () => {
    // One MES contract stopped out: −$12.25 on $10 of risk is −1.23R — a loss,
    // though it sits inside ±$16.
    expect(classifyOutcome(-12.25, band, 10)).toBe("loss");
    // Two MES contracts out at +1 tick: +$0.50 on $40 of risk is a scratch.
    expect(classifyOutcome(0.5, band, 40)).toBe("breakeven");
    // The edge is inclusive, as the money band is.
    expect(classifyOutcome(4, band, 40)).toBe("breakeven");
    expect(classifyOutcome(4.01, band, 40)).toBe("win");
    // A big position: $30 on $600 of risk is 0.05R, a scratch, though past ±$16.
    expect(classifyOutcome(-30, band, 600)).toBe("breakeven");
  });

  it("falls back to the account's money band for a trade with no known risk", () => {
    expect(classifyOutcome(-15.25, band, null)).toBe("breakeven");
    expect(classifyOutcome(-15.25, band, 0)).toBe("breakeven");
    expect(classifyOutcome(-17, band)).toBe("loss");
  });

  it("a 0..0 account calls any stopped trade a loss, never a scratch", () => {
    expect(classifyOutcome(-22.25, cfgRange(0, 0), 18.75)).toBe("loss");
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
  const band = resolveBreakevenRange(cfg(-16, 16));

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
    expect(tradeOutcome(noStop, -15.25, band)).toBe("breakeven");
  });
});

describe("breakevenRangeResolver — each account's own band, for the tracker (phase X)", () => {
  const of = breakevenRangeResolver([
    { id: "a", ...cfg(-20, 20) },
    { id: "b", ...cfg(-0.1, 0.1, "pct", 50_000) },
  ]);

  it("answers each account with its own band and a tenth of a stop's risk", () => {
    expect(of("a")).toEqual({ from: -20, to: 20, riskShare: 0.1 });
    expect(of("b")).toEqual({ from: -50, to: 50, riskShare: 0.1 });
  });

  it("gives a trade with no account, or an unknown one, no money band but keeps the tenth", () => {
    expect(of(null)).toEqual({ from: 0, to: 0, riskShare: 0.1 });
    expect(of("gone")).toEqual({ from: 0, to: 0, riskShare: 0.1 });
  });
});
