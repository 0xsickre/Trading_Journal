import { describe, expect, it } from "vitest";
import {
  cleanHold,
  drawdownExceedsProfit,
  exceedAvgHoldTime,
  gaveBackProfit,
  greenToBreakeven,
  greenToRed,
  loserLongHold,
  maximizeYourProfit,
  noDrawdown,
  redToGreen,
  revengeTrade,
  scaleIn,
  scaleOut,
  unusualSize,
  weakWin,
} from "./trade-rules";
import { ctxOf, DAY, fired, mkTrade } from "./test-helpers";

// Risk is entry 100 − stop 90 = 10 points, so 1R = 10 points of price.

describe("noDrawdown", () => {
  it("fires for a winner that never traded below entry", () => {
    const ctx = ctxOf([mkTrade({ id: "clean", net: 200, mae: 101 })]);
    expect(fired(noDrawdown, ctx)).toEqual(["clean"]);
  });

  it("does not fire when the trade went offside", () => {
    const ctx = ctxOf([mkTrade({ id: "dirty", net: 200, mae: 95 })]);
    expect(fired(noDrawdown, ctx)).toEqual([]);
  });

  it("does not fire when MAE was never recorded", () => {
    const ctx = ctxOf([mkTrade({ id: "unknown", net: 200, mae: null })]);
    expect(fired(noDrawdown, ctx)).toEqual([]);
  });
});

describe("drawdownExceedsProfit", () => {
  it("fires when MAE in R is larger than realized R", () => {
    // MAE 95 → 0.5R offside; realized 0.3R.
    const ctx = ctxOf([mkTrade({ id: "a", net: 30, r: 0.3, mae: 95 })]);
    expect(fired(drawdownExceedsProfit, ctx)).toEqual(["a"]);
  });

  it("does not fire when the profit exceeded the excursion", () => {
    const ctx = ctxOf([mkTrade({ id: "a", net: 200, r: 2, mae: 95 })]);
    expect(fired(drawdownExceedsProfit, ctx)).toEqual([]);
  });

  it("ignores losers — the rule is about a flattering R-multiple", () => {
    const ctx = ctxOf([mkTrade({ id: "a", net: -100, r: -1, mae: 95 })]);
    expect(fired(drawdownExceedsProfit, ctx)).toEqual([]);
  });
});

describe("cleanHold", () => {
  it("fires when profit is at least twice the adverse excursion", () => {
    const ctx = ctxOf([mkTrade({ id: "a", net: 200, r: 2, mae: 99 })]);
    expect(fired(cleanHold, ctx)).toEqual(["a"]);
  });

  it("does not fire when the ratio is thin", () => {
    const ctx = ctxOf([mkTrade({ id: "a", net: 60, r: 0.6, mae: 95 })]);
    expect(fired(cleanHold, ctx)).toEqual([]);
  });
});

describe("greenToRed", () => {
  it("fires for a loser that was meaningfully in profit", () => {
    const ctx = ctxOf([mkTrade({ id: "a", net: -100, r: -1, mfe: 110 })]);
    expect(fired(greenToRed, ctx)).toEqual(["a"]);
  });

  it("does not fire when the loser never went green", () => {
    const ctx = ctxOf([mkTrade({ id: "a", net: -100, r: -1, mfe: 101 })]);
    expect(fired(greenToRed, ctx)).toEqual([]);
  });
});

describe("greenToBreakeven", () => {
  it("fires when a full R of profit ended at zero", () => {
    const ctx = ctxOf([mkTrade({ id: "a", net: 0, r: 0, mfe: 115 })]);
    expect(fired(greenToBreakeven, ctx)).toEqual(["a"]);
  });
});

describe("redToGreen", () => {
  it("fires for a winner that first went offside", () => {
    const ctx = ctxOf([mkTrade({ id: "a", net: 150, r: 1.5, mae: 94 })]);
    expect(fired(redToGreen, ctx)).toEqual(["a"]);
  });
});

describe("exceedAvgHoldTime", () => {
  const many = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      mkTrade({ id: `w${i}`, net: 100, durationSeconds: 2 * DAY }),
    );

  it("stays silent until the baseline has enough winners", () => {
    const ctx = ctxOf([mkTrade({ id: "long", durationSeconds: 30 * DAY })]);
    expect(ctx.baseline.sample).toBeLessThan(exceedAvgHoldTime.minSample);
  });

  it("fires for a hold beyond the 75th percentile of winners", () => {
    const ctx = ctxOf([
      ...many(8),
      mkTrade({ id: "long", net: 100, durationSeconds: 30 * DAY }),
    ]);
    expect(fired(exceedAvgHoldTime, ctx)).toContain("long");
  });
});

describe("loserLongHold", () => {
  it("fires only when the loser is both slower and bigger than typical", () => {
    const typicalLosers = Array.from({ length: 8 }, (_, i) =>
      mkTrade({
        id: `l${i}`,
        net: -100,
        r: -1,
        durationSeconds: 2 * DAY,
      }),
    );
    const ctx = ctxOf([
      ...typicalLosers,
      mkTrade({ id: "bad", net: -400, r: -4, durationSeconds: 20 * DAY }),
    ]);
    expect(fired(loserLongHold, ctx)).toEqual(["bad"]);
  });

  it("does not fire for a long hold that stayed small", () => {
    const typicalLosers = Array.from({ length: 8 }, (_, i) =>
      mkTrade({ id: `l${i}`, net: -100, r: -1, durationSeconds: 2 * DAY }),
    );
    const ctx = ctxOf([
      ...typicalLosers,
      mkTrade({ id: "slow-small", net: -50, r: -0.5, durationSeconds: 20 * DAY }),
    ]);
    expect(fired(loserLongHold, ctx)).toEqual([]);
  });
});

describe("gaveBackProfit", () => {
  it("fires when an above-average excursion was mostly returned", () => {
    const ordinary = Array.from({ length: 8 }, (_, i) =>
      mkTrade({ id: `o${i}`, net: 100, r: 1, mfe: 110 }),
    );
    // MFE 100 → 200 is 10R, realized 1R → 10 % capture.
    const ctx = ctxOf([
      ...ordinary,
      mkTrade({ id: "gave-back", net: 100, r: 1, mfe: 200 }),
    ]);
    expect(fired(gaveBackProfit, ctx)).toEqual(["gave-back"]);
  });
});

describe("maximizeYourProfit", () => {
  it("fires for a winner that kept under 40 % of its best move", () => {
    const ctx = ctxOf([mkTrade({ id: "a", net: 100, r: 1, mfe: 140 })]);
    expect(fired(maximizeYourProfit, ctx)).toEqual(["a"]);
  });

  it("does not fire when most of the move was captured", () => {
    const ctx = ctxOf([mkTrade({ id: "a", net: 100, r: 1, mfe: 111 })]);
    expect(fired(maximizeYourProfit, ctx)).toEqual([]);
  });
});

describe("weakWin", () => {
  it("fires for a tiny win out of a large available move", () => {
    const ctx = ctxOf([mkTrade({ id: "a", net: 10, r: 0.1, mfe: 130 })]);
    expect(fired(weakWin, ctx)).toEqual(["a"]);
  });

  it("does not fire when the win was substantial", () => {
    const ctx = ctxOf([mkTrade({ id: "a", net: 200, r: 2, mfe: 130 })]);
    expect(fired(weakWin, ctx)).toEqual([]);
  });
});

describe("revengeTrade", () => {
  it("fires for a losing entry opened the day after another loss", () => {
    const ctx = ctxOf([
      mkTrade({
        id: "first",
        net: -100,
        r: -1,
        openedAt: "2026-01-01T10:00:00Z",
        closedAt: "2026-01-05T10:00:00Z",
      }),
      mkTrade({
        id: "revenge",
        net: -150,
        r: -1.5,
        openedAt: "2026-01-05T18:00:00Z",
        closedAt: "2026-01-08T10:00:00Z",
      }),
    ]);
    expect(fired(revengeTrade, ctx)).toEqual(["revenge"]);
  });

  it("does not fire when the re-entry came a week later", () => {
    const ctx = ctxOf([
      mkTrade({
        id: "first",
        net: -100,
        r: -1,
        openedAt: "2026-01-01T10:00:00Z",
        closedAt: "2026-01-05T10:00:00Z",
      }),
      mkTrade({
        id: "later",
        net: -150,
        r: -1.5,
        openedAt: "2026-01-14T10:00:00Z",
        closedAt: "2026-01-20T10:00:00Z",
      }),
    ]);
    expect(fired(revengeTrade, ctx)).toEqual([]);
  });

  it("does not fire when the quick re-entry won", () => {
    const ctx = ctxOf([
      mkTrade({
        id: "first",
        net: -100,
        r: -1,
        openedAt: "2026-01-01T10:00:00Z",
        closedAt: "2026-01-05T10:00:00Z",
      }),
      mkTrade({
        id: "recovered",
        net: 300,
        r: 3,
        openedAt: "2026-01-05T18:00:00Z",
        closedAt: "2026-01-08T10:00:00Z",
      }),
    ]);
    expect(fired(revengeTrade, ctx)).toEqual([]);
  });
});

describe("scaleIn / scaleOut", () => {
  it("fires from the fill counts", () => {
    const fills = new Map([["a", { entries: 3, exits: 2 }]]);
    const ctx = ctxOf([mkTrade({ id: "a" })], { fillCounts: fills });
    expect(fired(scaleIn, ctx)).toEqual(["a"]);
    expect(fired(scaleOut, ctx)).toEqual(["a"]);
  });

  it("stays silent for a single-fill trade", () => {
    const fills = new Map([["a", { entries: 1, exits: 1 }]]);
    const ctx = ctxOf([mkTrade({ id: "a" })], { fillCounts: fills });
    expect(fired(scaleIn, ctx)).toEqual([]);
    expect(fired(scaleOut, ctx)).toEqual([]);
  });
});

describe("unusualSize", () => {
  it("fires above the 75th percentile of your own sizes", () => {
    const normal = Array.from({ length: 8 }, (_, i) =>
      mkTrade({ id: `n${i}`, size: 1 }),
    );
    const ctx = ctxOf([...normal, mkTrade({ id: "big", size: 5 })]);
    expect(fired(unusualSize, ctx)).toEqual(["big"]);
  });

  it("is silent when no size was recorded", () => {
    const ctx = ctxOf(
      Array.from({ length: 9 }, (_, i) => mkTrade({ id: `n${i}`, size: null })),
    );
    expect(fired(unusualSize, ctx)).toEqual([]);
  });
});
