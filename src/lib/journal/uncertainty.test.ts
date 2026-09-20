import { describe, expect, it } from "vitest";
import {
  bootstrapMean,
  bootstrapProfitFactor,
  containsNeutral,
  iterationsFor,
  mulberry32,
  seedFrom,
  wilsonInterval,
} from "./uncertainty";

/**
 * The module exists so a number cannot be read as more certain than it is, so
 * the tests are about the honesty of the bounds: never outside what the
 * statistic can be, never zero-width on a sample of one, and never a different
 * answer for the same data twice.
 */

describe("wilsonInterval", () => {
  it("brackets the point estimate, and matches the published figure", () => {
    // 7 of 10 → 39.7 % – 89.2 %, the textbook Wilson answer.
    const i = wilsonInterval(7, 3)!;
    expect(i.lo).toBeCloseTo(39.7, 1);
    expect(i.hi).toBeCloseTo(89.2, 1);
    expect(i.n).toBe(10);
    expect(i.lo).toBeLessThan(70);
    expect(i.hi).toBeGreaterThan(70);
  });

  it("narrows as the sample grows, on the same rate", () => {
    const small = wilsonInterval(7, 3)!;
    const large = wilsonInterval(70, 30)!;
    expect(large.hi - large.lo).toBeLessThan(small.hi - small.lo);
  });

  it("never leaves 0–100, which is the reason it is Wilson and not the normal approximation", () => {
    const perfect = wilsonInterval(5, 0)!;
    expect(perfect.hi).toBeLessThanOrEqual(100);
    expect(perfect.lo).toBeGreaterThan(0);
    const hopeless = wilsonInterval(0, 5)!;
    expect(hopeless.lo).toBeGreaterThanOrEqual(0);
    expect(hopeless.hi).toBeLessThan(100);
  });

  it("is symmetric between wins and losses", () => {
    const a = wilsonInterval(3, 7)!;
    const b = wilsonInterval(7, 3)!;
    expect(a.lo).toBeCloseTo(100 - b.hi, 10);
    expect(a.hi).toBeCloseTo(100 - b.lo, 10);
  });

  it("is null with nothing decided — a rate over nothing is not a rate", () => {
    expect(wilsonInterval(0, 0)).toBeNull();
    expect(wilsonInterval(Number.NaN, 0)).toBeNull();
  });

  it("a wider z gives a wider interval", () => {
    const at95 = wilsonInterval(7, 3)!;
    const at99 = wilsonInterval(7, 3, 2.576)!;
    expect(at99.lo).toBeLessThan(at95.lo);
    expect(at99.hi).toBeGreaterThan(at95.hi);
  });
});

describe("the generator and its seed", () => {
  it("the same seed replays the same stream", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it("stays inside [0, 1)", () => {
    const r = mulberry32(7);
    for (let i = 0; i < 500; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("seeds from the values, so the same trades always get the same bounds", () => {
    expect(seedFrom([1, 2, 3])).toBe(seedFrom([1, 2, 3]));
    expect(seedFrom([1, 2, 3])).not.toBe(seedFrom([3, 2, 1]));
    // Different numbers that would collide if they were rounded to a string.
    expect(seedFrom([0.1 + 0.2])).not.toBe(seedFrom([0.3]));
  });
});

describe("bootstrapMean", () => {
  const spread = [-1, -1, -1, 2, 2, 3, -0.5, 1.5, 0.25, -0.75];

  it("brackets the sample mean", () => {
    const mean = spread.reduce((a, b) => a + b, 0) / spread.length;
    const i = bootstrapMean(spread, { iters: 400 })!;
    expect(i.lo).toBeLessThanOrEqual(mean);
    expect(i.hi).toBeGreaterThanOrEqual(mean);
    expect(i.n).toBe(spread.length);
  });

  it("gives the same bounds twice for the same data", () => {
    const a = bootstrapMean(spread, { iters: 400 })!;
    const b = bootstrapMean(spread, { iters: 400 })!;
    expect(a).toEqual(b);
  });

  it("narrows as the sample grows", () => {
    const many = Array.from({ length: 200 }, (_, i) => spread[i % spread.length]);
    const small = bootstrapMean(spread, { iters: 400 })!;
    const large = bootstrapMean(many, { iters: 400 })!;
    expect(large.hi - large.lo).toBeLessThan(small.hi - small.lo);
  });

  it("collapses to a point when every value is identical — there is nothing to be unsure about", () => {
    const i = bootstrapMean([2, 2, 2, 2], { iters: 100 })!;
    expect(i.lo).toBeCloseTo(2, 10);
    expect(i.hi).toBeCloseTo(2, 10);
  });

  it("refuses a sample of one, where resampling would claim certainty", () => {
    expect(bootstrapMean([1.5], { iters: 100 })).toBeNull();
    expect(bootstrapMean([], { iters: 100 })).toBeNull();
  });

  it("a wider coverage gives a wider interval", () => {
    const at95 = bootstrapMean(spread, { iters: 800 })!;
    const at99 = bootstrapMean(spread, { iters: 800, coverage: 0.99 })!;
    expect(at99.hi - at99.lo).toBeGreaterThanOrEqual(at95.hi - at95.lo);
  });
});

describe("bootstrapProfitFactor", () => {
  const pnls = [300, 300, -200, 150, -50, -120, 80, 220, -90, 40];

  it("brackets the profit factor of the sample itself", () => {
    const pos = pnls.filter((p) => p > 0).reduce((a, b) => a + b, 0);
    const neg = -pnls.filter((p) => p < 0).reduce((a, b) => a + b, 0);
    const pf = pos / neg;
    const i = bootstrapProfitFactor(pnls, { iters: 600 })!;
    expect(i.lo).toBeLessThanOrEqual(pf);
    expect(i.hi).toBeGreaterThanOrEqual(pf);
  });

  it("recomputes the ratio per resample — it is not the mean of ratios", () => {
    // A book whose loss is one big trade: the interval must run far wider than
    // the point estimate suggests, because half the resamples miss that trade.
    const lopsided = [100, 100, 100, 100, -350];
    const i = bootstrapProfitFactor(lopsided, { iters: 600 })!;
    expect(i.lo).toBeLessThan(400 / 350);
    expect(i.hi).toBeGreaterThan(400 / 350);
  });

  it("keeps an infinite upper bound when a resample can draw no loser", () => {
    const i = bootstrapProfitFactor([100, 200, -10], { iters: 600 })!;
    expect(i.hi).toBe(Infinity);
  });

  it("is null when nothing can be divided, and on a sample of one", () => {
    expect(bootstrapProfitFactor([0, 0, 0], { iters: 50 })).toBeNull();
    expect(bootstrapProfitFactor([100], { iters: 50 })).toBeNull();
  });

  it("gives the same bounds twice for the same data", () => {
    expect(bootstrapProfitFactor(pnls, { iters: 300 })).toEqual(
      bootstrapProfitFactor(pnls, { iters: 300 }),
    );
  });
});

describe("containsNeutral — what makes a row read as 'not yet known'", () => {
  it("is true when the interval still admits no effect", () => {
    expect(containsNeutral({ lo: -0.2, hi: 0.5, n: 10 }, 0)).toBe(true);
    expect(containsNeutral({ lo: 39, hi: 89, n: 10 }, 50)).toBe(true);
    expect(containsNeutral({ lo: 0.6, hi: 3.1, n: 10 }, 1)).toBe(true);
  });

  it("is false once the whole interval sits on one side", () => {
    expect(containsNeutral({ lo: 0.1, hi: 0.5, n: 40 }, 0)).toBe(false);
    expect(containsNeutral({ lo: 55, hi: 70, n: 80 }, 50)).toBe(false);
    expect(containsNeutral({ lo: 1.4, hi: 3.1, n: 60 }, 1)).toBe(false);
  });

  it("counts the boundary as containment, and answers false for no interval", () => {
    expect(containsNeutral({ lo: 0, hi: 0.8, n: 12 }, 0)).toBe(true);
    expect(containsNeutral(null, 0)).toBe(false);
  });
});

describe("iterationsFor", () => {
  it("spends 2,000 resamples on a small book and 500 on a large one", () => {
    expect(iterationsFor(50)).toBe(2000);
    expect(iterationsFor(500)).toBe(2000);
    expect(iterationsFor(5000)).toBe(500);
  });
});
