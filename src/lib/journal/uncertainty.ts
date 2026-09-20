/**
 * How sure a number is — the half of every statistic this journal never showed.
 *
 * THE PROBLEM. A profit factor of 2.4 over twelve trades and one over three
 * hundred render identically, and on a book of forty to seventy trades a year
 * the reports table hands out findings that are noise: "XAUUSD on Mondays is my
 * best setup", n = 6. `sickre-score.ts` already admits it in a comment — a win
 * rate over five decided trades carries a confidence interval about forty points
 * wide — and then prints the point estimate anyway.
 *
 * WHAT IS HERE. Two intervals, chosen for what they are honest about:
 *
 *   - **Wilson** for a rate. Closed form, no resampling, and unlike the textbook
 *     normal approximation it does not produce a bound below 0 or above 100 on a
 *     small sample — which is the only sample this book will ever have.
 *   - **Percentile bootstrap** for a mean (expectancy) and for a ratio of sums
 *     (profit factor). Both are statistics of a P&L distribution that is
 *     nothing like normal — it is skewed, it has fat tails, and a ratio of sums
 *     has no usable closed-form interval at all. Resampling asks the only
 *     question that can be answered honestly: if this same book had been dealt
 *     again from the same trades, how different would the answer look?
 *
 * DETERMINISM IS A FEATURE, NOT A CONVENIENCE. The generator is seeded from the
 * data itself, so the same row always yields the same bounds. A number that
 * changed every time the table was sorted would be worse than no number: the
 * reader would learn to distrust it, correctly.
 */

/** A two-sided interval, with the sample it was computed over. */
export type Interval = {
  lo: number;
  hi: number;
  /**
   * The sample THIS statistic had, which is not always the row's trade count:
   * a win rate is decided by winners and losers only, and expectancy only by
   * trades that carry an R.
   */
  n: number;
};

/** 95 %, two-sided. The one place to change it. */
export const Z_95 = 1.959964;

/**
 * Resamples per bootstrap, scaled to the sample.
 *
 * Two thousand is the usual figure and is cheap on the sample sizes this book
 * has. Above five hundred trades it is both unnecessary — the interval is
 * already narrow, and more resamples only refine a bound nobody is reading to
 * three decimals — and expensive, because the work is `iters × n` per metric
 * per row and the reports table computes it for every row at once.
 */
export function iterationsFor(n: number): number {
  return n > 500 ? 500 : 2000;
}

/**
 * A small, fast, seeded generator (mulberry32).
 *
 * Not `Math.random`: the bounds have to be reproducible across renders, across
 * a sort, and inside a test that asserts an exact number. Thirty-two bits of
 * state are ample for choosing indices out of a few hundred trades.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A stable seed for one group of numbers.
 *
 * Derived from the values themselves rather than from the bucket's name, so the
 * same trades give the same interval no matter which dimension put them in a
 * row together — and so a renamed tag does not silently change its own bounds.
 */
export function seedFrom(values: readonly number[]): number {
  let h = 2166136261;
  h = Math.imul(h ^ values.length, 16777619);
  for (const v of values) {
    // The bit pattern, not the decimal: 0.1 + 0.2 and 0.3 must not collide by
    // being rounded to the same string.
    const buf = new DataView(new ArrayBuffer(8));
    buf.setFloat64(0, v);
    h = Math.imul(h ^ buf.getUint32(0), 16777619);
    h = Math.imul(h ^ buf.getUint32(4), 16777619);
  }
  return h >>> 0;
}

/**
 * Wilson score interval for a proportion, in PERCENT.
 *
 * Null below one decided outcome — a rate over nothing is not a rate. Breakeven
 * trades are the caller's business: this journal leaves them out of the
 * denominator (see `winRateOf` in `analytics.ts`), so the caller passes wins and
 * losses and nothing else.
 */
export function wilsonInterval(
  wins: number,
  losses: number,
  z: number = Z_95,
): Interval | null {
  const n = wins + losses;
  if (!Number.isFinite(n) || n <= 0) return null;

  const p = wins / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = p + z2 / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));

  return {
    lo: Math.max(0, ((centre - spread) / denom) * 100),
    hi: Math.min(100, ((centre + spread) / denom) * 100),
    n,
  };
}

export type BootstrapOptions = {
  /** Overridden in tests, where 2,000 resamples buy nothing. */
  iters?: number;
  /** Two-sided coverage, 0.95 by default. */
  coverage?: number;
};

/**
 * The percentile interval of a statistic under resampling.
 *
 * Shared by both bootstraps below so the resampling itself — with replacement,
 * same size as the original, seeded from the data — is written once. A sample
 * of one gives no interval: one trade resampled is the same trade every time,
 * and a width of zero there would claim certainty from a single observation.
 */
function bootstrapInterval(
  values: readonly number[],
  statistic: (sample: readonly number[]) => number | null,
  opts: BootstrapOptions = {},
): Interval | null {
  const n = values.length;
  if (n < 2) return null;

  const iters = opts.iters ?? iterationsFor(n);
  const rand = mulberry32(seedFrom(values));
  const sample = new Array<number>(n);
  const stats: number[] = [];

  for (let i = 0; i < iters; i++) {
    for (let j = 0; j < n; j++) sample[j] = values[(rand() * n) | 0];
    const s = statistic(sample);
    if (s != null) stats.push(s);
  }
  if (stats.length === 0) return null;

  // Infinity sorts to the end and stays there: a resample with no losing trade
  // has a genuinely infinite profit factor, and the upper bound saying so is
  // the truth. Collapsing it to a finite number would invent a ceiling.
  stats.sort((a, b) => a - b);
  const coverage = opts.coverage ?? 0.95;
  const tail = (1 - coverage) / 2;
  return {
    lo: percentile(stats, tail),
    hi: percentile(stats, 1 - tail),
    n,
  };
}

/** Nearest-rank percentile of an ascending array. */
function percentile(sorted: readonly number[], q: number): number {
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[i];
}

/** Interval for the mean — expectancy, in R. */
export function bootstrapMean(
  values: readonly number[],
  opts: BootstrapOptions = {},
): Interval | null {
  return bootstrapInterval(
    values,
    (s) => {
      let sum = 0;
      for (const v of s) sum += v;
      return sum / s.length;
    },
    opts,
  );
}

/**
 * Interval for gross profit over gross loss.
 *
 * The statistic is recomputed on every resample rather than resampling the
 * ratio, because a ratio of sums is not the mean of ratios. `Infinity` when a
 * resample drew no loser, and null when it drew no winner and no loser at all —
 * matching `computeStats`, which answers the same three ways for the same
 * reasons.
 */
export function bootstrapProfitFactor(
  pnls: readonly number[],
  opts: BootstrapOptions = {},
): Interval | null {
  return bootstrapInterval(
    pnls,
    (s) => {
      let pos = 0;
      let neg = 0;
      for (const v of s) {
        if (v > 0) pos += v;
        else if (v < 0) neg -= v;
      }
      if (neg > 0) return pos / neg;
      return pos > 0 ? Infinity : null;
    },
    opts,
  );
}

/**
 * Whether the interval still admits "no effect".
 *
 * The neutral value is per metric and is NOT always zero: expectancy is neutral
 * at 0, a win rate at 50, and a profit factor at 1 — a profit factor can never
 * be negative, so a literal zero-crossing test would mark nothing, ever. The
 * boundary counts as containment: an interval that just touches neutral has not
 * ruled it out.
 */
export function containsNeutral(interval: Interval | null, neutral: number): boolean {
  if (!interval) return false;
  return interval.lo <= neutral && interval.hi >= neutral;
}
