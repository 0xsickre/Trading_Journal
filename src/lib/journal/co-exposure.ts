/**
 * Are my three positions actually one position?
 *
 * A swing book that holds overnight carries several instruments at once, and
 * "1 % each" is only 3 % of risk if the three move independently. In a risk-off
 * session they do not: gold, the index and copper answer the same headline, and
 * one gap opens all three at the same time.
 *
 * TWO ANSWERS, BECAUSE ONE OF THEM IS NOT ENOUGH.
 *
 *   - **Overlap** is the honest one for this book: how many days two
 *     instruments were open AT THE SAME TIME. It asks about exposure, it needs
 *     nothing but the positions, and it cannot be wrong.
 *   - **Correlation** of realized daily P&L is the familiar one, and it answers
 *     a narrower question than it appears to: it compares days on which both
 *     instruments CLOSED something. A three-week gold swing and a three-week
 *     index swing that ran side by side and closed on different days correlate
 *     at zero here while having been the same bet throughout.
 *
 * So the pair carries both, and the correlation carries its own interval. On a
 * book of forty to seventy trades a year the shared days are few, and a
 * coefficient of 0.82 over six of them is the kind of number this whole phase
 * exists to stop printing without a warning.
 */

import { zonedDateKey } from "./time";
import type { TradeRow } from "./types";

/** Below this many shared days a coefficient is not reported at all. */
export const MIN_SHARED_DAYS = 5;

export type InstrumentPair = {
  a: string;
  b: string;
  /** Days both instruments held an open position. */
  overlapDays: number;
  /** Days each was open, for the share the overlap represents. */
  aDays: number;
  bDays: number;
  /** Pearson r of realized daily P&L over shared CLOSE days; null below the gate. */
  correlation: number | null;
  /** 95 % Fisher-z interval around it, null when the coefficient is. */
  correlationLo: number | null;
  correlationHi: number | null;
  /** Days that fed the coefficient — not the same as `overlapDays`. */
  sharedCloseDays: number;
};

type Span = { instrument: string; openDay: string; closeDay: string | null };

/**
 * The days each position was open, as day keys in the account's zone.
 *
 * A still-open position runs to `today`, which is what makes the overlap a
 * statement about now as well as about history.
 */
export function spansOf(
  rows: readonly TradeRow[],
  tzOf: (row: TradeRow) => string,
  today: string,
): Span[] {
  const out: Span[] = [];
  for (const row of rows) {
    const instrument = (row.instrument as string) ?? "";
    const openedAt = row.stats?.opened_at ?? null;
    if (!instrument || !openedAt) continue;
    const tz = tzOf(row);
    const openDay = zonedDateKey(openedAt, tz);
    if (!openDay) continue;
    const closedAt = row.stats?.closed_at ?? null;
    out.push({
      instrument,
      openDay,
      closeDay: closedAt ? zonedDateKey(closedAt, tz) : today,
    });
  }
  return out;
}

/** Day keys an instrument was exposed on, deduped across its positions. */
function daysByInstrument(spans: readonly Span[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const s of spans) {
    const set = out.get(s.instrument) ?? new Set<string>();
    // Walked as keys rather than as instants: a position open over a weekend
    // is exposed on the weekend, whatever the market did.
    for (let d = s.openDay; d <= (s.closeDay ?? s.openDay); d = nextDay(d)) {
      set.add(d);
      if (d === s.closeDay) break;
    }
    out.set(s.instrument, set);
  }
  return out;
}

function nextDay(day: string): string {
  const t = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(t)) return day;
  return new Date(t + 86_400_000).toISOString().slice(0, 10);
}

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
  const exposure = daysByInstrument(spans);
  const names = [...exposure.keys()].sort();
  const out: InstrumentPair[] = [];

  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = names[i];
      const b = names[j];
      const aDays = exposure.get(a)!;
      const bDays = exposure.get(b)!;
      let overlap = 0;
      for (const d of aDays) if (bDays.has(d)) overlap++;

      const pnlA = dailyPnlByInstrument.get(a);
      const pnlB = dailyPnlByInstrument.get(b);
      const corr = pnlA && pnlB ? pearson(pnlA, pnlB) : null;
      // Below the gate the coefficient is withheld entirely rather than shown
      // with a caveat: six shared days cannot carry a number this suggestive.
      const reportable = corr != null && corr.n >= MIN_SHARED_DAYS ? corr : null;
      const ci = reportable ? fisherInterval(reportable.r, reportable.n) : null;

      out.push({
        a,
        b,
        overlapDays: overlap,
        aDays: aDays.size,
        bDays: bDays.size,
        correlation: reportable?.r ?? null,
        correlationLo: ci?.lo ?? null,
        correlationHi: ci?.hi ?? null,
        sharedCloseDays: corr?.n ?? 0,
      });
    }
  }
  // The pairs that were open together most often come first: that is the
  // question — which of these am I holding at the same time.
  return out.sort((x, y) => y.overlapDays - x.overlapDays || x.a.localeCompare(y.a));
}

/** Realized P&L per day, per instrument — the correlation's input. */
export function dailyPnlByInstrument(
  rows: readonly TradeRow[],
  tzOf: (row: TradeRow) => string,
  pnlOf: (row: TradeRow) => number | null,
): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const instrument = (row.instrument as string) ?? "";
    const closedAt = row.stats?.closed_at ?? null;
    const pnl = pnlOf(row);
    if (!instrument || !closedAt || pnl == null) continue;
    const day = zonedDateKey(closedAt, tzOf(row));
    if (!day) continue;
    const byDay = out.get(instrument) ?? new Map<string, number>();
    byDay.set(day, (byDay.get(day) ?? 0) + pnl);
    out.set(instrument, byDay);
  }
  return out;
}
