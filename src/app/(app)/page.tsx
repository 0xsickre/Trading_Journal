import Link from "next/link";
import { PlusCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getTradesWithStats, getFillCounts } from "@/lib/journal/trades";
import { getAccounts } from "@/lib/journal/accounts";
import { getCashEvents } from "@/lib/journal/cash-events";
import { getDailyReportDates, getDailyReportsLite } from "@/lib/journal/daily-report-queries";
import { ensureDefaults } from "@/lib/journal/ensure-defaults";
import { getFieldDefs } from "@/lib/journal/field-defs";
import { getTrackerRules, getCheckins } from "@/lib/journal/tracker/queries";
import { getPlaybooks, getPositionRules } from "@/lib/journal/playbooks";
import { todayInTz } from "@/lib/journal/daily-report";
import { addDaysToDayKey, DEFAULT_TZ } from "@/lib/journal/time";
import { Dashboard } from "@/components/journal/dashboard";
import type { TradeRow } from "@/lib/journal/types";

/**
 * How far back the compliance calendar and the streak look.
 *
 * 26 weeks is what the heatmap draws; two extra weeks of slack keep the leading
 * partial column populated once the grid pads out to a full week.
 */
const TRACKER_WEEKS = 28;

export default async function DashboardPage() {
  // Fallback seed for legacy users / missed signup trigger — runs on the landing
  // page only (must finish before we read accounts on a brand-new user).
  await ensureDefaults();
  const [
    trades,
    accounts,
    cashEvents,
    loggedDates,
    dailyReports,
    fillCounts,
    fieldDefs,
    trackerRules,
    playbooks,
    positionRules,
  ] = await Promise.all([
    getTradesWithStats(),
    getAccounts(),
    getCashEvents(),
    getDailyReportDates(),
    getDailyReportsLite(),
    getFillCounts(),
    // All defs: the dashboard reads history, where a retired field still counts.
    getFieldDefs(false),
    // Retired rules included: a rule that was live on a past day still applied to
    // it, and dropping it would raise every one of those days' scores.
    getTrackerRules({ includeRetired: true }),
    // Follow rate is 40 % of process adherence, and a retired rule's answers are
    // real observations — same reason the reports screen loads them all.
    getPlaybooks({ includeDeleted: true }),
    getPositionRules(),
  ]);

  // The account's day, not the browser's — every day key in the tracker is in
  // account time, and the heatmap grid is anchored to this.
  const primary = accounts.find((a) => a.is_active) ?? accounts[0] ?? null;
  const todayKey = todayInTz(primary?.timezone ?? DEFAULT_TZ);

  const checkinsByDay = await getCheckins(
    addDaysToDayKey(todayKey, -(TRACKER_WEEKS * 7 - 1)),
    todayKey,
  );
  // Flattened for the client boundary: a flat array is smaller on the wire than
  // a nested Map and the dashboard rebuilds the index it wants anyway.
  const checkins = [...checkinsByDay.values()].flatMap((day) => [...day.values()]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="text-muted-foreground">
            Your edge at a glance — filter by account, period and any tag.
          </p>
        </div>
        <Button asChild>
          <Link href="/trades/new">
            <PlusCircle className="size-4" /> New Trade
          </Link>
        </Button>
      </div>

      <Dashboard
        trades={trades as TradeRow[]}
        accounts={accounts}
        cashEvents={cashEvents}
        loggedDates={loggedDates}
        dailyReports={dailyReports}
        fillCounts={fillCounts}
        fieldDefs={fieldDefs}
        trackerRules={trackerRules}
        checkins={checkins}
        todayKey={todayKey}
        playbooks={playbooks}
        positionRules={positionRules}
      />
    </div>
  );
}
