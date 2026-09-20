import { computeStats, winRateOf, type RealizedTrade } from "./analytics";
import type { BreakevenRange } from "./breakeven";
import type { EnrichedTrade } from "./enriched-trade";
import { bucketByPeriod, type PeriodRow } from "./period-stats";
import { isTradingDayKey } from "./time";
import { isInterference, type PositionCheckin } from "./position-checkin";
import { weekDayKeys, weekEndOfWeekStart } from "./weekly-review";

/**
 * What actually happened in the week, counted.
 *
 * This exists because of the specific way weekly reviews fail. Asked "what went
 * well", a trader answers from memory, and memory after five days is a summary
 * of the last one — the recency trap the research names outright. Put the counts
 * on the screen and the question changes from "what do I remember" to "what do I
 * make of this".
 *
 * Everything here is COUNTED, never judged. There is no grade, no verdict, no
 * "you did badly on X": the grade is the trader's to give, and a panel that
 * pre-empted it would be answering the review's first question for them.
 */
export type WeekRecap = {
  /** Trades closed inside the week. */
  closed: number;
  net: number;
  wins: number;
  losses: number;
  /** Of those, the ones whose holding window crossed a Saturday or Sunday. */
  weekendHolds: number;
  /** Days with a daily entry, out of `journalledOutOf`. */
  journalledDays: number;
  /**
   * The days that COUNT as journalling days: Monday to Friday.
   *
   * It was seven, so a trader who wrote every working day read "5 / 7" and
   * looked delinquent for not journalling the weekend. Nothing else in the app
   * scores a Saturday — the tracker and the focus goal both stop at Friday
   * (`isTradingDayKey`), and a weekend entry is neither a miss nor a bonus.
   */
  journalledOutOf: number;
  /** Positions that got at least one check-in during the week. */
  checkedPositions: number;
  /** Of those, ones with a recorded intervention on any day of the week. */
  interferedPositions: number;
  /** Positions whose thesis was recorded as weakened or invalidated. */
  thesisSlippedPositions: number;

  /*
   * The four below are MEASUREMENTS, and the distinction is the reason they are
   * allowed here at all.
   *
   * The header above forbids a grade or a verdict, and that still stands: the
   * week's letter is the trader's to give, in `week_grade`. A win rate is not a
   * verdict — it is the same counting as `wins` and `losses`, expressed as a
   * ratio. Nothing here says whether the week was good.
   *
   * All four are `null` when the week has nothing to divide by, never 0. A week
   * with no closed trades has no win rate; printing 0 % would report a result
   * nobody produced.
   */

  /** Share of decided trades that won. Null when none were decided. */
  winRate: number | null;
  /** Gross profit over gross loss. Null with no losses, `Infinity` with no loss at all. */
  profitFactor: number | null;
  /** Mean R across trades that carry one. Null when none do. */
  avgR: number | null;
  /** How many trades `avgR` averaged over; 0 means it is not a reading. */
  rSample: number;
  /** Mean R per decided trade — the figure the dashboard calls expectancy. */
  expectancy: number | null;
  /** How many trades `expectancy` averaged over; 0 means it is not a reading. */
  expectancySample: number;
};

/**
 * Scoped by CLOSE day, matching the calendar cell and `dailyPnl`.
 *
 * A position opened in week 1 and closed in week 2 belongs to week 2's numbers,
 * because that is the week the money landed — and the two screens must never
 * print different figures for the same span. Its check-ins are a separate
 * question and are counted by their own date, so week 1 still gets credit for
 * the days it judged the position.
 */
export function buildWeekRecap(
  trades: readonly EnrichedTrade[],
  checkins: readonly PositionCheckin[],
  reportDates: ReadonlySet<string>,
  weekStart: string,
  range?: BreakevenRange,
): WeekRecap {
  const weekEnd = weekEndOfWeekStart(weekStart);
  const inWeek = trades.filter(
    (t) => t.closeDay >= weekStart && t.closeDay <= weekEnd,
  );

  const checked = new Set<string>();
  const interfered = new Set<string>();
  const slipped = new Set<string>();
  for (const c of checkins) {
    if (c.report_date < weekStart || c.report_date > weekEnd) continue;
    checked.add(c.position_id);
    if (isInterference(c.touched)) interfered.add(c.position_id);
    if (c.thesis_state === "weakened" || c.thesis_state === "invalidated")
      slipped.add(c.position_id);
  }

  const wins = inWeek.filter((t) => t.outcome === "win").length;
  const losses = inWeek.filter((t) => t.outcome === "loss").length;

  // Delegated, not reimplemented — the same function the dashboard and the day
  // card read. `range` is the one the caller already enriched with, so the
  // classification behind `profitFactor` cannot disagree with the `wins` and
  // `losses` counted a line above from `outcome`.
  const journalDays = weekDayKeys(weekStart).filter(isTradingDayKey);

  const stats = computeStats(
    inWeek.map((t) => t.trade),
    "net",
    range,
  );

  return {
    closed: inWeek.length,
    net: inWeek.reduce((s, t) => s + t.pnl, 0),
    wins,
    losses,
    weekendHolds: inWeek.filter((t) => t.weekendHold).length,
    journalledDays: journalDays.filter((d) => reportDates.has(d)).length,
    journalledOutOf: journalDays.length,
    checkedPositions: checked.size,
    interferedPositions: interfered.size,
    thesisSlippedPositions: slipped.size,

    // From the counts above rather than from `stats`, so the ratio can never
    // contradict the two numbers printed beside it.
    winRate: winRateOf(wins, losses),
    profitFactor: stats.profitFactor,
    // `rSample`, not `expectancySample`: the latter counts trades whose R was
    // decided (a winner or a loser), so a week whose only R-carrying trades
    // scratched breakeven printed "—" over a real 0.00R.
    avgR: stats.rSample > 0 ? stats.avgR : null,
    rSample: stats.rSample,
    expectancy: stats.expectancySample > 0 ? stats.expectancy : null,
    expectancySample: stats.expectancySample,
  };
}

/**
 * The week's seven days, in order, each with its trading or nothing.
 *
 * Exactly seven entries always — Monday through Sunday — because the strip that
 * draws them is a week, and a week with three traded days is still a week. A
 * day that saw no trade is `null`, NOT a zero-filled row: "did not trade" and
 * "traded to a flat result" are different facts, and only one of them is worth
 * a reader's attention.
 *
 * Uses `bucketByPeriod`, the same function `/calendar` buckets its cells with,
 * so a day cannot read one number here and another there.
 */
export function weekDayRows(
  weekStart: string,
  trades: readonly RealizedTrade[],
  tzOf: (t: RealizedTrade) => string,
  range?: BreakevenRange,
): (PeriodRow | null)[] {
  const byDay = new Map<string, PeriodRow>();
  for (const row of bucketByPeriod([...trades], "day", tzOf, range)) {
    byDay.set(row.key, row);
  }
  return weekDayKeys(weekStart).map((d) => byDay.get(d) ?? null);
}
