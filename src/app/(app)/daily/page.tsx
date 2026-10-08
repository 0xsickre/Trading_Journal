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
import { sharedCurrency } from "@/lib/journal/format";
import { accountDayZoneResolver } from "@/lib/journal/time";
import { topstepRulesResolver } from "@/lib/journal/topstep";
import { getTopstepSizing } from "@/lib/journal/topstep-status";
import { getCashEvents } from "@/lib/journal/cash-events";
import { getSessionBriefs } from "@/lib/journal/session-brief-queries";
import { briefResolver } from "@/lib/journal/session-brief";
import { SessionBriefCard } from "@/components/journal/session-brief-card";

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
    // Today by the primary account's day rule: on a Topstep account the
    // evening session after 17:00 CT is already tomorrow's page.
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
    briefs,
    sizing,
    cash,
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
    // The card reads the day in view, and so do the tracker rules that read
    // the red windows and the close.
    dayPromise.then(({ reportDate }) => getSessionBriefs(reportDate, reportDate)),
    // Room and DLL as they stand NOW — shown on today's page only.
    getTopstepSizing(),
    // Payouts lower a Topstep balance, and with it the budgets the tracker derives.
    getCashEvents(),
  ]);
  const briefOf = briefResolver(briefs);
  const primarySizing = primary?.topstep_mode ? sizing[primary.id] : undefined;
  const dllLeft =
    reportDate === today && primarySizing
      ? {
          amount: primarySizing.dllLeftToday,
          of: primarySizing.plan.dll,
          currency: primary?.currency ?? "USD",
          target: primarySizing.target ?? null,
        }
      : null;
  // Money in the checklist's reasons needs ONE currency; with two the
  // primary's is used.
  const currency = sharedCurrency(accounts) ?? primary?.currency ?? "USD";

  const checkins = checkinsByDay.get(reportDate) ?? new Map();

  // Per-trade timezone, not the primary account's: a trade on a NY account and
  // one on a London account close on different calendar days, and attributing
  // both with one zone would misfile the money rules for the other.
  //
  // And per-trade DAY RULE: a Topstep account counts Topstep's trading day
  // (17:00 → 17:00 CT), the day its DLL is charged to, so this page, the banner
  // and the 21:25 reminder agree on which day an evening trade belongs to.
  const tzFor = accountDayZoneResolver(accounts, primary);
  const tzOf = (row: TradeRow) => tzFor(row.account_id);
  // The real book only: Practice is kept apart (trader, 01.10.2026) — it is read by picking
  // that account on the dashboard, trades, calendar and reports.
  const trades = inAllAccountsScope(tradesAll, accounts);

  // A Topstep account's trades are graded by its plan.
  const index = buildTradeDayIndex(trades, tzOf, topstepRulesResolver(accounts, cash));
  const dayRules = rulesLiveOn(rules, reportDate);

  // Live verdicts, then the frozen ones on top. On an unlocked day the overlay is
  // empty and this is just the live evaluation; on a locked day the sealed row
  // wins, so correcting a trade from that day moves the money and leaves the
  // compliance where it was.
  const auto = resolveAutoResults(
    dayRules,
    // `dayRules`, not `rules`: the limits scored here must be the ones in force
    // on this day, not a retired rule's leftovers.
    evaluateAutoRulesForDay(reportDate, index, { briefOf }),
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
    compliance: computeDayCompliance(reportDate, dayRules, checkins, auto, today, {
      report: report ? { no_trade_day: report.no_trade_day } : null,
    }),
    currency,
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
        beforeSession={
          <SessionBriefCard day={reportDate} brief={briefOf(reportDate)} tz={timezone} dllLeft={dllLeft} />
        }
        afterSession={
          <ReviewGapsCard
            gaps={reviewGaps(trades, reportDate, (t) => dayKeyIn(t.stats?.closed_at ?? null, tzOf(t)))}
          />
        }
      />
    </div>
  );
}
