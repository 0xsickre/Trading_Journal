import { inAllAccountsScope, primaryAccount } from "@/lib/journal/account-rules";
import { getAccounts } from "@/lib/journal/accounts";
import { getDailyReport } from "@/lib/journal/daily-report-queries";
import { getTradesWithStats } from "@/lib/journal/trades";
import { getCheckins, getTrackerRules } from "@/lib/journal/tracker/queries";
import {
  buildTradeDayIndex,
  evaluateAutoRulesForDay,
} from "@/lib/journal/tracker/auto-rules";
import {
  computeDayCompliance,
  resolveAutoResults,
  rulesLiveOn,
} from "@/lib/journal/tracker/compliance";
import {
  DEFAULT_TZ,
  dayKeyIn,
  isValidDayKey,
  todayFor,
} from "@/lib/journal/time";
import { DailyReportForm } from "@/components/journal/daily-report-form";
import type { TrackerDayData } from "@/components/journal/tracker-checklist";
import type { TradeRow } from "@/lib/journal/types";
import { PageHeader } from "@/components/app/page-header";
import { ReviewGapsCard } from "@/components/journal/review-gaps-card";
import { reviewGaps } from "@/lib/journal/review-gaps";
import { accountDayZoneResolver } from "@/lib/journal/time";
import { breakevenRangeResolver } from "@/lib/journal/breakeven";
import { flatByResolver } from "@/lib/journal/flat-by";
import { DayCloseCard } from "@/components/journal/day-close-card";
import { dayClose } from "@/lib/journal/day-close";
import { autoMistakes } from "@/lib/journal/auto-mistakes";
import { getOptionsMap } from "@/lib/journal/options";
import { tradingWindowResolver } from "@/lib/journal/tracker/trading-window";

export default async function DailyPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const { date: dateParam } = await searchParams;

  // One batch. The day on screen depends on the account's timezone, so the three
  // reads keyed by that day are chained onto the accounts instead of waiting for
  // a whole first batch — that second batch used to cost the page a round trip.
  const accountsPromise = getAccounts();
  const dayPromise = accountsPromise.then((accounts) => {
    const primary = primaryAccount(accounts);
    const timezone = primary?.timezone ?? DEFAULT_TZ;
    // Today by the primary account's day rule: the evening session after
    // 17:00 CT is already tomorrow's page.
    const today = todayFor(primary);
    // `isValidDayKey`, not a shape regex: `2026-00-00` matches `\d{4}-\d{2}-\d{2}`
    // and then rolls backwards into December 2025, opening a day that does not
    // exist under a heading that says it does.
    const reportDate =
      dateParam && isValidDayKey(dateParam)
        ? dateParam > today
          ? today
          : dateParam
        : today;
    return { primary, timezone, today, reportDate };
  });

  const [
    accounts,
    { primary, timezone, today, reportDate },
    rules,
    tradesAll,
    report,
    checkinsByDay,
    optionsMap,
  ] = await Promise.all([
    accountsPromise,
    dayPromise,
    // Retired rules included: this page can look at any past day, and a rule that
    // was live on that day still applied to it. `rulesLiveOn` filters per day —
    // which is exactly why it takes the day as an argument.
    getTrackerRules({ includeRetired: true }),
    getTradesWithStats(),
    dayPromise.then(({ reportDate }) => getDailyReport(reportDate)),
    // The day in view only: the streak strip that read the 28 weeks behind it
    // left in phase M — the run of days is the mentor's to read, from the pack.
    dayPromise.then(({ reportDate }) => getCheckins(reportDate, reportDate)),
    // The emotion list, for the day's psychology (phase B5).
    getOptionsMap(true),
  ]);

  const checkins = checkinsByDay.get(reportDate) ?? new Map();

  // Per-trade timezone, not the primary account's: a trade on a NY account and
  // one on a London account close on different calendar days, and attributing
  // both with one zone would misfile the stop-loss run for the other.
  //
  // And per-trade DAY RULE: the CME trading day (17:00 → 17:00 CT), so this
  // page and the 21:25 reminder agree on which day an evening trade belongs to.
  const tzFor = accountDayZoneResolver(accounts, primary);
  const tzOf = (row: TradeRow) => tzFor(row.account_id);
  // The real book only: Practice is kept apart (trader, 01.10.2026) — it is read by picking
  // that account on the dashboard, trades, calendar and reports.
  const trades = inAllAccountsScope(tradesAll, accounts);

  // A stop loss is judged by the account's breakeven band.
  const bandOf = breakevenRangeResolver(accounts);
  const index = buildTradeDayIndex(trades, tzOf, bandOf);
  const dayRules = rulesLiveOn(rules, reportDate);
  const autoCtx = {
    tradingWindowOf: tradingWindowResolver(rules),
    flatByOf: flatByResolver(accounts),
    // Phase B5: the day's psychology, as saved.
    reportOf: (d: string) => (d === reportDate ? report : null),
  };

  // Live verdicts, then the frozen ones on top. On an unlocked day the overlay is
  // empty and this is just the live evaluation; on a locked day the sealed row
  // wins, so correcting a trade from that day moves the money and leaves the
  // compliance where it was.
  const auto = resolveAutoResults(
    dayRules,
    // `dayRules`, not `rules`: the limits scored here must be the ones in force
    // on this day, not a retired rule's leftovers.
    evaluateAutoRulesForDay(reportDate, index, autoCtx),
    checkins,
  );

  // The close of the day (phase B7): the trades opened on it, with what the
  // journal found on each, as the trade page shows it.
  const openedIds = new Set((index.byOpenDay.get(reportDate) ?? []).map((t) => t.id));
  const touchedIds = new Set([...openedIds, ...(index.byCloseDay.get(reportDate) ?? []).map((t) => t.id)]);
  const dayRows = trades.filter((t) => openedIds.has(t.id));
  const found = autoMistakes(
    trades.filter((t) => touchedIds.has(t.id)),
    tzOf,
    bandOf,
    autoCtx,
  );

  const answers: Record<string, boolean> = {};
  for (const [ruleId, c] of checkins) {
    if (c.checked != null) answers[ruleId] = c.checked;
  }

  // Labels for the "show me" links, over both attributions — an offender of a
  // stop-loss run closed today, one of a decision rule opened today.
  const tradeLabels: Record<string, string> = {};
  for (const t of [
    ...(index.byOpenDay.get(reportDate) ?? []),
    ...(index.byCloseDay.get(reportDate) ?? []),
  ]) {
    tradeLabels[t.id] = t.label;
  }

  // The day's first entry, for the gate written after it (phase Y): the trades
  // OPENED this day, the same attribution as the entry rules.
  const firstEntryAt =
    (index.byOpenDay.get(reportDate) ?? []).map((t) => t.openedAt).sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null;

  const tracker: TrackerDayData = {
    reportDate,
    rules: dayRules,
    auto,
    answers,
    compliance: computeDayCompliance(reportDate, dayRules, checkins, auto, today, {
      report: report ? { no_trade_day: report.no_trade_day } : null,
    }),
    tradeLabels,
    locked: report?.locked_at != null,
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Dnevna prijava"
        description="Dan u tri koraka: pre sesije, tokom nje i posle nje. Zatvaranje dana i nedelje radiš sa mentorom, iz mentor pack-a."
      />

      <DailyReportForm
        key={`form:${reportDate}`}
        report={report}
        reportDate={reportDate}
        today={today}
        timezone={timezone}
        tracker={tracker}
        firstEntryAt={firstEntryAt}
        emotions={(optionsMap.emotion ?? []).map((o) => ({ value: o.value, label: o.label }))}
        dayClose={<DayCloseCard close={dayClose(dayRows, found)} currency={primary?.currency ?? "USD"} />}
        afterSession={
          <>
            <ReviewGapsCard
              gaps={reviewGaps(trades, reportDate, (t) => dayKeyIn(t.stats?.closed_at ?? null, tzOf(t)))}
            />
          </>
        }
      />
    </div>
  );
}
