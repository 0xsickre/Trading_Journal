/**
 * Pre-computed context every rule reads.
 *
 * Built once per evaluation so thirty rules do not each walk the same trades.
 * It also centralises the baselines — "your average winner", "your typical
 * size" — so every rule compares against the same history rather than each
 * inventing its own window.
 */

import type { RealizedTrade } from "../analytics";
import { type BreakevenRange, EXACT_ZERO_RANGE } from "../breakeven";
import {
  enrichTrades,
  mean,
  median,
  percentile,
  type DailyReportLite,
  type EnrichedTrade,
  type FillCounts,
} from "../enriched-trade";
import type { PositionCheckin } from "../position-checkin";
import type { RuleLookup } from "../reports/rule-lookup";
import type { TradeRow } from "../types";

// Re-exported because the definitions live in `enriched-trade.ts` — the report
// engine needs them too — and the insight rules refer to these types by name.
//
// `percentile` and `median` used to be re-exported here as well, under a comment
// saying it was "so existing importers keep working". There were none: every
// caller imports them from `enriched-trade.ts` directly. A compatibility shim
// for a compatibility problem nobody had.
export type { DailyReportLite, EnrichedTrade };

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
  /**
   * Position id → that position's daily check-ins, oldest first.
   *
   * Keyed by position rather than by date, and that is not a storage detail. The
   * process facts a swing book records — did the thesis hold, did I touch it —
   * belong to a POSITION across several days. Indexing them by day was the old
   * shape, and it forced every reader to sweep a date range and then guess which
   * of that day's open positions the answer was about.
   */
  checkinsByPosition: Map<string, PositionCheckin[]>;
  baseline: InsightBaseline;
  currency: string;
  /**
   * Rules and their answers, for the DERIVED setup grade.
   *
   * Optional: a caller without playbooks loaded still gets every other rule.
   * The two A-setup rules fall back to the hand-typed column when it is absent,
   * which is what keeps them working on trades graded before criteria existed.
   */
  rules?: RuleLookup;
};

export type BuildContextInput = {
  trades: RealizedTrade[];
  allRows?: TradeRow[];
  reports?: DailyReportLite[];
  tzOf: (t: RealizedTrade) => string;
  range?: BreakevenRange;
  pnlOf?: (t: RealizedTrade) => number;
  currency?: string;
  /** Fill counts per position id, when execution detail is available. */
  fillCounts?: FillCounts;
  /** Per-position daily check-ins, flat; bucketed by position id here. */
  checkins?: PositionCheckin[];
  rules?: RuleLookup;
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
    checkins = [],
    rules,
  } = input;

  const enriched = enrichTrades(trades, { tzOf, range, pnlOf, fillCounts });

  const reportByDate = new Map(reports.map((r) => [r.report_date, r]));

  // Sorted by date inside each bucket so a rule that wants "the day the thesis
  // died" gets the first such day, not whichever row the query returned first.
  const checkinsByPosition = new Map<string, PositionCheckin[]>();
  for (const c of [...checkins].sort((a, b) =>
    a.report_date.localeCompare(b.report_date),
  )) {
    const list = checkinsByPosition.get(c.position_id);
    if (list) list.push(c);
    else checkinsByPosition.set(c.position_id, [c]);
  }

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
    checkinsByPosition,
    baseline,
    currency,
    rules,
  };
}
