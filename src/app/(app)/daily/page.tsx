import { getAccounts } from "@/lib/journal/accounts";
import { getDailyReport } from "@/lib/journal/daily-report-queries";
import { todayInTz } from "@/lib/journal/daily-report";
import { getActiveFocusGoal } from "@/lib/journal/focus-goal-queries";
import { getTradesWithStats } from "@/lib/journal/trades";
import {
  getCheckinsForDay,
  getTrackerRules,
} from "@/lib/journal/tracker/queries";
import {
  buildTradeDayIndex,
  configsFromRules,
  evaluateAutoRulesForDay,
} from "@/lib/journal/tracker/auto-rules";
import {
  computeDayCompliance,
  resolveAutoResults,
  ruleIsLiveOn,
} from "@/lib/journal/tracker/compliance";
import { DEFAULT_TZ } from "@/lib/journal/time";
import { FocusGoalCard } from "@/components/journal/focus-goal-card";
import { DailyReportForm } from "@/components/journal/daily-report-form";
import type { TrackerDayData } from "@/components/journal/tracker-checklist";
import type { TradeRow } from "@/lib/journal/types";

export default async function DailyPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const { date: dateParam } = await searchParams;

  const [accounts, rules, trades] = await Promise.all([
    getAccounts(),
    // Retired rules included: this page can look at any past day, and a rule that
    // was live on that day still applied to it. `ruleIsLiveOn` filters per day —
    // which is exactly why it takes the day as an argument.
    getTrackerRules({ includeRetired: true }),
    getTradesWithStats(),
  ]);

  const primary = accounts.find((a) => a.is_active) ?? accounts[0] ?? null;
  const timezone = primary?.timezone ?? DEFAULT_TZ;
  const currency = primary?.currency ?? "USD";
  const today = todayInTz(timezone);

  const reportDate =
    dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)
      ? dateParam > today
        ? today
        : dateParam
      : today;

  const [report, activeGoal, checkins] = await Promise.all([
    getDailyReport(reportDate),
    getActiveFocusGoal(),
    getCheckinsForDay(reportDate),
  ]);

  // Per-trade timezone, not the primary account's: a trade on a NY account and
  // one on a London account close on different calendar days, and attributing
  // both with one zone would misfile the money rules for the other.
  const tzOf = (row: TradeRow) =>
    accounts.find((a) => a.id === row.account_id)?.timezone ?? timezone;

  const index = buildTradeDayIndex(trades, tzOf);
  const dayRules = rules.filter((r) => ruleIsLiveOn(r, reportDate));

  // Live verdicts, then the frozen ones on top. On an unlocked day the overlay is
  // empty and this is just the live evaluation; on a locked day the sealed row
  // wins, so correcting a trade from that day moves the money and leaves the
  // compliance where it was.
  const auto = resolveAutoResults(
    dayRules,
    evaluateAutoRulesForDay(reportDate, index, configsFromRules(rules)),
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
      <div>
        <h1 className="text-2xl font-semibold">Dnevni izveštaj</h1>
        <p className="text-muted-foreground">
          Dnevnik procesa i discipline — oceni dan po napretku ka cilju fokusa,
          ne po P&amp;L-u.
        </p>
      </div>

      <FocusGoalCard goal={activeGoal} reportDate={reportDate} />

      <DailyReportForm
        key={reportDate}
        report={report}
        reportDate={reportDate}
        today={today}
        timezone={timezone}
        activeGoal={activeGoal}
        tracker={tracker}
      />
    </div>
  );
}
