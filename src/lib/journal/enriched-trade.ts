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
import { daysBetweenKeys } from "./open-positions";
import { spansWeekend } from "./weekend-hold";
import { excursionFromTrade, type Excursion } from "./excursion";
import { riskIntentGap, riskMoneyAtEntry, riskPctTaken } from "./risk-taken";
import { zonedDateKey, zonedHour, zonedWeekStartKey } from "./time";

/**
 * The journal fields downstream consumers join against — process, not prose.
 *
 * `micromanage`, `day_grade` and `rule_broken` used to be here. The first moved
 * to `tj_position_checkins` (a fact about a position, not about a day); the
 * other two moved to the weekly review. What is left is what a DAY can actually
 * answer about a multi-day hold.
 */
export type DailyReportLite = {
  report_date: string;
  mental_temp: number | null;
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
  /**
   * Hour of the entry (0–23) on the account's clock, or null when the entry
   * time is unknown. Never falls back to the close the way `openDay` does: a
   * day survives that substitution, an hour would be a different fact.
   */
  openHour: number | null;
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
  /**
   * Days held, counted in SESSIONS and inclusive of the open day.
   *
   * Not `durationDays`, which is the hold in hours divided by 24. A position
   * opened at 15:50 Monday and closed at 09:10 Tuesday lasted 0.7 of a day and
   * spanned two of them — and a time stop written as "3 days" means three
   * sessions, not seventy-two hours.
   */
  heldDays: number;
  /** The exit deadline written on the trade at entry, if one was. */
  timeStopDays: number | null;
  /**
   * Held STRICTLY past that deadline.
   *
   * On the day the time stop is reached the plan is still being followed; the
   * breach belongs to the day it was broken. Same boundary as
   * `openPositionsOn`, and deliberately the same — a position flagged live on
   * `/daily` must not un-flag itself once it closes.
   */
  pastTimeStop: boolean;
  entryFills: number;
  exitFills: number;
  size: number | null;
  /**
   * What the stop was worth at the size entered, in account currency.
   *
   * Null whenever any factor is unknown — no stop, no fills, an unpriced
   * instrument, no rate. See `risk-taken.ts`, which is the only place that
   * chain is written.
   */
  riskMoney: number | null;
  /**
   * That risk as a percentage of the equity the entry day opened with.
   *
   * The answer to "how much of the account did this decision actually put at
   * stake", which the journal could not ask until `equity_at_entry` existed:
   * `risk_pct` on the row is the risk the trader CHOSE, and nothing compared
   * the two.
   */
  riskPctTaken: number | null;
  /** Unsigned distance between the risk taken and the risk chosen, in points of equity. */
  riskIntentGap: number | null;
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

    const openDay = zonedDateKey(t.row.stats?.opened_at ?? t.closedAt, tz);
    const closeDay = zonedDateKey(t.closedAt, tz);
    const heldDays = daysBetweenKeys(openDay, closeDay);
    const timeStopDays = numField(t.row, "time_stop_days");

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
      openDay,
      openHour: zonedHour(t.row.stats?.opened_at ?? null, tz),
      closeDay,
      closeWeek: zonedWeekStartKey(t.closedAt, tz),
      weekendHold: spansWeekend(t.row.stats?.opened_at ?? null, t.closedAt, tz),
      heldDays,
      timeStopDays,
      pastTimeStop: timeStopDays != null && heldDays > timeStopDays,
      entryFills: fills?.entries ?? 0,
      exitFills: fills?.exits ?? 0,
      size: numField(t.row, "position_size"),
      riskMoney: riskMoneyAtEntry(t.row),
      riskPctTaken: riskPctTaken(t.row),
      riskIntentGap: riskIntentGap(t.row),
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
