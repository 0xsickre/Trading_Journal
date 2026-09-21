/**
 * Three numbers that do not share a denominator, in place of one that did.
 *
 * WHAT THE SICKRE SCORE WAS, AND WHY IT IS GONE. Seven weighted components —
 * process adherence, max drawdown, profit factor, consistency, prop-firm
 * headroom, average win/loss, recovery factor — blended into a single 0–100
 * figure. It was rebalanced twice, gated twice, and it still had the defect
 * that no amount of reweighting can remove: **one number that moves both when
 * you trade differently and when the data behind it changes is not a
 * measurement of anything.** A quiet fortnight lowered it. Answering more
 * playbook rules raised it. A reader could not tell which had happened, and
 * the card's answer — a coverage percentage and a list of components — was an
 * admission that the composite had to be taken apart to be read.
 *
 * So it is taken apart here, along three axes that genuinely do not mix:
 *
 *   - **Process (0–100)** — did you do what you said you would. Tracker
 *     compliance and the playbook follow rate, blended by `processAdherence`.
 *     The only one that is fully under the trader's control, and the only one
 *     that means anything on a book with no closed trades at all.
 *   - **Survival (0–100)** — how close the account came to not continuing. How
 *     deep the worst fall was, how long it has been under water, and how much
 *     room is left against a prop-firm limit.
 *   - **Edge — a MEASUREMENT, not a score.** Expectancy in R, with its
 *     confidence interval and its sample. Deliberately not squeezed onto a
 *     0–100 band: turning an interval into a grade throws away exactly the
 *     information Phase B added, and "0.32R, and the interval still includes
 *     zero" is the honest sentence. A book of forty to seventy trades a year
 *     will say that for a long time.
 *
 * WHAT LEFT ENTIRELY. Consistency, average win/loss and recovery factor were
 * components of the composite and are now nothing but report metrics. Each is
 * a ratio whose band table came from a spec written for an intraday book, and
 * none of them answers a question the three above do not answer better.
 *
 * THE EVIDENCE GATES SURVIVE, because the bug they prevent has not gone
 * anywhere: on an empty book a drawdown of zero scores a perfect hundred, and
 * "no evidence" must never render as "flawless". Each axis is gated on its own
 * denominator, and a gated part is `null` — never 0, never 100.
 */

import { bootstrapMean, containsNeutral, type Interval } from "./uncertainty";
import { processAdherence } from "./tracker/process-adherence";

/**
 * Sample thresholds, unchanged from the composite they outlived.
 *
 *   - Below `MIN_SAMPLE` a trade-derived figure is noise, so there is none.
 *     One winning trade used to produce a hundred out of a hundred: infinite
 *     profit factor, no drawdown to have had, zero variance over a single
 *     observation — four maxima, every one an artifact of n = 1.
 *   - Below `RELIABLE_SAMPLE` the figure is real but unstable, so it is shown
 *     WITH its sample rather than withheld. Hiding a number until it settles
 *     leaves a new account staring at a blank card for weeks, which is its own
 *     kind of dishonest.
 *
 * The same 5 the report engine, the risk ratios and every insight rule use.
 */
export const MIN_SAMPLE = 5;
export const RELIABLE_SAMPLE = 30;

/**
 * Days under water at which the survival score's time component reaches zero.
 *
 * A quarter. On a book that holds trades for two to five days, three months
 * below the last equity peak is not a rough patch — it is the account failing
 * to make progress across an entire season, which is the thing this axis is
 * for. Linear from 0 days (100) to here (0), and it does not go negative: a
 * book four months under water is not twice as dead as one three months under.
 */
export const UNDER_WATER_FLOOR_DAYS = 90;

export type ScorecardInputs = {
  /** Mean daily tracker compliance over the window, 0–100. */
  trackerPct: number | null;
  /** Share of answered playbook rules that were followed, 0–100. */
  followRatePct: number | null;
  /**
   * Worst peak-to-trough fall as a percentage of PEAK EQUITY.
   *
   * The equity base, not the peak-P&L base the composite used. That one was
   * chosen to stay comparable with TradeZella's published figure; the composite
   * it fed no longer exists, and the README has always said the equity version
   * is "the number shown to a human", because a deposit genuinely changes what
   * a given dollar of loss means.
   */
  maxDrawdownPctOfEquity: number | null;
  /** Days since the last equity peak; 0 at a new high. */
  underWaterDays: number | null;
  /**
   * Room left against the nearest prop-firm limit, 0–100.
   *
   * Ungated by the trade count, unlike its two neighbours: the evidence rides
   * with the producer. `evaluateFtmo` answers null for a challenge with nothing
   * closed in its window, so there is no measured zero here to tell apart from
   * an absence. It is also on its own clock — a limit nearly touched does not
   * stop having been nearly touched because the reader changed the period.
   */
  ftmoHeadroomPct?: number | null;
  /**
   * R of the trades expectancy is actually averaged over: decided, and
   * carrying an R. The same population `metrics.ts` resamples.
   */
  decidedRs: readonly number[];
  /** Closed trades in scope — what the two survival parts are gated on. */
  trades: number;
};

export type ProcessScore = {
  score: number | null;
  trackerPct: number | null;
  followRatePct: number | null;
};

export type SurvivalScore = {
  score: number | null;
  drawdownPct: number | null;
  underWaterDays: number | null;
  ftmoHeadroomPct: number | null;
  /** How many of the three parts had data. Shown, not hidden. */
  counted: number;
};

export type EdgeMeasure = {
  /** Mean R over the decided trades that carry one. */
  expectancyR: number | null;
  interval: Interval | null;
  /** The sample the two figures above stand on. */
  n: number;
  /** True while the interval still admits no edge at all. */
  inconclusive: boolean;
};

export type Scorecard = {
  process: ProcessScore;
  survival: SurvivalScore;
  edge: EdgeMeasure;
  trades: number;
  /** Real, but thin enough to move a lot — show the sample beside it. */
  provisional: boolean;
};

const clamp = (v: number): number => Math.max(0, Math.min(100, v));

export function computeScorecard(inputs: ScorecardInputs): Scorecard {
  const enoughTrades = inputs.trades >= MIN_SAMPLE;

  const drawdownPct = enoughTrades ? inputs.maxDrawdownPctOfEquity : null;
  const underWaterDays = enoughTrades ? inputs.underWaterDays : null;
  const headroom = inputs.ftmoHeadroomPct ?? null;

  // Each part on the same 0–100 scale, then the mean of the ones that exist.
  // A mean rather than weights: three quantities this different have no honest
  // exchange rate between them, and inventing one would be the composite's own
  // mistake at a smaller scale.
  const parts: number[] = [];
  if (drawdownPct != null) parts.push(clamp(100 - drawdownPct));
  if (underWaterDays != null) {
    parts.push(clamp(100 - (underWaterDays / UNDER_WATER_FLOOR_DAYS) * 100));
  }
  if (headroom != null) parts.push(clamp(headroom));

  const rs = inputs.decidedRs;
  // The same floor as everything else, applied to the population the statistic
  // is actually built from: a book of five closed trades where only two were
  // decided has no expectancy worth printing.
  const edgeSampled = rs.length >= MIN_SAMPLE;
  const expectancyR = edgeSampled ? rs.reduce((a, b) => a + b, 0) / rs.length : null;
  const interval = edgeSampled ? bootstrapMean(rs) : null;

  return {
    process: {
      score: processAdherence({
        trackerPct: inputs.trackerPct,
        followRatePct: inputs.followRatePct,
      }),
      trackerPct: inputs.trackerPct,
      followRatePct: inputs.followRatePct,
    },
    survival: {
      score: parts.length === 0 ? null : parts.reduce((a, b) => a + b, 0) / parts.length,
      drawdownPct,
      underWaterDays,
      ftmoHeadroomPct: headroom,
      counted: parts.length,
    },
    edge: {
      expectancyR,
      interval,
      n: rs.length,
      // Without an interval there is nothing to have ruled out, which reads
      // the same way to the reader: you do not know yet.
      inconclusive: interval == null || containsNeutral(interval, 0),
    },
    trades: inputs.trades,
    provisional: inputs.trades > 0 && inputs.trades < RELIABLE_SAMPLE,
  };
}
