/**
 * Pre-computed context every rule reads.
 *
 * Built once per evaluation so thirty rules do not each walk the same trades.
 * It also centralises the baselines — "your average winner", "your typical
 * size" — so every rule compares against the same history rather than each
 * inventing its own window.
 */

import type { RealizedTrade } from "../analytics";
import { classifyOutcome, type BreakevenRange, EXACT_ZERO_RANGE } from "../breakeven";
import { excursionFromTrade, type Excursion } from "../excursion";
import { zonedDateKey, zonedWeekStartKey } from "../time";
import type { TradeRow } from "../types";
import type { Micromanage } from "../daily-report";

export type DailyReportLite = {
  report_date: string;
  micromanage: Micromanage | null;
  mental_temp: number | null;
  day_grade: string | null;
  rule_broken: boolean | null;
  no_trade_day: boolean;
};

/** A realized trade with the derived values rules keep asking for. */
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
  entryFills: number;
  exitFills: number;
  size: number | null;
  instrument: string | null;
};

export type DayBucket = {
  key: string;
  trades: EnrichedTrade[];
  net: number;
  wins: number;
  losses: number;
  report: DailyReportLite | null;
};

export type WeekBucket = {
  key: string;
  trades: EnrichedTrade[];
  net: number;
  wins: number;
  losses: number;
};

export type InsightBaseline = {
  /** 75th percentile hold time of WINNERS, seconds. */
  winnerHoldP75: number | null;
  /** Median hold time of losers, seconds. */
  loserHoldMedian: number | null;
  /** Mean loss magnitude (positive number). */
  avgLossMagnitude: number | null;
  avgWin: number | null;
  /** Mean favourable excursion, in R. */
  avgMfeR: number | null;
  /** 75th percentile position size. */
  sizeP75: number | null;
  /** Mean trades per week over the window. */
  weeklyTradeCountAvg: number | null;
  /** Mean net of profitable weeks. */
  greenWeekAvgNet: number | null;
  /** Number of realized trades the baselines were built from. */
  sample: number;
};

export type InsightContext = {
  trades: EnrichedTrade[];
  /** All positions, including planned / missed / open. */
  allRows: TradeRow[];
  days: DayBucket[];
  weeks: WeekBucket[];
  reports: DailyReportLite[];
  reportByDate: Map<string, DailyReportLite>;
  baseline: InsightBaseline;
  currency: string;
};

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

const mean = (xs: number[]): number | null =>
  xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

function numField(row: TradeRow, key: string): number | null {
  const v = row[key];
  return typeof v === "number" && !Number.isNaN(v) ? v : null;
}

export type BuildContextInput = {
  trades: RealizedTrade[];
  allRows?: TradeRow[];
  reports?: DailyReportLite[];
  tzOf: (t: RealizedTrade) => string;
  range?: BreakevenRange;
  pnlOf?: (t: RealizedTrade) => number;
  currency?: string;
  /** Fill counts per position id, when execution detail is available. */
  fillCounts?: Map<string, { entries: number; exits: number }>;
};

export function buildInsightContext(input: BuildContextInput): InsightContext {
  const {
    trades,
    allRows = [],
    reports = [],
    tzOf,
    range = EXACT_ZERO_RANGE,
    pnlOf = (t) => t.net,
    currency = "USD",
    fillCounts,
  } = input;

  const enriched: EnrichedTrade[] = trades.map((t) => {
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
      entryFills: fills?.entries ?? 0,
      exitFills: fills?.exits ?? 0,
      size: numField(t.row, "position_size"),
      instrument,
    };
  });

  const reportByDate = new Map(reports.map((r) => [r.report_date, r]));

  // Days are keyed on the CLOSE date, because a day bucket exists to answer
  // "what did this day produce", and production is realization.
  const dayMap = new Map<string, DayBucket>();
  for (const e of enriched) {
    if (!e.closeDay) continue;
    const b =
      dayMap.get(e.closeDay) ??
      {
        key: e.closeDay,
        trades: [],
        net: 0,
        wins: 0,
        losses: 0,
        report: reportByDate.get(e.closeDay) ?? null,
      };
    b.trades.push(e);
    b.net += e.pnl;
    if (e.outcome === "win") b.wins++;
    else if (e.outcome === "loss") b.losses++;
    dayMap.set(e.closeDay, b);
  }

  const weekMap = new Map<string, WeekBucket>();
  for (const e of enriched) {
    if (!e.closeWeek) continue;
    const b =
      weekMap.get(e.closeWeek) ??
      { key: e.closeWeek, trades: [], net: 0, wins: 0, losses: 0 };
    b.trades.push(e);
    b.net += e.pnl;
    if (e.outcome === "win") b.wins++;
    else if (e.outcome === "loss") b.losses++;
    weekMap.set(e.closeWeek, b);
  }

  const days = [...dayMap.values()].sort((a, b) => a.key.localeCompare(b.key));
  const weeks = [...weekMap.values()].sort((a, b) => a.key.localeCompare(b.key));

  const winners = enriched.filter((e) => e.outcome === "win");
  const losers = enriched.filter((e) => e.outcome === "loss");

  const baseline: InsightBaseline = {
    winnerHoldP75: percentile(
      winners.map((e) => e.durationSeconds).filter((s): s is number => s != null),
      0.75,
    ),
    loserHoldMedian: median(
      losers.map((e) => e.durationSeconds).filter((s): s is number => s != null),
    ),
    avgLossMagnitude: mean(losers.map((e) => Math.abs(e.pnl))),
    avgWin: mean(winners.map((e) => e.pnl)),
    avgMfeR: mean(
      enriched.map((e) => e.excursion.mfeR).filter((v): v is number => v != null),
    ),
    sizeP75: percentile(
      enriched.map((e) => e.size).filter((s): s is number => s != null && s > 0),
      0.75,
    ),
    weeklyTradeCountAvg: mean(weeks.map((w) => w.trades.length)),
    greenWeekAvgNet: mean(weeks.filter((w) => w.net > 0).map((w) => w.net)),
    sample: enriched.length,
  };

  return {
    trades: enriched,
    allRows,
    days,
    weeks,
    reports,
    reportByDate,
    baseline,
    currency,
  };
}
