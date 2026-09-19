import { getAccounts } from "@/lib/journal/accounts";
import { getDailyReportDates } from "@/lib/journal/daily-report-queries";
import { todayInTz } from "@/lib/journal/daily-report";
import { getPositionCheckins } from "@/lib/journal/position-checkin-queries";
import { getTradesWithStats } from "@/lib/journal/trades";
import { getWeeklyReview } from "@/lib/journal/weekly-review-queries";
import { toRealized } from "@/lib/journal/analytics";
import { enrichTrades } from "@/lib/journal/enriched-trade";
import { buildWeekRecap, weekDayRows } from "@/lib/journal/week-recap";
import {
  sharedBreakevenRange,
} from "@/lib/journal/breakeven";
import { DEFAULT_TZ, isValidDayKey } from "@/lib/journal/time";
import {
  defaultWeekStart,
  weekStartOfDayKey,
} from "@/lib/journal/weekly-review";
import { WeeklyReviewForm } from "@/components/journal/weekly-review-form";
import { PageHeader } from "@/components/app/page-header";
import type { RealizedTrade } from "@/lib/journal/analytics";
import { accountTimezoneResolver } from "@/lib/journal/time";

export default async function WeeklyPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const { week: weekParam } = await searchParams;

  // One batch. The week on screen depends on the account's timezone, so the
  // review is chained onto the accounts instead of awaited after the batch,
  // which cost the page a round trip.
  const accountsPromise = getAccounts();
  const weekPromise = accountsPromise.then((accounts) => {
    const primary = accounts.find((a) => a.is_active) ?? accounts[0] ?? null;
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
    const weekStart =
      requested && requested <= currentWeekStart
        ? requested
        : requested > currentWeekStart
          ? currentWeekStart
          : defaultWeekStart(today);
    return { primary, timezone, currentWeekStart, weekStart };
  });

  const [
    accounts,
    { primary, timezone, currentWeekStart, weekStart },
    trades,
    checkins,
    reportDates,
    review,
  ] = await Promise.all([
    accountsPromise,
    weekPromise,
    getTradesWithStats(),
    getPositionCheckins(),
    getDailyReportDates(),
    weekPromise.then(({ weekStart }) => getWeeklyReview(weekStart)),
  ]);
  const currency = primary?.currency ?? "USD";

  // Per-trade timezone, not the primary account's: a trade on a NY account and
  // one on a London account close on different calendar days, and one zone for
  // both would file the week's money under the wrong week at the boundary.
  const tzFor = accountTimezoneResolver(accounts, timezone);
  const tzOf = (t: RealizedTrade) => tzFor(t.row.account_id);

  // The same band the dashboard classifies with, so a week's win/loss split here
  // matches the one on every other screen. Mixed bands across accounts fall back
  // to exact zero rather than silently adopting one account's tolerance.
  const breakevenRange = sharedBreakevenRange(accounts);

  const realized = toRealized(trades);

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

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Nedeljni osvrt"
        description="Pitanja iza kojih stoji ishod. Postavljaju se kada se nedelja završi, a ne svako veče usred držanja pozicije."
      />

      <WeeklyReviewForm
        key={weekStart}
        review={review}
        weekStart={weekStart}
        currentWeekStart={currentWeekStart}
        recap={recap}
        days={days}
        currency={currency}
      />
    </div>
  );
}
