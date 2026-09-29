import { accountFilterOptions, primaryAccount } from "@/lib/journal/account-rules";
import { getAccounts } from "@/lib/journal/accounts";
import { getTradesWithStats } from "@/lib/journal/trades";
import {
  getDailyReportDates,
  getDailyReportsInRange,
} from "@/lib/journal/daily-report-queries";
import { getCheckins, getTrackerRules } from "@/lib/journal/tracker/queries";
import {
  computeComplianceSeries,
  resolveAutoResults,
  rulesLiveOn,
} from "@/lib/journal/tracker/compliance";
import {
  buildTradeDayIndex,
  configsFromRules,
  evaluateAutoRulesForDay,
} from "@/lib/journal/tracker/auto-rules";
import { buildMonthDayList, monthDays } from "@/lib/journal/month-day-list";
import { toRealized, type RealizedTrade } from "@/lib/journal/analytics";
import type { TradeRow } from "@/lib/journal/types";
import { bucketByPeriod, type PeriodRow } from "@/lib/journal/period-stats";
import {
  sharedBreakevenRange,
} from "@/lib/journal/breakeven";
import { isValidMonthKey, todayFor } from "@/lib/journal/time";
import { MonthCalendar, MonthSummaryBar } from "@/components/journal/month-calendar";
import { sharedCurrency } from "@/lib/journal/format";
import { summarizeMonth } from "@/lib/journal/calendar-view";
import { MonthDayList } from "@/components/journal/month-day-list";
import { CalendarViewToggle } from "@/components/journal/calendar-view-toggle";
import { PageHeader } from "@/components/app/page-header";
import { accountDayZoneResolver } from "@/lib/journal/time";
import { topstepRulesResolver } from "@/lib/journal/topstep";
import { getSessionBriefs } from "@/lib/journal/session-brief-queries";
import { briefResolver } from "@/lib/journal/session-brief";


function indexBy(rows: PeriodRow[]): Map<string, PeriodRow> {
  return new Map(rows.map((r) => [r.key, r]));
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; view?: string; account?: string }>;
}) {
  const { month: monthParam, view: viewParam, account: accountParam } = await searchParams;
  // Anything that is not exactly "list" is the grid. Same direction as
  // `asPnlBasis` in the reports params: fall back to what the screen has always
  // shown, so a truncated or mistyped link opens the familiar view.
  const view = viewParam === "list" ? "list" : "grid";

  const [accounts, trades, loggedDates] = await Promise.all([
    getAccounts(),
    getTradesWithStats(),
    getDailyReportDates(),
  ]);

  const primary = primaryAccount(accounts);
  const todayKey = todayFor(primary);
  const currentMonth = todayKey.slice(0, 7);

  // Future months hold nothing and only invite the user to wander; clamp like
  // /daily clamps its date.
  const monthKey =
    monthParam && isValidMonthKey(monthParam)
      ? monthParam > currentMonth
        ? currentMonth
        : monthParam
      : currentMonth;

  // Per-trade timezone, not the primary account's: a trade on a NY account and
  // one on a London account close on different calendar days, and one zone for
  // both would file them under the wrong cells. A Topstep account files by
  // Topstep's trading day, 17:00 → 17:00 CT — the day its DLL is charged to.
  const tzFor = accountDayZoneResolver(accounts, primary);
  const tzOf = (t: RealizedTrade) => tzFor(t.row.account_id);
  // The same resolver one level down: the auto-rule index works on raw rows,
  // including positions that never closed, which `RealizedTrade` excludes.
  const tzOfRow = (row: TradeRow) => tzFor(row.account_id);

  /**
   * Which accounts the money covers.
   *
   * There was no choice before: every account was summed, and with accounts in
   * two currencies the total was printed as "USD" — €500 and $300 as $800.
   * "All accounts" is still the default when the currencies agree; when they
   * do not, there is no honest pooled figure, so the page opens on the primary
   * account and says why instead of inventing one.
   */
  const pooledCurrency = sharedCurrency(accounts);
  const requested =
    accountParam && accounts.some((a) => a.id === accountParam) ? accountParam : "all";
  const mixedFallback = requested === "all" && accounts.length > 1 && pooledCurrency == null;
  const accountId = mixedFallback ? (primary?.id ?? "all") : requested;
  const scopedAccounts =
    accountId === "all" ? accounts : accounts.filter((a) => a.id === accountId);
  const currency = sharedCurrency(scopedAccounts) ?? primary?.currency ?? "USD";
  const scopedTrades =
    accountId === "all" ? trades : trades.filter((t) => t.account_id === accountId);

  /**
   * Breakeven band, only when every account agrees on it.
   *
   * Same reconciliation as `dashboard.tsx` — with two accounts configured
   * differently there is no single band that describes the mixed figure, so it
   * falls back to exact zero rather than picking a winner.
   *
   * The band is defined per TRADE and applied here to a DAY's total. That is the
   * intended reading, one unit up: a ±50 band that calls a single +30 trade flat
   * says the same about a day that ended +30.
   */
  const breakevenRange = sharedBreakevenRange(scopedAccounts);

  const realized = toRealized(scopedTrades);

  // One bucketing function, three granularities — cells, week column and header
  // can never disagree about which day a Friday-night close belongs to.
  const byDay = indexBy(bucketByPeriod(realized, "day", tzOf, breakevenRange));
  const byWeek = indexBy(bucketByPeriod(realized, "week", tzOf, breakevenRange));
  const byMonth = indexBy(bucketByPeriod(realized, "month", tzOf, breakevenRange));

  /**
   * The list's extra reads, done ONLY for the list.
   *
   * The grid has never needed journals or rule compliance, and making every
   * calendar visit pay for them would slow the common path to serve the rarer
   * one. Two extra round trips on `?view=list`, none on the default.
   */
  const entries = view === "list" ? await buildEntries() : [];

  async function buildEntries() {
    const days = monthDays(monthKey);
    const from = days[0];
    const to = days[days.length - 1];

    const [reports, rules, checkinsByDay, briefs] = await Promise.all([
      getDailyReportsInRange(from, to),
      // Retired rules included, and `rulesLiveOn` filters per day — a rule that
      // was live in March still judged March, and dropping it would raise that
      // month's compliance after the fact.
      getTrackerRules({ includeRetired: true }),
      // Joins the batch rather than following it: this depends only on the
      // date range, which was computed above, so awaiting it separately bought
      // nothing but a round trip.
      getCheckins(from, to),
      // The month's briefs, for the rules that read the red windows and the close.
      getSessionBriefs(from, to),
    ]);
    const briefOf = briefResolver(briefs);

    const index = buildTradeDayIndex(trades, tzOfRow, topstepRulesResolver(accounts));
    const series = computeComplianceSeries(
      days,
      rules,
      checkinsByDay,
      (d) => {
        const live = rulesLiveOn(rules, d);
        return resolveAutoResults(
          live,
          evaluateAutoRulesForDay(d, index, configsFromRules(live), { briefOf }),
          checkinsByDay.get(d) ?? new Map(),
        );
      },
      todayKey,
    );

    return buildMonthDayList(
      monthKey,
      byDay,
      reports,
      new Map(series.map((d) => [d.date, d.pct])),
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Calendar"
        description="Your month day by day, with weekly and monthly totals."
      />

      <CalendarViewToggle
        monthKey={monthKey}
        view={view}
        accountId={accountId}
        accounts={accountFilterOptions(accounts)}
        // "All" only when a pooled figure exists; otherwise it would be offered
        // and then silently replaced.
        allowAll={pooledCurrency != null || accounts.length <= 1}
      />

      {mixedFallback && (
        <p className="text-xs text-muted-foreground">
          Your accounts use different currencies, so they cannot be summed —
          showing {primary?.name ?? "the primary account"}. Pick another account above.
        </p>
      )}

      <MonthSummaryBar
        summary={summarizeMonth(monthKey, byDay, breakevenRange)}
        currency={currency}
      />

      {view === "list" ? (
        <MonthDayList
          monthKey={monthKey}
          currentMonth={currentMonth}
          entries={entries}
          currency={currency}
          accountId={accountId}
        />
      ) : (
      <MonthCalendar
        monthKey={monthKey}
        currentMonth={currentMonth}
        todayKey={todayKey}
        byDay={byDay}
        byWeek={byWeek}
        byMonth={byMonth}
        loggedDays={new Set(loggedDates)}
        breakevenRange={breakevenRange}
        currency={currency}
        accountId={accountId}
      />
      )}
    </div>
  );
}
