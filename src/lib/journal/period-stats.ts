/**
 * Weekly and monthly layer.
 *
 * TradeZella's headline cadence metric is Day Win % — a day-trading unit. For a
 * swing book the day is a process unit and the week is the result unit, so the
 * same statistics are computed per ISO week and per calendar month instead.
 */

import type { RealizedTrade } from "./analytics";
import { classifyOutcome, EXACT_ZERO_RANGE, type BreakevenRange } from "./breakeven";
import { zonedDateKey, zonedWeekStartKey } from "./time";

export type PeriodGranularity = "week" | "month";

export type PeriodRow = {
  /** ISO week Monday ("2026-01-05") or month ("2026-01"). */
  key: string;
  net: number;
  gross: number;
  trades: number;
  wins: number;
  losses: number;
  breakeven: number;
};

export type PeriodSummary = {
  periods: number;
  /** Share of periods that finished positive. The swing answer to Day Win %. */
  winPct: number;
  winning: number;
  losing: number;
  flat: number;
  avgPnl: number | null;
  avgWinningPnl: number | null;
  avgLosingPnl: number | null;
  largest: PeriodRow | null;
  smallest: PeriodRow | null;
  /**
   * P&L of the best / worst period ON THE SELECTED BASIS. Carried explicitly so
   * a caller rendering the summary never has to know whether gross or net was
   * summarized — reading `largest.net` directly would silently show net figures
   * while the rest of the dashboard was in gross.
   */
  largestPnl: number | null;
  smallestPnl: number | null;
  maxConsecutiveWinning: number;
  maxConsecutiveLosing: number;
};

export const EMPTY_PERIOD_SUMMARY: PeriodSummary = {
  periods: 0,
  winPct: 0,
  winning: 0,
  losing: 0,
  flat: 0,
  avgPnl: null,
  avgWinningPnl: null,
  avgLosingPnl: null,
  largest: null,
  smallest: null,
  largestPnl: null,
  smallestPnl: null,
  maxConsecutiveWinning: 0,
  maxConsecutiveLosing: 0,
};

/**
 * Bucket realized trades by period.
 *
 * Attribution is by CLOSE date, deliberately diverging from TradeZella, which
 * dates a trade to the day it was opened. That convention is harmless intraday
 * but would put a three-week swing's profit in the week the idea started rather
 * than the week the money arrived, which makes weekly P&L unusable. Activity
 * metrics use the open date instead — see `activity.ts`.
 */
export function bucketByPeriod(
  trades: RealizedTrade[],
  granularity: PeriodGranularity,
  tzOf: (t: RealizedTrade) => string,
  range: BreakevenRange = EXACT_ZERO_RANGE,
  pnlOf: (t: RealizedTrade) => number = (t) => t.net,
): PeriodRow[] {
  const map = new Map<string, PeriodRow>();

  for (const t of trades) {
    if (!t.closedAt) continue;
    const tz = tzOf(t);
    const key =
      granularity === "week"
        ? zonedWeekStartKey(t.closedAt, tz)
        : zonedDateKey(t.closedAt, tz).slice(0, 7);
    if (!key) continue;

    const row =
      map.get(key) ??
      { key, net: 0, gross: 0, trades: 0, wins: 0, losses: 0, breakeven: 0 };

    const p = pnlOf(t);
    row.net += t.net;
    row.gross += t.gross;
    row.trades++;
    const outcome = classifyOutcome(p, range);
    if (outcome === "win") row.wins++;
    else if (outcome === "loss") row.losses++;
    else row.breakeven++;

    map.set(key, row);
  }

  return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Summarize periods. A period counts as winning on its TOTAL P&L, matching the
 * spec's "winning day = day with positive total daily P&L".
 */
export function summarizePeriods(
  rows: PeriodRow[],
  pnlOf: (r: PeriodRow) => number = (r) => r.net,
): PeriodSummary {
  if (rows.length === 0) return EMPTY_PERIOD_SUMMARY;

  let winning = 0;
  let losing = 0;
  let flat = 0;
  let sum = 0;
  let winSum = 0;
  let lossSum = 0;
  let largest: PeriodRow | null = null;
  let smallest: PeriodRow | null = null;

  let curWin = 0;
  let curLoss = 0;
  let maxWin = 0;
  let maxLoss = 0;

  for (const r of rows) {
    const p = pnlOf(r);
    sum += p;

    if (p > 0) {
      winning++;
      winSum += p;
      curWin++;
      curLoss = 0;
    } else if (p < 0) {
      losing++;
      lossSum += p;
      curLoss++;
      curWin = 0;
    } else {
      flat++;
      curWin = 0;
      curLoss = 0;
    }
    maxWin = Math.max(maxWin, curWin);
    maxLoss = Math.max(maxLoss, curLoss);

    if (largest == null || p > pnlOf(largest)) largest = r;
    if (smallest == null || p < pnlOf(smallest)) smallest = r;
  }

  const decided = winning + losing;
  return {
    periods: rows.length,
    // Flat periods are excluded from the denominator, matching how trade win
    // rate treats breakeven trades.
    winPct: decided > 0 ? (winning / decided) * 100 : 0,
    winning,
    losing,
    flat,
    avgPnl: sum / rows.length,
    avgWinningPnl: winning > 0 ? winSum / winning : null,
    avgLosingPnl: losing > 0 ? lossSum / losing : null,
    largest,
    smallest,
    largestPnl: largest ? pnlOf(largest) : null,
    smallestPnl: smallest ? pnlOf(smallest) : null,
    maxConsecutiveWinning: maxWin,
    maxConsecutiveLosing: maxLoss,
  };
}
