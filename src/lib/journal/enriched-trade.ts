/**
 * One enrichment pass over realized trades, shared by the insight engine and
 * the report engine.
 *
 * This lived inside `insights/context.ts` until the reports layer needed the
 * same derived values. Grouping trades by instrument should not require pulling
 * in the insight engine, so the generic half moved here and `insights/context`
 * now builds its buckets and baselines on top of it.
 */

import type { RealizedTrade } from "./analytics";
import { classifyOutcome, EXACT_ZERO_RANGE, type BreakevenRange } from "./breakeven";
import { numberFieldValue as numField } from "./field-values";
import { spansWeekend } from "./weekend-hold";
import { excursionFromTrade, type Excursion } from "./excursion";
import { zonedDateKey, zonedWeekStartKey } from "./time";
import type { Micromanage } from "./daily-report";

/** The journal fields downstream consumers join against — process, not prose. */
export type DailyReportLite = {
  report_date: string;
  micromanage: Micromanage | null;
  mental_temp: number | null;
  day_grade: string | null;
  rule_broken: boolean | null;
  no_trade_day: boolean;
};

/** Number of entry and exit fills per position id. */
export type FillCounts = Map<string, { entries: number; exits: number }>;

/** A realized trade with the derived values every consumer keeps asking for. */
export type EnrichedTrade = {
  trade: RealizedTrade;
  id: string;
  label: string;
  pnl: number;
  r: number | null;
  outcome: "win" | "loss" | "breakeven";
  excursion: Excursion;
  durationSeconds: number | null;
  durationDays: number | null;
  openedAt: string | null;
  closedAt: string | null;
  /** Day key of the OPEN, in account tz — the trading day. */
  openDay: string;
  /** Day key of the CLOSE — where the money lands. */
  closeDay: string;
  closeWeek: string;
  /**
   * Whether the holding window crossed a Saturday or Sunday.
   *
   * Derived here rather than stored on the row — see `weekend-hold.ts`. It rides
   * along on every enriched trade because the weekend is a DIFFERENT risk from
   * an overnight gap, not a longer one, and a trader who crosses one rarely is
   * running a small self-selected sample worth measuring against the rest.
   */
  weekendHold: boolean;
  entryFills: number;
  exitFills: number;
  size: number | null;
  instrument: string | null;
  accountId: string | null;
};

export type EnrichOptions = {
  tzOf: (t: RealizedTrade) => string;
  range?: BreakevenRange;
  pnlOf?: (t: RealizedTrade) => number;
  fillCounts?: FillCounts;
};

export function enrichTrades(
  trades: RealizedTrade[],
  options: EnrichOptions,
): EnrichedTrade[] {
  const {
    tzOf,
    range = EXACT_ZERO_RANGE,
    pnlOf = (t) => t.net,
    fillCounts,
  } = options;

  return trades.map((t) => {
    const tz = tzOf(t);
    const pnl = pnlOf(t);
    const secs = t.row.stats?.duration_seconds ?? null;
    const fills = fillCounts?.get(t.id);
    const tradeNo = t.row.trade_no;
    const instrument = (t.row.instrument as string) ?? null;

    return {
      trade: t,
      id: t.id,
      label: `${tradeNo != null ? `#${tradeNo}` : t.id.slice(0, 8)}${
        instrument ? ` ${instrument}` : ""
      }`,
      pnl,
      r: t.r,
      outcome: classifyOutcome(pnl, range),
      excursion: excursionFromTrade(t.row),
      durationSeconds: secs,
      durationDays: secs != null ? secs / 86_400 : null,
      openedAt: t.row.stats?.opened_at ?? null,
      closedAt: t.closedAt,
      openDay: zonedDateKey(t.row.stats?.opened_at ?? t.closedAt, tz),
      closeDay: zonedDateKey(t.closedAt, tz),
      closeWeek: zonedWeekStartKey(t.closedAt, tz),
      weekendHold: spansWeekend(t.row.stats?.opened_at ?? null, t.closedAt, tz),
      entryFills: fills?.entries ?? 0,
      exitFills: fills?.exits ?? 0,
      size: numField(t.row, "position_size"),
      instrument,
      accountId: t.row.account_id ?? null,
    };
  });
}

// --- Shared descriptive statistics -----------------------------------------

export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function median(values: number[]): number | null {
  return percentile(values, 0.5);
}

export function mean(values: number[]): number | null {
  return values.length > 0
    ? values.reduce((a, b) => a + b, 0) / values.length
    : null;
}
