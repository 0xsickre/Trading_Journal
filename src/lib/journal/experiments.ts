/**
 * The weekly change, measured.
 *
 * THE OPEN CIRCLE THIS CLOSES. The weekly review asks for "one thing I am
 * changing", and the next week asks whether it was kept. Both answers are the
 * trader's own word about the trader's own behaviour, and nothing ever asked
 * the book whether the change did anything. A loop that records an intention
 * and never checks the outcome is not a loop.
 *
 * AN EXPERIMENT IS A WEEK, A SENTENCE AND ONE METRIC. It starts on a Monday,
 * it names what is being changed, and it names the single number that would
 * move if the change worked. Everything else about it is derived from the
 * trades themselves — nothing is stored that the book already knows.
 *
 * ONLY THREE METRICS ARE OFFERED, and that is the whole design. Win rate,
 * profit factor and expectancy are the three that carry a confidence interval
 * (`uncertainty.ts`), and an experiment without one is an anecdote with a start
 * date. Net P&L over four weeks against six would always be "different", and
 * would always be noise.
 *
 * THE VERDICT IS WITHHELD while the interval of the difference still contains
 * zero — which, on forty to seventy trades a year, is the usual answer and is
 * meant to be. The card says "you do not know yet, n = …" instead of naming a
 * winner, because naming one here is precisely how a journal manufactures
 * confidence.
 *
 * WHAT IT DOES NOT CONTROL, stated because the card states it: instrument,
 * volatility, the rest of the market, and the fact of being watched. Two
 * windows of one trader's book are not an experiment in the scientific sense —
 * they are the best comparison this data can support, which is a different and
 * smaller claim.
 */

import type { EnrichedTrade } from "./enriched-trade";
import type { Interval } from "./uncertainty";
import { getMetric, type MetricContext, type ReportMetric } from "./reports/metrics";
import type { MetricUnit } from "./units";
import { addWeeksToWeekStart } from "./weekly-review";

/** Running, or finished with a decision. */
export type ExperimentStatus = "running" | "kept" | "dropped";

export type Experiment = {
  id: string;
  /** The Monday it started. */
  started_week: string;
  hypothesis: string;
  /** One of `EXPERIMENT_METRIC_KEYS`. */
  metric_key: string;
  baseline_weeks: number;
  /** The Monday of the last week it covers; null while it runs. */
  ended_week: string | null;
  status: ExperimentStatus;
};

/**
 * The metrics an experiment may be run on.
 *
 * Exactly the three that carry an interval. A list rather than a filter over
 * the catalogue, so adding an interval to a fourth metric is a deliberate
 * decision to make it measurable here too.
 */
export const EXPERIMENT_METRIC_KEYS = ["win_rate", "profit_factor", "expectancy"] as const;

/** Weeks of history the "before" window uses when nothing else is said. */
export const DEFAULT_BASELINE_WEEKS = 4;

/**
 * Fewest trades either window needs before a difference is stated at all.
 *
 * Two is the bootstrap's own floor (one trade resampled is the same trade every
 * time), and this sits above it for the same reason `MIN_SAMPLE_DAYS` does in
 * `survival.ts`: an interval computed from three trades is honest about being
 * useless, and a reader looking at a card rather than at a table will still
 * read the midpoint.
 */
export const MIN_WINDOW_TRADES = 5;

export type ExperimentWindows = {
  before: EnrichedTrade[];
  after: EnrichedTrade[];
  /** The Mondays the two windows span, inclusive — what the card says out loud. */
  beforeFrom: string;
  beforeTo: string;
  afterFrom: string;
  afterTo: string;
};

/**
 * The two windows, by the week a trade CLOSED in.
 *
 * Closed, not opened: a change to how trades are managed shows up in how they
 * end. A position opened the Friday before the experiment and closed inside it
 * was managed under the new rule, and belongs to the "after".
 *
 * "After" accumulates — every week from the start to today, not the latest
 * week alone. One week is four to seven trades, and a verdict from that is the
 * noise this module exists to refuse.
 */
export function experimentWindows(
  exp: Experiment,
  trades: readonly EnrichedTrade[],
  /** The Monday of the week that is running now. */
  currentWeek: string,
): ExperimentWindows {
  const beforeFrom = addWeeksToWeekStart(exp.started_week, -Math.max(1, exp.baseline_weeks));
  const beforeTo = addWeeksToWeekStart(exp.started_week, -1);
  const afterFrom = exp.started_week;
  // A finished experiment stops where it stopped; a running one runs to now.
  const afterTo = exp.ended_week ?? currentWeek;

  const inWindow = (t: EnrichedTrade, from: string, to: string) =>
    t.closeWeek >= from && t.closeWeek <= to;

  return {
    before: trades.filter((t) => inWindow(t, beforeFrom, beforeTo)),
    after: trades.filter((t) => inWindow(t, afterFrom, afterTo)),
    beforeFrom,
    beforeTo,
    afterFrom,
    afterTo,
  };
}

/**
 * What the experiment can and cannot say yet.
 *
 * `verdict` is the only field a reader should act on:
 *   - `thin`     — one of the windows has too few trades to compare at all.
 *   - `unknown`  — compared, and the difference still admits no change.
 *   - `better` / `worse` — the interval has cleared zero, in the metric's own
 *     direction (six catalogue metrics are better when lower; none of the
 *     three offered here is, but the flag is read rather than assumed).
 */
export type ExperimentVerdict = "thin" | "unknown" | "better" | "worse";

export type ExperimentMeasure = {
  before: number | null;
  after: number | null;
  /** After − before, in the metric's own unit. */
  delta: number | null;
  /** How sure that gap is; null when it could not be computed. */
  interval: Interval | null;
  beforeN: number;
  afterN: number;
  verdict: ExperimentVerdict;
  windows: ExperimentWindows;
};

export function measureExperiment(
  exp: Experiment,
  metric: ReportMetric,
  trades: readonly EnrichedTrade[],
  ctx: MetricContext,
  currentWeek: string,
): ExperimentMeasure {
  const windows = experimentWindows(exp, trades, currentWeek);
  const before = windows.before.length > 0 ? metric.compute(windows.before, ctx) : null;
  const after = windows.after.length > 0 ? metric.compute(windows.after, ctx) : null;

  const thin =
    windows.before.length < MIN_WINDOW_TRADES || windows.after.length < MIN_WINDOW_TRADES;

  // `Infinity − Infinity` is NaN, and a NaN rendered as a number is a lie with
  // a sign in front of it: two windows that never lost have no stateable gap.
  const raw = before == null || after == null ? null : after - before;
  const delta = raw == null || Number.isNaN(raw) ? null : raw;

  const interval =
    thin || !metric.difference ? null : metric.difference(windows.before, windows.after, ctx);

  return {
    before,
    after,
    delta,
    interval,
    beforeN: windows.before.length,
    afterN: windows.after.length,
    verdict: verdictOf(thin, interval, metric),
    windows,
  };
}

function verdictOf(
  thin: boolean,
  interval: Interval | null,
  metric: ReportMetric,
): ExperimentVerdict {
  if (thin) return "thin";
  // No interval, or one that still holds zero: the honest answer is the same
  // either way — this does not tell you.
  if (!interval) return "unknown";
  if (interval.lo <= 0 && interval.hi >= 0) return "unknown";
  const improved = interval.lo > 0;
  const higherIsBetter = metric.higherIsBetter !== false;
  return improved === higherIsBetter ? "better" : "worse";
}

/**
 * One experiment, in a shape that can cross to the browser.
 *
 * `ExperimentMeasure` carries the two windows of trades, which is exactly what
 * a server component must not serialize: the card needs four week keys and six
 * numbers, and shipping a few hundred enriched trades to render them would
 * make the weekly page pay for the whole book twice.
 */
export type ExperimentSummary = {
  experiment: Experiment;
  metricLabel: string;
  unit: MetricUnit;
  higherIsBetter: boolean;
  before: number | null;
  after: number | null;
  delta: number | null;
  interval: Interval | null;
  beforeN: number;
  afterN: number;
  verdict: ExperimentVerdict;
  /** The Mondays each window spans, inclusive — printed, not implied. */
  window: { beforeFrom: string; beforeTo: string; afterFrom: string; afterTo: string };
};

export function summarizeExperiments(
  experiments: readonly Experiment[],
  trades: readonly EnrichedTrade[],
  ctx: MetricContext,
  currentWeek: string,
): ExperimentSummary[] {
  const out: ExperimentSummary[] = [];
  for (const exp of experiments) {
    const metric = getMetric(exp.metric_key);
    // A metric the catalogue no longer has: the row stays in the database and
    // stays off the screen, rather than rendering an experiment measured on
    // nothing.
    if (!metric) continue;
    const m = measureExperiment(exp, metric, trades, ctx, currentWeek);
    out.push({
      experiment: exp,
      metricLabel: metric.label,
      unit: metric.unit,
      higherIsBetter: metric.higherIsBetter !== false,
      before: m.before,
      after: m.after,
      delta: m.delta,
      interval: m.interval,
      beforeN: m.beforeN,
      afterN: m.afterN,
      verdict: m.verdict,
      window: {
        beforeFrom: m.windows.beforeFrom,
        beforeTo: m.windows.beforeTo,
        afterFrom: m.windows.afterFrom,
        afterTo: m.windows.afterTo,
      },
    });
  }
  return out;
}
