import { accountFilterOptions, primaryAccount } from "@/lib/journal/account-rules";
import { getAccounts } from "@/lib/journal/accounts";
import { getDailyReportDatesInRange } from "@/lib/journal/daily-report-queries";
import { todayInTz } from "@/lib/journal/daily-report";
import { getPositionCheckinsInRange } from "@/lib/journal/position-checkin-queries";
import { getTradesWithStats } from "@/lib/journal/trades";
import { getWeeklyReview } from "@/lib/journal/weekly-review-queries";
import { toRealized } from "@/lib/journal/analytics";
import { enrichTrades } from "@/lib/journal/enriched-trade";
import { buildWeekRecap, weekDayRows } from "@/lib/journal/week-recap";
import { sharedBreakevenRange } from "@/lib/journal/breakeven";
import { sharedCurrency } from "@/lib/journal/format";
import { DEFAULT_TZ, isValidDayKey, zonedDateKey } from "@/lib/journal/time";
import {
  addWeeksToWeekStart,
  defaultWeekStart,
  weekEndOfWeekStart,
  weekStartOfDayKey,
} from "@/lib/journal/weekly-review";
import { WeeklyReviewForm } from "@/components/journal/weekly-review-form";
import { ExperimentCard } from "@/components/journal/experiment-card";
import { getExperiments } from "@/lib/journal/experiment-queries";
import { summarizeExperiments } from "@/lib/journal/experiments";
import { PageHeader } from "@/components/app/page-header";
import type { RealizedTrade } from "@/lib/journal/analytics";
import { accountTimezoneResolver } from "@/lib/journal/time";

export default async function WeeklyPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; account?: string }>;
}) {
  const { week: weekParam, account: accountParam } = await searchParams;

  // One batch. The week on screen depends on the account's timezone, so the
  // review is chained onto the accounts instead of awaited after the batch,
  // which cost the page a round trip.
  const accountsPromise = getAccounts();
  const weekPromise = accountsPromise.then((accounts) => {
    const primary = primaryAccount(accounts);
    const timezone = primary?.timezone ?? DEFAULT_TZ;
    const today = todayInTz(timezone);
    const currentWeekStart = weekStartOfDayKey(today);

    /**
     * Any day key in the URL is snapped to its Monday rather than rejected.
     *
     * A link to a Wednesday is a link to that Wednesday's week, and the alternative
     * — bouncing to the default — loses the week the reader asked for. Snapping
     * also keeps the invariant the table's CHECK enforces: one row per week, keyed
     * on Monday, so the same week can never be written twice under two keys.
     */
    const requested =
      weekParam && isValidDayKey(weekParam) ? weekStartOfDayKey(weekParam) : "";
    // A week that has not happened is clamped to the running one, and the page
    // says so rather than quietly showing a different week than the link asked
    // for.
    const clamped = requested !== "" && requested > currentWeekStart;
    const weekStart =
      requested && !clamped ? requested : clamped ? currentWeekStart : defaultWeekStart(today);
    return { primary, timezone, currentWeekStart, weekStart, clamped };
  });

  const [
    accounts,
    { primary, timezone, currentWeekStart, weekStart, clamped },
    trades,
    checkins,
    reportDates,
    review,
    previousReview,
    experiments,
  ] = await Promise.all([
    accountsPromise,
    weekPromise,
    // NOT ranged, unlike the two below: the recap counts positions OPENED in an
    // earlier week, the R figures need the trade rows anyway, and this read is
    // memoized per request and shared with every other screen.
    getTradesWithStats(),
    weekPromise.then(({ weekStart }) =>
      getPositionCheckinsInRange(weekStart, weekEndOfWeekStart(weekStart)),
    ),
    weekPromise.then(({ weekStart }) =>
      getDailyReportDatesInRange(weekStart, weekEndOfWeekStart(weekStart)),
    ),
    weekPromise.then(({ weekStart }) => getWeeklyReview(weekStart)),
    // Last week's answers, for the commitment this week has to live up to.
    weekPromise.then(({ weekStart }) => getWeeklyReview(addWeeksToWeekStart(weekStart, -1))),
    getExperiments(),
  ]);

  /**
   * Which accounts the money covers — the same rule `/calendar` applies.
   *
   * Every account was summed and the total printed in the primary account's
   * currency: €500 and $300 as $800. "All accounts" stays the default while the
   * currencies agree; when they do not there is no honest pooled figure, so the
   * page falls back to the primary account and says why.
   */
  const pooledCurrency = sharedCurrency(accounts);
  const requestedAccount =
    accountParam && accounts.some((a) => a.id === accountParam) ? accountParam : "all";
  const mixedFallback =
    requestedAccount === "all" && accounts.length > 1 && pooledCurrency == null;
  const accountId = mixedFallback ? (primary?.id ?? "all") : requestedAccount;
  const scopedAccounts =
    accountId === "all" ? accounts : accounts.filter((a) => a.id === accountId);
  const currency = sharedCurrency(scopedAccounts) ?? primary?.currency ?? "USD";

  // Per-trade timezone, not the primary account's: a trade on a NY account and
  // one on a London account close on different calendar days, and one zone for
  // both would file the week's money under the wrong week at the boundary.
  const tzFor = accountTimezoneResolver(accounts, timezone);
  const tzOf = (t: RealizedTrade) => tzFor(t.row.account_id);

  // The same band the dashboard classifies with, so a week's win/loss split here
  // matches the one on every other screen. Mixed bands across accounts fall back
  // to exact zero rather than silently adopting one account's tolerance.
  const breakevenRange = sharedBreakevenRange(scopedAccounts);

  const realized = toRealized(
    accountId === "all" ? trades : trades.filter((t) => t.account_id === accountId),
  );

  const recap = buildWeekRecap(
    enrichTrades(realized, { tzOf, range: breakevenRange }),
    checkins,
    new Set(reportDates),
    weekStart,
    breakevenRange,
  );

  // The same band and the same bucketing `/calendar` uses, so a day cannot read
  // one number in the strip and another in the month grid.
  const days = weekDayRows(weekStart, realized, tzOf, breakevenRange);

  /**
   * The experiments, measured over the WHOLE book rather than this week's.
   *
   * An experiment compares four weeks of history against every week since it
   * started, so it needs the book — and `recap` above already enriches only
   * what the week needs. Two windows, computed here, and only the numbers
   * cross to the browser: the trades themselves would be the whole book sent
   * twice to render six figures.
   */
  const experimentSummaries = summarizeExperiments(
    experiments,
    enrichTrades(realized, { tzOf, range: breakevenRange }),
    // Net, like every other figure on this page.
    { pnlBasis: "net", range: breakevenRange },
    currentWeekStart,
  );

  /**
   * The oldest week worth opening: the one holding the first trade, or the
   * account's own first week when nothing has been traded yet. Without it the
   * back arrow paged into empty weeks forever.
   */
  const firstDay = realized.reduce<string | null>((oldest, t) => {
    const day = zonedDateKey(t.row.stats?.opened_at ?? t.closedAt, tzOf(t));
    return day && (oldest == null || day < oldest) ? day : oldest;
  }, null);
  const accountStart = accounts.reduce<string | null>((oldest, a) => {
    const day = zonedDateKey(a.created_at, a.timezone);
    return day && (oldest == null || day < oldest) ? day : oldest;
  }, null);
  const earliestWeekStart = weekStartOfDayKey(firstDay ?? accountStart ?? weekStart) || weekStart;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Nedeljni osvrt"
        description="Pitanja iza kojih stoji ishod. Postavljaju se kada se nedelja završi, a ne svako veče usred držanja pozicije."
      />

      <WeeklyReviewForm
        key={weekStart}
        review={review}
        previousReview={previousReview}
        weekStart={weekStart}
        currentWeekStart={currentWeekStart}
        earliestWeekStart={earliestWeekStart}
        clamped={clamped}
        recap={recap}
        days={days}
        currency={currency}
        timezone={timezone}
        accountId={accountId}
        accountOptions={accounts.length > 1 ? accountFilterOptions(accounts) : []}
        mixedFallback={mixedFallback}
      />

      {/* Below the review, not inside it: an experiment spans weeks, so it is
          not part of the row this week seals. A locked week still cannot start
          or finish one — that decision belongs to the week it is made in. */}
      <ExperimentCard
        weekStart={weekStart}
        summaries={experimentSummaries}
        oneChange={review?.one_change ?? null}
        disabled={review?.locked_at != null || weekStart > currentWeekStart}
      />
    </div>
  );
}
