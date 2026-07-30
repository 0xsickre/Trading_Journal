import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { format, parseISO } from "date-fns";
import { sr } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { getAccounts } from "@/lib/journal/accounts";
import { getTradesWithStats } from "@/lib/journal/trades";
import {
  nextReportDate,
  prevReportDate,
  todayInTz,
} from "@/lib/journal/daily-report";
import { getDailyReport } from "@/lib/journal/daily-report-queries";
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
import { TrackerChecklist } from "@/components/journal/tracker-checklist";
import { DEFAULT_TZ } from "@/lib/journal/time";
import type { TradeRow } from "@/lib/journal/types";

export default async function TrackerPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const { date: dateParam } = await searchParams;

  const [accounts, rules, trades] = await Promise.all([
    getAccounts(),
    // Retired rules included: this page can look at any past day, and a rule that
    // was live on that day still applied to it. `ruleIsLiveOn` does the filtering
    // per day — which is the whole reason it takes the day as an argument.
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

  const [checkins, report] = await Promise.all([
    getCheckinsForDay(reportDate),
    getDailyReport(reportDate),
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
  const compliance = computeDayCompliance(
    reportDate,
    dayRules,
    checkins,
    auto,
    today,
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

  const isToday = reportDate === today;
  const atToday = reportDate >= today;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Tracker</h1>
        <p className="text-muted-foreground">
          Proces, ne rezultat. Ovde se meri jedino ono nad čim imaš punu
          kontrolu — da li si odradio rutinu, bez obzira na to kako je dan
          završio.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon" className="size-8" asChild>
          <Link href={`/tracker?date=${prevReportDate(reportDate)}`}>
            <ChevronLeft className="size-4" />
          </Link>
        </Button>
        <div className="min-w-[10rem] text-center">
          <p className="text-lg font-semibold">
            {format(parseISO(reportDate), "EEE, d. MMM yyyy.", { locale: sr })}
          </p>
          {!isToday && <p className="text-xs text-muted-foreground">{timezone}</p>}
        </div>
        <Button
          variant="outline"
          size="icon"
          className="size-8"
          asChild
          disabled={atToday}
        >
          <Link
            href={
              atToday
                ? `/tracker?date=${reportDate}`
                : `/tracker?date=${nextReportDate(reportDate)}`
            }
            aria-disabled={atToday}
          >
            <ChevronRight className="size-4" />
          </Link>
        </Button>
        {!isToday && (
          <Button variant="ghost" size="sm" asChild>
            <Link href="/tracker">Danas</Link>
          </Button>
        )}
        <Button variant="ghost" size="sm" className="ml-auto" asChild>
          <Link href={`/daily?date=${reportDate}`}>Dnevni izveštaj</Link>
        </Button>
      </div>

      <TrackerChecklist
        reportDate={reportDate}
        rules={dayRules}
        auto={auto}
        answers={answers}
        compliance={compliance}
        currency={currency}
        tradeLabels={tradeLabels}
        locked={report?.locked_at != null}
      />
    </div>
  );
}
