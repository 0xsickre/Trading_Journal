import { getAccounts } from "@/lib/journal/accounts";
import { getTradesWithStats } from "@/lib/journal/trades";
import { getDailyReportDates } from "@/lib/journal/daily-report-queries";
import { toRealized, type RealizedTrade } from "@/lib/journal/analytics";
import { bucketByPeriod, type PeriodRow } from "@/lib/journal/period-stats";
import {
  EXACT_ZERO_RANGE,
  resolveBreakevenRange,
} from "@/lib/journal/breakeven";
import { todayInTz } from "@/lib/journal/daily-report";
import { DEFAULT_TZ } from "@/lib/journal/time";
import { MonthCalendar } from "@/components/journal/month-calendar";

const MONTH_RE = /^\d{4}-\d{2}$/;

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
    monthParam && MONTH_RE.test(monthParam)
      ? monthParam > currentMonth
        ? currentMonth
        : monthParam
      : currentMonth;

  // Per-trade timezone, not the primary account's: a trade on a NY account and
  // one on a London account close on different calendar days, and one zone for
  // both would file them under the wrong cells.
  const tzOf = (t: RealizedTrade) =>
    accounts.find((a) => a.id === t.row.account_id)?.timezone ??
    primary?.timezone ??
    DEFAULT_TZ;

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
  const ranges = accounts.map((a) => resolveBreakevenRange(a));
  const breakevenRange =
    ranges.length > 0 &&
    ranges.every((r) => r.from === ranges[0].from && r.to === ranges[0].to)
      ? ranges[0]
      : EXACT_ZERO_RANGE;

  const realized = toRealized(trades);

  // One bucketing function, three granularities — cells, week column and header
  // can never disagree about which day a Friday-night close belongs to.
  const byDay = indexBy(bucketByPeriod(realized, "day", tzOf, breakevenRange));
  const byWeek = indexBy(bucketByPeriod(realized, "week", tzOf, breakevenRange));
  const byMonth = indexBy(bucketByPeriod(realized, "month", tzOf, breakevenRange));

  return (
    <div className="space-y-5">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold">Kalendar</h1>
        <p className="text-muted-foreground">
          Mesec po danima, sa zbirom svake nedelje sa strane. P&amp;L se pripisuje
          danu <b>zatvaranja</b> — swing otvoren u ponedeljak a zatvoren u petak
          stoji u petku, jer je tad novac stigao.
        </p>
      </div>

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
