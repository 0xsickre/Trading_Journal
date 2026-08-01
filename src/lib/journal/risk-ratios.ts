/**
 * Risk-adjusted return ratios — Sharpe, Sortino, Calmar — and daily drawdown.
 *
 * All four are computed over a series of DAILY P&L, not per trade. That is the
 * whole point: a book of twenty trades crammed into one day and a book of the
 * same twenty trades spread over a month carry very different risk, and only a
 * daily series can tell them apart.
 *
 * Three decisions shape every number here, and each one is a place the textbook
 * formula does not fit a trading journal:
 *
 *   1. A "period" is a day that HAS a closed trade, not a calendar day.
 *      Filling weekends and idle days with zeros would be defensible for the
 *      whole book, but these ratios also run inside report buckets — "trades
 *      entered on Monday", "trades tagged FVG" — and there the calendar is six
 *      sevenths zeros by construction. The mean collapses, the deviation
 *      collapses with it, and the ratio becomes a statement about how rarely
 *      you trade rather than about how well.
 *
 *   2. The annualization factor is MEASURED, not assumed. Convention multiplies
 *      a daily Sharpe by sqrt(252) for equities or sqrt(365) for crypto. Both
 *      assume you are in the market every session. A swing trader closing on
 *      forty days a year is not, and sqrt(252) would inflate the number by more
 *      than a factor of two. So the periods per year come out of the data:
 *      trading days divided by the span they cover. Trade forty days a year and
 *      the factor is sqrt(40), which is the honest one.
 *
 *   3. Below `MIN_RATIO_DAYS` days everything returns null instead of a number.
 *      A standard deviation over three days is arithmetic, not evidence.
 *
 * Everything is in account currency; a ratio of two money figures is unitless,
 * so no equity base is needed and no percentage return has to be invented.
 */

import { daysBetweenDayKeys, toEpoch } from "./time";

/** A closed trade reduced to what these statistics need. */
export type DayPnlPoint = {
  /** Day key in the ACCOUNT's zone — the close day, where the money lands. */
  day: string;
  /** Close instant. Used only to order trades within one day. */
  at: string | null;
  pnl: number;
};

/**
 * Fewest trading days that may produce a ratio.
 *
 * Five is a judgement call, deliberately kept as one constant rather than
 * scattered through the four functions: it is the number to move once there is
 * enough live history to say what a trustworthy sample looks like.
 */
export const MIN_RATIO_DAYS = 5;

/** Calendar days in a year — the span is measured in calendar days, not sessions. */
export const CALENDAR_DAYS_PER_YEAR = 365;

/** Trading days in close order, each carrying its trades in close order. */
export function groupByDay(points: readonly DayPnlPoint[]): Map<string, number[]> {
  const byDay = new Map<string, DayPnlPoint[]>();
  for (const p of points) {
    if (!p.day) continue;
    const bucket = byDay.get(p.day);
    if (bucket) bucket.push(p);
    else byDay.set(p.day, [p]);
  }

  const out = new Map<string, number[]>();
  for (const day of [...byDay.keys()].sort()) {
    const bucket = byDay.get(day)!;
    // Order within the day decides where the intraday peak sits, so it decides
    // the daily drawdown. Trades arrive in whatever order the query returned.
    bucket.sort((a, b) => toEpoch(a.at) - toEpoch(b.at));
    out.set(day, bucket.map((p) => p.pnl));
  }
  return out;
}

/** One P&L figure per trading day, in day order. */
export function dailyTotals(
  points: readonly DayPnlPoint[],
): { day: string; pnl: number }[] {
  return [...groupByDay(points)].map(([day, pnls]) => ({
    day,
    pnl: pnls.reduce((a, b) => a + b, 0),
  }));
}

export type RiskRatios = {
  /** Days carrying at least one closed trade. */
  days: number;
  /** Calendar days from the first trading day to the last, inclusive. */
  spanDays: number;
  /** Trading days per calendar year, measured from the data. */
  periodsPerYear: number | null;
  meanDaily: number | null;
  /** Population standard deviation of daily P&L. */
  stdevDaily: number | null;
  /** Root mean square of losing days only, over ALL days. */
  downsideDeviation: number | null;
  /** Annualized mean / stdev. Null when every day is identical. */
  sharpe: number | null;
  /** Annualized mean / downside deviation. Null when no day lost money. */
  sortino: number | null;
  /** Annualized net P&L / max drawdown. Null while the curve has never fallen. */
  calmar: number | null;
};

const EMPTY_RATIOS: RiskRatios = {
  days: 0,
  spanDays: 0,
  periodsPerYear: null,
  meanDaily: null,
  stdevDaily: null,
  downsideDeviation: null,
  sharpe: null,
  sortino: null,
  calmar: null,
};

/**
 * Sharpe, Sortino and Calmar over a set of closed trades.
 *
 * `maxDrawdownMoney` comes from `computeDrawdown` — negative, or 0 when the
 * curve never fell — because Calmar's denominator must be the same drawdown the
 * rest of the app reports. Recomputing it here from the daily series would give
 * a shallower number (it cannot see a dip that opened and closed inside one
 * day) and the two would quietly disagree.
 *
 * The risk-free rate is 0 throughout. For a leveraged futures/FX book the
 * capital is margin, not a deposit earning T-bills, and subtracting a rate from
 * a P&L figure that has no principal behind it would be inventing a number.
 * Sortino's minimum acceptable return is 0 for the same reason: a losing day is
 * the downside, full stop.
 */
export function computeRiskRatios(
  points: readonly DayPnlPoint[],
  maxDrawdownMoney: number,
): RiskRatios {
  const series = dailyTotals(points);
  const days = series.length;
  if (days === 0) return EMPTY_RATIOS;

  const spanDays =
    daysBetweenDayKeys(series[0].day, series[days - 1].day) + 1;

  if (days < MIN_RATIO_DAYS) {
    return { ...EMPTY_RATIOS, days, spanDays };
  }

  const total = series.reduce((a, d) => a + d.pnl, 0);
  const meanDaily = total / days;

  // Population, not sample: this is every trading day in scope, not a draw from
  // a larger set. Same choice as `consistencyScore`, for the same reason.
  const stdevDaily = Math.sqrt(
    series.reduce((acc, d) => acc + (d.pnl - meanDaily) ** 2, 0) / days,
  );
  // Downside deviation divides by ALL days, not just the losing ones. Dividing
  // by the losing count instead would reward a book for losing rarely twice —
  // once in the mean and again in the denominator.
  const downsideDeviation = Math.sqrt(
    series.reduce((acc, d) => acc + Math.min(d.pnl, 0) ** 2, 0) / days,
  );

  const periodsPerYear =
    spanDays > 0 ? (days * CALENDAR_DAYS_PER_YEAR) / spanDays : null;
  const annualize = periodsPerYear != null ? Math.sqrt(periodsPerYear) : null;

  const dd = Math.abs(maxDrawdownMoney);
  const annualReturn =
    spanDays > 0 ? total * (CALENDAR_DAYS_PER_YEAR / spanDays) : null;

  return {
    days,
    spanDays,
    periodsPerYear,
    meanDaily,
    stdevDaily,
    downsideDeviation,
    sharpe:
      annualize != null && stdevDaily > 0
        ? (meanDaily / stdevDaily) * annualize
        : null,
    // No losing day means no downside to divide by. Null, not infinity — the
    // same call `profitFactor` makes when there is no losing trade.
    sortino:
      annualize != null && downsideDeviation > 0
        ? (meanDaily / downsideDeviation) * annualize
        : null,
    // Calmar is the recovery factor put on an annual footing: same ratio, but
    // divided by how long the book took to earn it. Two accounts with identical
    // recovery factors are not equal if one needed four times as long.
    calmar: annualReturn != null && dd > 0 ? annualReturn / dd : null,
  };
}

export type DailyDrawdownStats = {
  /** Trading days considered, including days that never went underwater. */
  days: number;
  /** Mean within-day peak-to-trough decline. Negative, or 0 when no day fell. */
  avgMoney: number;
  /** Deepest single day. Negative, or 0. */
  worstMoney: number;
  worstDay: string | null;
};

const EMPTY_DAILY_DD: DailyDrawdownStats = {
  days: 0,
  avgMoney: 0,
  worstMoney: 0,
  worstDay: null,
};

/**
 * Average daily drawdown.
 *
 * Measured the way a prop firm measures it: each day starts fresh at zero, the
 * running total walks the day's closes in order, and the day's drawdown is the
 * deepest drop below the best point reached so far THAT DAY. Carrying the peak
 * across days would just reproduce the account-wide max drawdown one day at a
 * time; the daily rule is the one an FTMO-style limit actually enforces, and
 * `tj_accounts.ftmo_daily_loss_pct` already exists to be checked against it.
 *
 * Days that never went underwater count as 0 and stay in the denominator.
 * Averaging over losing days only would answer "how bad are my bad days", which
 * is a different question and a much larger number.
 *
 * Resolution is one point per closed trade — a position opened and closed
 * within the day contributes one step, and a dip that happened while the
 * position was open is invisible here. `max_drawdown_price` (MAE) is where that
 * lives; this is the realized curve.
 */
export function computeDailyDrawdown(
  points: readonly DayPnlPoint[],
): DailyDrawdownStats {
  const byDay = groupByDay(points);
  if (byDay.size === 0) return EMPTY_DAILY_DD;

  let sum = 0;
  let worstMoney = 0;
  let worstDay: string | null = null;

  for (const [day, pnls] of byDay) {
    let running = 0;
    // Peak starts at 0 — the day opens at its own high-water mark, which is
    // what makes the first losing trade of the day count as drawdown.
    let peak = 0;
    let deepest = 0;
    for (const pnl of pnls) {
      running += pnl;
      if (running > peak) peak = running;
      const drop = running - peak;
      if (drop < deepest) deepest = drop;
    }
    sum += deepest;
    if (deepest < worstMoney) {
      worstMoney = deepest;
      worstDay = day;
    }
  }

  return {
    days: byDay.size,
    avgMoney: sum / byDay.size,
    worstMoney,
    worstDay,
  };
}
