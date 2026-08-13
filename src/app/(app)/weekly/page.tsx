import { getAccounts } from "@/lib/journal/accounts";
import { getDailyReportDates } from "@/lib/journal/daily-report-queries";
import { todayInTz } from "@/lib/journal/daily-report";
import { getPositionCheckins } from "@/lib/journal/position-checkin-queries";
import { getTradesWithStats } from "@/lib/journal/trades";
import { getWeeklyReview } from "@/lib/journal/weekly-review-queries";
import { toRealized } from "@/lib/journal/analytics";
import { enrichTrades } from "@/lib/journal/enriched-trade";
import { buildWeekRecap } from "@/lib/journal/week-recap";
import {
  EXACT_ZERO_RANGE,
  resolveBreakevenRange,
} from "@/lib/journal/breakeven";
import { DEFAULT_TZ, isValidDayKey } from "@/lib/journal/time";
import {
  defaultWeekStart,
  weekStartOfDayKey,
} from "@/lib/journal/weekly-review";
import { WeeklyReviewForm } from "@/components/journal/weekly-review-form";
import { PageHeader } from "@/components/app/page-header";
import type { RealizedTrade } from "@/lib/journal/analytics";

export default async function WeeklyPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const { week: weekParam } = await searchParams;

  const [accounts, trades, checkins, reportDates] = await Promise.all([
    getAccounts(),
    getTradesWithStats(),
    getPositionCheckins(),
    getDailyReportDates(),
  ]);

  const primary = accounts.find((a) => a.is_active) ?? accounts[0] ?? null;
  const timezone = primary?.timezone ?? DEFAULT_TZ;
  const currency = primary?.currency ?? "USD";
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

  const review = await getWeeklyReview(weekStart);

  // Per-trade timezone, not the primary account's: a trade on a NY account and
  // one on a London account close on different calendar days, and one zone for
  // both would file the week's money under the wrong week at the boundary.
  const tzOf = (t: RealizedTrade) =>
    accounts.find((a) => a.id === t.row.account_id)?.timezone ?? timezone;

  // The same band the dashboard classifies with, so a week's win/loss split here
  // matches the one on every other screen. Mixed bands across accounts fall back
  // to exact zero rather than silently adopting one account's tolerance.
  const ranges = accounts.map((a) => resolveBreakevenRange(a));
  const breakevenRange =
    ranges.length > 0 &&
    ranges.every((r) => r.from === ranges[0].from && r.to === ranges[0].to)
      ? ranges[0]
      : EXACT_ZERO_RANGE;

  const recap = buildWeekRecap(
    enrichTrades(toRealized(trades), { tzOf, range: breakevenRange }),
    checkins,
    new Set(reportDates),
    weekStart,
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Weekly Review"
        description="The questions that need an outcome behind them. Asked once the week is over, not every evening mid-hold."
      />

      <WeeklyReviewForm
        key={weekStart}
        review={review}
        weekStart={weekStart}
        currentWeekStart={currentWeekStart}
        recap={recap}
        currency={currency}
      />
    </div>
  );
}
