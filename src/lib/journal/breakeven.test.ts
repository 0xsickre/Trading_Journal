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
