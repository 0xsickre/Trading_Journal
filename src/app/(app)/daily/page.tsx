import { getAccounts } from "@/lib/journal/accounts";
import { getDailyReport } from "@/lib/journal/daily-report-queries";
import { todayInTz } from "@/lib/journal/daily-report";
import { getActiveFocusGoal } from "@/lib/journal/focus-goal-queries";
import { getPositionCheckinsForDay } from "@/lib/journal/position-checkin-queries";
import { openPositionsOn } from "@/lib/journal/open-positions";
import { stringFieldValue } from "@/lib/journal/field-values";
import { getTradesWithStats } from "@/lib/journal/trades";
import { getCheckins, getTrackerRules } from "@/lib/journal/tracker/queries";
import {
  buildTradeDayIndex,
  configsFromRules,
  evaluateAutoRulesForDay,
} from "@/lib/journal/tracker/auto-rules";
import {
  TRACKER_SPAN_DAYS,
  computeComplianceSeries,
  computeDayCompliance,
  computeStreak,
  meanCompliance,
  resolveAutoResults,
  rulesLiveOn,
} from "@/lib/journal/tracker/compliance";
import { computeStats, toRealized } from "@/lib/journal/analytics";
import { computeCostStats } from "@/lib/journal/costs";
import { tradeVolume } from "@/lib/journal/period-stats";
import {
  sharedBreakevenRange,
} from "@/lib/journal/breakeven";
import {
  DEFAULT_TZ,
  addDaysToDayKey,
  isValidDayKey,
  zonedDateKey,
} from "@/lib/journal/time";
import { FocusGoalCard } from "@/components/journal/focus-goal-card";
import { DailyReportForm } from "@/components/journal/daily-report-form";
import { DailyStreakStrip } from "@/components/journal/daily-streak-strip";
import {
  DayStatsCard,
  type DayTradeRow,
} from "@/components/journal/day-stats-card";
import type { TrackerDayData } from "@/components/journal/tracker-checklist";
import type { OpenPositionView } from "@/components/journal/open-positions-card";
import type { TradeRow } from "@/lib/journal/types";
import { PageHeader } from "@/components/app/page-header";
import { accountTimezoneResolver } from "@/lib/journal/time";

export default async function DailyPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const { date: dateParam } = await searchParams;

  const [accounts, rules, trades] = await Promise.all([
    getAccounts(),
    // Retired rules included: this page can look at any past day, and a rule that
    // was live on that day still applied to it. `rulesLiveOn` filters per day —
    // which is exactly why it takes the day as an argument.
    getTrackerRules({ includeRetired: true }),
    getTradesWithStats(),
  ]);

  const primary = accounts.find((a) => a.is_active) ?? accounts[0] ?? null;
  const timezone = primary?.timezone ?? DEFAULT_TZ;
  const currency = primary?.currency ?? "USD";
  const today = todayInTz(timezone);

  // `isValidDayKey`, not a shape regex: `2026-00-00` matches `\d{4}-\d{2}-\d{2}`
  // and then rolls backwards into December 2025, opening a day that does not
  // exist under a heading that says it does.
  const reportDate =
    dateParam && isValidDayKey(dateParam)
      ? dateParam > today
        ? today
        : dateParam
      : today;

  const [report, activeGoal, checkinsByDay, positionCheckins] =
    await Promise.all([
      getDailyReport(reportDate),
      getActiveFocusGoal(),
      // The whole window, not just this day. The streak strip needs the run
      // leading UP TO the day in view, and the checklist's single day is the
      // last entry of that same window — so one round trip serves both, and the
      // two can never disagree about what was ticked.
      getCheckins(
        addDaysToDayKey(reportDate, -(TRACKER_SPAN_DAYS - 1)),
        reportDate,
      ),
      getPositionCheckinsForDay(reportDate),
    ]);

  const checkins = checkinsByDay.get(reportDate) ?? new Map();

  // Per-trade timezone, not the primary account's: a trade on a NY account and
  // one on a London account close on different calendar days, and attributing
  // both with one zone would misfile the money rules for the other.
  const tzFor = accountTimezoneResolver(accounts, timezone);
  const tzOf = (row: TradeRow) => tzFor(row.account_id);

  const index = buildTradeDayIndex(trades, tzOf);
  const dayRules = rulesLiveOn(rules, reportDate);

  // Live verdicts, then the frozen ones on top. On an unlocked day the overlay is
  // empty and this is just the live evaluation; on a locked day the sealed row
  // wins, so correcting a trade from that day moves the money and leaves the
  // compliance where it was.
  const auto = resolveAutoResults(
    dayRules,
    // `dayRules`, not `rules`: the limits scored here must be the ones in force
    // on this day, not a retired rule's leftovers.
    evaluateAutoRulesForDay(reportDate, index, configsFromRules(dayRules)),
    checkins,
  );

  const answers: Record<string, boolean> = {};
  for (const [ruleId, c] of checkins) {
    if (c.checked != null) answers[ruleId] = c.checked;
  }

  // Labels for the "show me" links, over both attributions — an offender of a
  // money rule closed today, one of a decision rule opened today.
  const tradeLabels: Record<string, string> = {};
  for (const t of [
    ...(index.byOpenDay.get(reportDate) ?? []),
    ...(index.byCloseDay.get(reportDate) ?? []),
  ]) {
    tradeLabels[t.id] = t.label;
  }

  /**
   * The day's numbers.
   *
   * Scoped to trades CLOSED on this day — the same rule the calendar cell and
   * `dailyPnl` use, so the two screens can never print different figures for the
   * same date. `toRealized` already drops anything not fully closed.
   */
  const breakevenRange = sharedBreakevenRange(accounts);

  const dayTrades = toRealized(trades).filter(
    (t) => t.closedAt && zonedDateKey(t.closedAt, tzOf(t.row)) === reportDate,
  );
  const dayStats = computeStats(dayTrades, "net", breakevenRange);
  const dayCosts = computeCostStats(dayTrades);
  const dayVolume = dayTrades.reduce((s, t) => s + tradeVolume(t), 0);
  const dayTradeRows: DayTradeRow[] = dayTrades.map((t) => ({
    id: t.id,
    label: t.row.trade_no != null ? `#${t.row.trade_no}` : t.id.slice(0, 8),
    symbol: typeof t.row.symbol === "string" ? t.row.symbol : null,
    net: t.net,
    r: t.r,
    qty: tradeVolume(t),
  }));

  /**
   * The positions this day has to answer for.
   *
   * Derived from `trades`, which this page already loaded for the day's numbers
   * — a second round trip for a list computable from the first is a round trip
   * spent on nothing. Only the seven values the card renders cross to the
   * client: a `TradeRow` carries every custom field on the trade, and shipping
   * whole records to draw a heading is how a page gets slow quietly.
   */
  const openPositions: OpenPositionView[] = openPositionsOn(
    trades,
    reportDate,
    tzOf,
  ).map((p) => ({
    id: p.id,
    label: p.label,
    daysInTrade: p.daysInTrade,
    timeStopDays: p.timeStopDays,
    pastTimeStop: p.pastTimeStop,
    // Read through the field accessor, not off the row: thesis and invalidation
    // are columns today, but the same accessor covers them if they are ever
    // re-declared as custom fields.
    thesis: stringFieldValue(p.row, "thesis"),
    invalidation: stringFieldValue(p.row, "invalidation"),
    checkin: positionCheckins.get(p.id) ?? null,
  }));

  /**
   * The run leading up to the day in view.
   *
   * Anchored on `reportDate`, NOT on today, and that is the point: opening a day
   * in July should say what the streak was in July. Anchoring it on today would
   * print a number about this week on a page about that one.
   *
   * `today` is still passed to the series so a day that is genuinely today can
   * come back `pending` rather than `broken` for rules not yet answered.
   */
  const complianceDays: string[] = [];
  for (let i = TRACKER_SPAN_DAYS - 1; i >= 0; i--) {
    complianceDays.push(addDaysToDayKey(reportDate, -i));
  }

  const series = computeComplianceSeries(
    complianceDays,
    rules,
    checkinsByDay,
    (d) =>
      resolveAutoResults(
        rulesLiveOn(rules, d),
        evaluateAutoRulesForDay(d, index, configsFromRules(rulesLiveOn(rules, d))),
        checkinsByDay.get(d) ?? new Map(),
      ),
    today,
  );
  const streak = computeStreak(series);

  const tracker: TrackerDayData = {
    reportDate,
    rules: dayRules,
    auto,
    answers,
    compliance: computeDayCompliance(reportDate, dayRules, checkins, auto, today),
    currency,
    tradeLabels,
    locked: report?.locked_at != null,
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Daily Check-in"
        description="Did the reason for holding each position survive today, and did you touch it. The review of how the week went is on the weekly page."
      />

      <FocusGoalCard goal={activeGoal} reportDate={reportDate} />

      {/* Above the day's money on purpose. The streak is what this page is FOR
          — the P&L is the outcome of decisions the checklist below governs, and
          putting the run first says which of the two the day is judged on. */}
      <DailyStreakStrip
        current={streak.current}
        meanPct={meanCompliance(series)}
        scoredDays={series.filter((d) => d.pct != null).length}
        hasRules={rules.length > 0}
      />

      <DayStatsCard
        key={`stats:${reportDate}`}
        stats={dayStats}
        costs={dayCosts}
        volume={dayVolume}
        trades={dayTradeRows}
        currency={currency}
      />

      <DailyReportForm
        key={`form:${reportDate}`}
        report={report}
        reportDate={reportDate}
        today={today}
        timezone={timezone}
        activeGoal={activeGoal}
        tracker={tracker}
        positions={openPositions}
      />
    </div>
  );
}
