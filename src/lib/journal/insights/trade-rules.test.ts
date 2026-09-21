import { describe, expect, it } from "vitest";
import {
  cleanHold,
  drawdownExceedsProfit,
  exceedAvgHoldTime,
  gaveBackProfit,
  redToGreen,
  revengeTrade,
  scaleIn,
  scaleOut,
  unusualSize,
} from "./trade-rules";
import { ctxOf, DAY, fired, firedTitles, mkTrade } from "./test-helpers";

// Risk is entry 100 − stop 90 = 10 points, so 1R = 10 points of price.

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

describe("cleanHold — one rule for an entry that did not hurt", () => {
  it("fires when profit is at least twice the adverse excursion", () => {
    const ctx = ctxOf([mkTrade({ id: "a", net: 200, r: 2, mae: 99 })]);
    expect(fired(cleanHold, ctx)).toEqual(["a"]);
    expect(firedTitles(cleanHold, ctx)).toEqual(["Clean hold"]);
  });

  it("names the extreme case, which used to be a rule of its own", () => {
    // `no_drawdown`: the price never came back below the entry. It could never
    // fire together with the branch above — that one needs `maeR > 0` — so two
    // ids described one observation at two degrees.
    const ctx = ctxOf([mkTrade({ id: "clean", net: 200, mae: 101 })]);
    expect(fired(cleanHold, ctx)).toEqual(["clean"]);
    expect(firedTitles(cleanHold, ctx)).toEqual(["No drawdown"]);
  });

  it("does not fire when the ratio is thin, or the trade went offside", () => {
    expect(fired(cleanHold, ctxOf([mkTrade({ id: "a", net: 60, r: 0.6, mae: 95 })]))).toEqual([]);
    expect(fired(cleanHold, ctxOf([mkTrade({ id: "b", net: 200, mae: 95, r: 0.5 })]))).toEqual([]);
  });

  it("says nothing when MAE was never recorded", () => {
    expect(fired(cleanHold, ctxOf([mkTrade({ id: "a", net: 200, mae: null })]))).toEqual([]);
  });

  it("does not need an R to call an entry clean", () => {
    // A guard the merge briefly added and `no_drawdown` never had. A winner
    // that never traded below its entry is a clean entry whether or not an R
    // can be computed for it, and narrowing that silently is how a merge
    // loses a rule while looking like it kept one.
    const ctx = ctxOf([mkTrade({ id: "a", net: 200, r: null, mae: 101 })]);
    expect(fired(cleanHold, ctx)).toEqual(["a"]);
  });
});

describe("redToGreen", () => {
  it("fires for a winner that first went offside", () => {
    const ctx = ctxOf([mkTrade({ id: "a", net: 150, r: 1.5, mae: 94 })]);
    expect(fired(redToGreen, ctx)).toEqual(["a"]);
  });
});

describe("exceedAvgHoldTime — held longer than your own history", () => {
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

  it("upgrades to critical for a loser both slower and bigger than typical", () => {
    // `loser_long_hold` was a separate rule for this case. Same observation,
    // with the outcome attached — so it is the severe branch, not a second row.
    const typicalLosers = Array.from({ length: 8 }, (_, i) =>
      mkTrade({ id: `l${i}`, net: -100, r: -1, durationSeconds: 2 * DAY }),
    );
    const ctx = ctxOf([
      ...typicalLosers,
      mkTrade({ id: "bad", net: -400, r: -4, durationSeconds: 20 * DAY }),
    ]);
    const hit = exceedAvgHoldTime.evaluate(ctx).find((i) => i.subjectId === "bad")!;
    expect(hit.severity).toBe("critical");
    expect(hit.title).toBe("Loser held too long");
  });

  it("does not call a long hold that stayed small a loser held too long", () => {
    const typicalLosers = Array.from({ length: 8 }, (_, i) =>
      mkTrade({ id: `l${i}`, net: -100, r: -1, durationSeconds: 2 * DAY }),
    );
    const ctx = ctxOf([
      ...typicalLosers,
      mkTrade({ id: "slow-small", net: -50, r: -0.5, durationSeconds: 20 * DAY }),
    ]);
    const hit = exceedAvgHoldTime.evaluate(ctx).find((i) => i.subjectId === "slow-small");
    // It may still be flagged as a long hold — but not as the costly kind.
    expect(hit?.severity).not.toBe("critical");
  });
});

describe("gaveBackProfit — five rules that were one finding", () => {
  it("fires when an above-average excursion was mostly returned", () => {
    const ordinary = Array.from({ length: 8 }, (_, i) =>
      mkTrade({ id: `o${i}`, net: 100, r: 1, mfe: 110 }),
    );
    // MFE 100 → 200 is 10R, realized 1R → 10 % capture.
    const ctx = ctxOf([
      ...ordinary,
      mkTrade({ id: "gave-back", net: 100, r: 1, mfe: 200 }),
    ]);
    const hit = gaveBackProfit.evaluate(ctx).find((i) => i.subjectId === "gave-back")!;
    expect(hit.title).toBe("Above-average move given back");
  });

  it("calls a loser that was in profit the worst case, with no history needed", () => {
    // `green_to_red`. It used to be its own rule precisely because it needs no
    // baseline, which is why the merged rule gates the BRANCH and not itself.
    const ctx = ctxOf([mkTrade({ id: "a", net: -100, r: -1, mfe: 110 })]);
    const hit = gaveBackProfit.evaluate(ctx)[0];
    expect(hit.subjectId).toBe("a");
    expect(hit.severity).toBe("critical");
    expect(hit.title).toBe("Green to red");
  });

  it("does not fire for a loser that never went green", () => {
    const ctx = ctxOf([mkTrade({ id: "a", net: -100, r: -1, mfe: 101 })]);
    expect(fired(gaveBackProfit, ctx)).toEqual([]);
  });

  it("names a full R handed back to a scratch", () => {
    const ctx = ctxOf([mkTrade({ id: "a", net: 0, r: 0, mfe: 115 })]);
    expect(firedTitles(gaveBackProfit, ctx)).toEqual(["Green to flat"]);
  });

  it("names a winner that kept under 40 % of its best move", () => {
    const ctx = ctxOf([mkTrade({ id: "a", net: 100, r: 1, mfe: 140 })]);
    expect(firedTitles(gaveBackProfit, ctx)).toEqual(["Little of the move taken"]);
  });

  it("reports a tiny win out of a large move ONCE, as low capture", () => {
    // `weak_win` was a fifth rule for this case and could never have fired on
    // its own: `r < 0.3` with an MFE of at least 1R IS a capture below 30 %,
    // which the branch above already catches. Every weak win was reported
    // twice, under two headings, as two problems. Merging the rules is what
    // made that arithmetic visible.
    const ctx = ctxOf([mkTrade({ id: "a", net: 10, r: 0.1, mfe: 130 })]);
    expect(gaveBackProfit.evaluate(ctx)).toHaveLength(1);
    expect(firedTitles(gaveBackProfit, ctx)).toEqual(["Little of the move taken"]);
  });

  it("flags an above-average peak given back on a LOSER too", () => {
    // The branch this came from had no outcome filter, and the merge briefly
    // put one in front of it. A loss whose peak beat your own average but
    // never reached the half-R the "green to red" branch asks for is still a
    // move you had and did not keep — and it was the only rule that saw it.
    const tiny = Array.from({ length: 8 }, (_, i) =>
      mkTrade({ id: `t${i}`, net: 10, r: 0.1, mfe: 101 }),
    );
    const ctx = ctxOf([
      ...tiny,
      // Peak 0.3R: above the ~0.12R average, below the 0.5R the first branch
      // needs, and handed back to a loss.
      mkTrade({ id: "loser", net: -100, r: -1, mfe: 103 }),
    ]);
    const hit = gaveBackProfit.evaluate(ctx).find((i) => i.subjectId === "loser")!;
    expect(hit.title).toBe("Above-average move given back");
  });

  it("stays quiet when most of the move was captured", () => {
    const ctx = ctxOf([mkTrade({ id: "a", net: 100, r: 1, mfe: 111 })]);
    expect(fired(gaveBackProfit, ctx)).toEqual([]);
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
