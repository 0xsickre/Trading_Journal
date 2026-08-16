import { getAccounts } from "@/lib/journal/accounts";
import { getTradesWithStats } from "@/lib/journal/trades";
import { getDailyReportDates } from "@/lib/journal/daily-report-queries";
import { toRealized, type RealizedTrade } from "@/lib/journal/analytics";
import { bucketByPeriod, type PeriodRow } from "@/lib/journal/period-stats";
import {
  sharedBreakevenRange,
} from "@/lib/journal/breakeven";
import { todayInTz } from "@/lib/journal/daily-report";
import { DEFAULT_TZ, isValidMonthKey } from "@/lib/journal/time";
import { MonthCalendar } from "@/components/journal/month-calendar";
import { PageHeader } from "@/components/app/page-header";
import { accountTimezoneResolver } from "@/lib/journal/time";


function indexBy(rows: PeriodRow[]): Map<string, PeriodRow> {
  return new Map(rows.map((r) => [r.key, r]));
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month: monthParam } = await searchParams;

  const [accounts, trades, loggedDates] = await Promise.all([
    getAccounts(),
    getTradesWithStats(),
    getDailyReportDates(),
  ]);

  const primary = accounts.find((a) => a.is_active) ?? accounts[0] ?? null;
  const todayKey = todayInTz(primary?.timezone ?? DEFAULT_TZ);
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
  // both would file them under the wrong cells.
  const tzFor = accountTimezoneResolver(accounts, primary?.timezone);
  const tzOf = (t: RealizedTrade) => tzFor(t.row.account_id);

  // Mixed currencies have no common unit; the dashboard makes the same call.
  const currencies = new Set(accounts.map((a) => a.currency));
  const currency = currencies.size === 1 ? [...currencies][0] : "USD";

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
  const breakevenRange = sharedBreakevenRange(accounts);

  const realized = toRealized(trades);

  // One bucketing function, three granularities — cells, week column and header
  // can never disagree about which day a Friday-night close belongs to.
  const byDay = indexBy(bucketByPeriod(realized, "day", tzOf, breakevenRange));
  const byWeek = indexBy(bucketByPeriod(realized, "week", tzOf, breakevenRange));
  const byMonth = indexBy(bucketByPeriod(realized, "month", tzOf, breakevenRange));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Calendar"
        description={
          <>
            The month by day, with each week&apos;s total alongside. P&amp;L is
            attributed to the day it <b>closed</b> — a swing opened Monday and
            closed Friday sits on Friday, because that is when the money arrived.
          </>
        }
      />

      <MonthCalendar
        monthKey={monthKey}
        currentMonth={currentMonth}
        todayKey={todayKey}
        byDay={byDay}
        byWeek={byWeek}
        byMonth={byMonth.get(monthKey) ?? null}
        loggedDays={new Set(loggedDates)}
        breakevenRange={breakevenRange}
        currency={currency}
      />
    </div>
  );
}
