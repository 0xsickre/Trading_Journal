/**
 * Will this book survive itself? — the one number that is not historical.
 *
 * Everything else in this journal measures what happened. This asks what the
 * same behaviour is likely to do next: at this distribution of daily results
 * and this size, how often does the account hit a floor before it reaches
 * anything.
 *
 * IT WORKS WITHOUT A PROP ACCOUNT. The simulation is identical either way; only
 * the thresholds differ. With FTMO on they come from the challenge's own rules;
 * with it off they are the trader's — the drawdown they would not accept —
 * because "how likely am I to be down 10 % in two months" is the same question
 * a challenge asks, minus the fee.
 *
 * WHY DAYS AND NOT TRADES. The binding rule on a prop account is a DAILY loss
 * limit, and a day is also how losses actually arrive: a bad session is several
 * trades, not one. Resampling trades and dealing them into days would destroy
 * exactly the structure the daily rule measures.
 *
 * WHY BLOCKS. Drawing single days assumes today tells you nothing about
 * tomorrow, and this book is a swing book — positions span days, tilt spans
 * sessions, and the run of losses that ends a challenge is not an unlucky draw
 * but a correlated stretch. Resampling CONSECUTIVE blocks of days keeps those
 * stretches intact. Block size is the trader's choice and is stated on screen,
 * because it changes the answer and hiding it would make an assumption look
 * like a measurement.
 *
 * WHAT IT DOES NOT CLAIM. The future is not drawn from the past; this is the
 * same book replayed, which is the strongest honest statement available. It
 * says nothing about a market that has not happened yet, and nothing about a
 * change in the trader's own behaviour.
 */

import { mulberry32, seedFrom } from "./uncertainty";

/** A day's result as a share of the equity it opened with, in percent. */
export type DayReturn = number;

export type SurvivalThresholds = {
  /** Equity floor, as a percent below the starting equity. Null = not tested. */
  maxLossPct: number | null;
  /** The most one day may lose, in percent of that day's opening equity. */
  dailyLossPct: number | null;
  /** Profit that ends the run, in percent above the starting equity. */
  profitTargetPct: number | null;
};

export type SurvivalInput = {
  /** The account's own history: one entry per day that traded. */
  dayReturns: readonly DayReturn[];
  horizonDays: number;
  /** 1 = days drawn independently; 5 = whole weeks, keeping streaks together. */
  blockDays: number;
  thresholds: SurvivalThresholds;
  iters?: number;
};

export type SurvivalResult = {
  /** Share of runs that hit the equity floor, 0–100. Null when not tested. */
  pMaxLoss: number | null;
  pDailyLoss: number | null;
  pTarget: number | null;
  /** Share of runs that end below where they started. */
  pNegative: number;
  /** Where equity lands, in percent of the start. */
  percentiles: { p5: number; p25: number; p50: number; p75: number; p95: number };
  /** The median run's worst drawdown, in percent — what a normal bad patch looks like. */
  medianWorstDrawdownPct: number;
  /** Days of history the draws came from. The reader's warning about the answer. */
  sampleDays: number;
  iters: number;
};

/** Below this a resample is noise about noise, and the card says so instead. */
export const MIN_SAMPLE_DAYS = 20;

/**
 * Replay the book `iters` times over `horizonDays` and count the outcomes.
 *
 * Null when the history is too short to resample: fewer than twenty traded days
 * cannot describe a distribution, and a probability computed from eight days
 * would be a confident-looking number with nothing behind it.
 */
export function simulateSurvival(input: SurvivalInput): SurvivalResult | null {
  const days = input.dayReturns.filter((d) => Number.isFinite(d));
  if (days.length < MIN_SAMPLE_DAYS) return null;
  if (!(input.horizonDays > 0)) return null;

  const iters = input.iters ?? 2000;
  const block = Math.max(1, Math.min(Math.floor(input.blockDays) || 1, days.length));
  const rand = mulberry32(seedFrom(days));

  const { maxLossPct, dailyLossPct, profitTargetPct } = input.thresholds;
  // Equity is carried as a multiple of the start, so every threshold is a
  // percentage of the same thing and no currency enters the simulation.
  const floor = maxLossPct != null ? 1 - Math.abs(maxLossPct) / 100 : null;
  const target = profitTargetPct != null ? 1 + Math.abs(profitTargetPct) / 100 : null;
  const dailyLimit = dailyLossPct != null ? -Math.abs(dailyLossPct) : null;

  let hitFloor = 0;
  let hitDaily = 0;
  let hitTarget = 0;
  let down = 0;
  const finals: number[] = [];
  const worstDrawdowns: number[] = [];

  for (let run = 0; run < iters; run++) {
    let equity = 1;
    let peak = 1;
    let worst = 0;
    let floorBreached = false;
    let dailyBreached = false;
    let targetReached = false;

    for (let d = 0; d < input.horizonDays; ) {
      // One block start, then that many consecutive days — wrapping, so a block
      // that runs off the end continues at the beginning rather than being
      // discarded (which would over-sample the middle of the history).
      const start = (rand() * days.length) | 0;
      for (let b = 0; b < block && d < input.horizonDays; b++, d++) {
        const r = days[(start + b) % days.length];
        if (dailyLimit != null && r <= dailyLimit) dailyBreached = true;
        equity *= 1 + r / 100;
        if (equity > peak) peak = equity;
        const dd = ((peak - equity) / peak) * 100;
        if (dd > worst) worst = dd;
        if (floor != null && equity <= floor) floorBreached = true;
        if (target != null && equity >= target) targetReached = true;
      }
    }

    if (floorBreached) hitFloor++;
    if (dailyBreached) hitDaily++;
    if (targetReached) hitTarget++;
    if (equity < 1) down++;
    finals.push(equity);
    worstDrawdowns.push(worst);
  }

  finals.sort((a, b) => a - b);
  worstDrawdowns.sort((a, b) => a - b);
  const pct = (q: number) => (quantile(finals, q) - 1) * 100;

  return {
    pMaxLoss: floor != null ? (hitFloor / iters) * 100 : null,
    pDailyLoss: dailyLimit != null ? (hitDaily / iters) * 100 : null,
    pTarget: target != null ? (hitTarget / iters) * 100 : null,
    pNegative: (down / iters) * 100,
    percentiles: {
      p5: pct(0.05),
      p25: pct(0.25),
      p50: pct(0.5),
      p75: pct(0.75),
      p95: pct(0.95),
    },
    medianWorstDrawdownPct: quantile(worstDrawdowns, 0.5),
    sampleDays: days.length,
    iters,
  };
}

/** Nearest-rank quantile of an ascending array. */
function quantile(sorted: readonly number[], q: number): number {
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[i];
}

/**
 * Daily results as percentages of each day's OPENING equity.
 *
 * Percent rather than money, so the simulation compounds the way an account
 * does and every threshold is a percentage of the same thing. Taking the
 * opening equity per day — not the starting balance — keeps a 2 % day worth 2 %
 * whether it happened at 10,000 or at 14,000.
 */
export function dayReturnsFrom(
  dailyPnl: ReadonlyMap<string, number>,
  equityOf: (day: string) => number | null,
): DayReturn[] {
  const out: DayReturn[] = [];
  for (const [day, pnl] of [...dailyPnl.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const equity = equityOf(day);
    // A day whose opening equity is unknown is dropped, not treated as flat:
    // an unknown denominator cannot produce a percentage, and a 0 % day would
    // quietly make the book look calmer than it was.
    if (equity == null || !(equity > 0)) continue;
    out.push((pnl / equity) * 100);
  }
  return out;
}

/**
 * The thresholds a prop challenge imposes, or the one the trader set.
 *
 * The simulation does not know about FTMO; this is the only place the two
 * worlds meet. With the challenge off, the daily rule has no meaning (nobody
 * fails a personal account for one bad day) and the target is whatever the
 * trader wants to see, so both are left null.
 */
export function thresholdsFor(input: {
  ftmoEnabled: boolean;
  ftmoMaxLossPct?: number | null;
  ftmoDailyLossPct?: number | null;
  ftmoProfitTargetPct?: number | null;
  /** The drawdown the trader would not accept, when there is no challenge. */
  ownMaxLossPct?: number | null;
}): SurvivalThresholds {
  if (input.ftmoEnabled) {
    return {
      maxLossPct: input.ftmoMaxLossPct ?? null,
      dailyLossPct: input.ftmoDailyLossPct ?? null,
      profitTargetPct: input.ftmoProfitTargetPct ?? null,
    };
  }
  return {
    maxLossPct: input.ownMaxLossPct ?? null,
    dailyLossPct: null,
    profitTargetPct: null,
  };
}
