import { describe, expect, it } from "vitest";
import {
  classifyOutcome,
  hasBreakevenBand,
  resolveBreakevenRange,
} from "./breakeven";

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

describe("a Topstep account's band is fixed by its plan (K4)", () => {
  const topstep = (plan: string) => ({ ...cfg(-500, 500), topstep_mode: true, topstep_plan: plan });

  it("is ±0.1R of the plan's starting risk budget, whatever the columns say", () => {
    // 12.5 % of the room above the MLL: 250 on a 50K, 375 on a 100K, 562.5 on a 150K.
    expect(resolveBreakevenRange(topstep("50K"))).toEqual({ from: -25, to: 25 });
    expect(resolveBreakevenRange(topstep("100K"))).toEqual({ from: -38, to: 38 });
    expect(resolveBreakevenRange(topstep("150K"))).toEqual({ from: -56, to: 56 });
  });

  it("classifies a scratch as breakeven and a real result as a win or a loss", () => {
    const band = resolveBreakevenRange(topstep("50K"));
    expect(classifyOutcome(-24.5, band)).toBe("breakeven");
    expect(classifyOutcome(26, band)).toBe("win");
    expect(classifyOutcome(-30, band)).toBe("loss");
  });

  it("an account not in Topstep mode keeps its own columns", () => {
    expect(resolveBreakevenRange({ ...cfg(-10, 0), topstep_mode: false, topstep_plan: "50K" })).toEqual({
      from: -10,
      to: 0,
    });
  });
});
