/**
 * Were two instruments one bet?
 *
 * A day trader who runs NQ and ES in the same morning is not diversified: the
 * two answer the same tape, and "1 R each" is closer to 2 R on one idea. The
 * question is how much of the time they were held TOGETHER (F5.5: in minutes,
 * not in days — every intraday position shares its day with every other).
 *
 * TWO ANSWERS, BECAUSE ONE OF THEM IS NOT ENOUGH.
 *
 *   - **Overlap** is the honest one: the minutes in which both instruments had
 *     a position open, from the fills' own times. It asks about exposure, it
 *     needs nothing but the positions, and it cannot be wrong.
 *   - **Correlation** of realized daily P&L is the familiar one, and it answers
 *     a narrower question than it appears to: it compares trading days on which
 *     both instruments CLOSED something, and says whether their days went the
 *     same way — not whether the positions ran side by side.
 *
 * So the pair carries both, and the correlation carries its own interval. Days
 * on which both instruments closed a trade stay few even on a busy book, and a
 * coefficient of 0.82 over six of them is the kind of number this journal
 * refuses to print without a warning.
 */

import { dayKeyIn, toEpoch, type DayZone } from "./time";
import type { TradeRow } from "./types";

/** Below this many shared close days a coefficient is not reported at all. */
export const MIN_SHARED_DAYS = 5;

export type InstrumentPair = {
  a: string;
  b: string;
  /** Minutes both instruments held an open position at the same time. */
  overlapMinutes: number;
  /** Minutes each was held, for the share the overlap represents. */
  aMinutes: number;
  bMinutes: number;
  /** Pearson r of realized daily P&L over shared CLOSE days; null below the gate. */
  correlation: number | null;
  /** 95 % Fisher-z interval around it, null when the coefficient is. */
  correlationLo: number | null;
  correlationHi: number | null;
  /** Trading days that fed the coefficient — a different thing from the overlap. */
  sharedCloseDays: number;
};

type Span = { instrument: string; from: number; to: number };

/**
 * When each position was open, as epoch milliseconds.
 *
 * A still-open position runs to `now`, which is what makes the overlap a
 * statement about the present as well as about history.
 */
export function spansOf(rows: readonly TradeRow[], now: number): Span[] {
  const out: Span[] = [];
  for (const row of rows) {
    const instrument = (row.instrument as string) ?? "";
    const from = toEpoch(row.stats?.opened_at ?? null);
    if (!instrument || !Number.isFinite(from)) continue;
    const closedAt = row.stats?.closed_at ?? null;
    const to = closedAt ? toEpoch(closedAt) : now;
    if (!Number.isFinite(to) || to < from) continue;
    out.push({ instrument, from, to });
  }
  return out;
}

type Interval = [number, number];

/**
 * An instrument's exposure as disjoint intervals: two positions on the same
 * instrument at once (a scale-in written as two trades, two accounts) are one
 * stretch of exposure, not twice the minutes.
 */
function exposureByInstrument(spans: readonly Span[]): Map<string, Interval[]> {
  const raw = new Map<string, Interval[]>();
  for (const s of spans) raw.set(s.instrument, [...(raw.get(s.instrument) ?? []), [s.from, s.to]]);
  const out = new Map<string, Interval[]>();
  for (const [name, list] of raw) {
    const merged: Interval[] = [];
    for (const [a, b] of list.sort((x, y) => x[0] - y[0])) {
      const last = merged.at(-1);
      if (last && a <= last[1]) last[1] = Math.max(last[1], b);
      else merged.push([a, b]);
    }
    out.set(name, merged);
  }
  return out;
}

const lengthOf = (list: readonly Interval[]) => list.reduce((s, [a, b]) => s + (b - a), 0);

/** Length of the time two sets of disjoint, sorted intervals share. */
function sharedLength(x: readonly Interval[], y: readonly Interval[]): number {
  let i = 0;
  let j = 0;
  let total = 0;
  while (i < x.length && j < y.length) {
    const lo = Math.max(x[i][0], y[j][0]);
    const hi = Math.min(x[i][1], y[j][1]);
    if (hi > lo) total += hi - lo;
    if (x[i][1] < y[j][1]) i++;
    else j++;
  }
  return total;
}

const MINUTE = 60_000;

/**
 * Pearson correlation over the days BOTH series have a value for.
 *
 * Pairwise-complete, never zero-filled: filling the absent days with 0 would
 * make two instruments traded on entirely different days look perfectly
 * uncorrelated with almost no variance — a confident answer manufactured out
 * of days nobody traded.
 */
export function pearson(
  a: ReadonlyMap<string, number>,
  b: ReadonlyMap<string, number>,
): { r: number; n: number } | null {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [day, x] of a) {
    const y = b.get(day);
    if (y == null) continue;
    xs.push(x);
    ys.push(y);
  }
  const n = xs.length;
  if (n < 2) return null;

  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a1 = xs[i] - mx;
    const b1 = ys[i] - my;
    num += a1 * b1;
    dx += a1 * a1;
    dy += b1 * b1;
  }
  // One of the series never moved: correlation is undefined, not zero.
  if (dx === 0 || dy === 0) return null;
  return { r: num / Math.sqrt(dx * dy), n };
}

/**
 * Fisher-z interval for a correlation coefficient.
 *
 * The distribution of r is skewed and bounded at ±1, so a symmetric interval
 * around it would run past what a correlation can be. The z transform is
 * roughly normal, so the interval is built there and mapped back — which is
 * also why the bounds come back asymmetric, as they should.
 */
export function fisherInterval(
  r: number,
  n: number,
  z = 1.959964,
): { lo: number; hi: number } | null {
  if (!(n > 3)) return null;
  const clamped = Math.max(-0.999999, Math.min(0.999999, r));
  const zr = Math.atanh(clamped);
  const se = 1 / Math.sqrt(n - 3);
  return { lo: Math.tanh(zr - z * se), hi: Math.tanh(zr + z * se) };
}

/**
 * Every pair of instruments the book held, with both answers.
 *
 * Pairs are ordered alphabetically and each appears once — a correlation
 * matrix printed in full is the same number twice and a diagonal of ones.
 */
export function instrumentPairs(
  spans: readonly Span[],
  dailyPnlByInstrument: ReadonlyMap<string, ReadonlyMap<string, number>>,
): InstrumentPair[] {
  const exposure = exposureByInstrument(spans);
  const names = [...exposure.keys()].sort();
  const out: InstrumentPair[] = [];

  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = names[i];
      const b = names[j];
      const aSpans = exposure.get(a)!;
      const bSpans = exposure.get(b)!;

      const pnlA = dailyPnlByInstrument.get(a);
      const pnlB = dailyPnlByInstrument.get(b);
      const corr = pnlA && pnlB ? pearson(pnlA, pnlB) : null;
      // Below the gate the coefficient is withheld entirely rather than shown
      // with a caveat: five shared days cannot carry a number this suggestive.
      const reportable = corr != null && corr.n >= MIN_SHARED_DAYS ? corr : null;
      const ci = reportable ? fisherInterval(reportable.r, reportable.n) : null;

      out.push({
        a,
        b,
        overlapMinutes: sharedLength(aSpans, bSpans) / MINUTE,
        aMinutes: lengthOf(aSpans) / MINUTE,
        bMinutes: lengthOf(bSpans) / MINUTE,
        correlation: reportable?.r ?? null,
        correlationLo: ci?.lo ?? null,
        correlationHi: ci?.hi ?? null,
        sharedCloseDays: corr?.n ?? 0,
      });
    }
  }
  // The pairs held together longest come first: that is the question — which
  // of these am I holding at the same time.
  return out.sort((x, y) => y.overlapMinutes - x.overlapMinutes || x.a.localeCompare(y.a));
}

/** Realized P&L per trading day (the account's day), per instrument — the correlation's input. */
export function dailyPnlByInstrument(
  rows: readonly TradeRow[],
  tzOf: (row: TradeRow) => DayZone,
  pnlOf: (row: TradeRow) => number | null,
): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const instrument = (row.instrument as string) ?? "";
    const closedAt = row.stats?.closed_at ?? null;
    const pnl = pnlOf(row);
    if (!instrument || !closedAt || pnl == null) continue;
    const day = dayKeyIn(closedAt, tzOf(row));
    if (!day) continue;
    const byDay = out.get(instrument) ?? new Map<string, number>();
    byDay.set(day, (byDay.get(day) ?? 0) + pnl);
    out.set(instrument, byDay);
  }
  return out;
}
