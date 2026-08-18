import { getTradesWithStats, getFillCounts } from "@/lib/journal/trades";
import { getAccounts } from "@/lib/journal/accounts";
import { getCashEvents } from "@/lib/journal/cash-events";
import { getDailyReportDates, getDailyReportsLite } from "@/lib/journal/daily-report-queries";
import { ensureDefaults } from "@/lib/journal/ensure-defaults";
import { getFieldDefs } from "@/lib/journal/field-defs";
import { getTrackerRules, getCheckins } from "@/lib/journal/tracker/queries";
import { getPositionCheckins } from "@/lib/journal/position-checkin-queries";
import { getPlaybooks, getPositionRules } from "@/lib/journal/playbooks";
import { getUserPrefs } from "@/lib/journal/user-prefs";
import { todayInTz } from "@/lib/journal/daily-report";
import { addDaysToDayKey, DEFAULT_TZ } from "@/lib/journal/time";
import { Dashboard } from "@/components/journal/dashboard";
import type { TradeRow } from "@/lib/journal/types";
import { PageHeader } from "@/components/app/page-header";

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
  // `tj_position_rules` is drained ONCE, and the per-rule counts are derived
  // from the result inside `getPlaybooks`. Both reads used to sit in this
  // Promise.all, draining the same table — one row per rule per trade, the
  // fastest-growing in the schema — twice on every render of the route. One
  // extra await costs a round trip; the second drain cost the whole table.
  const positionRules = await getPositionRules();

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
    positionCheckins,
    userPrefs,
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
    getPlaybooks({ includeDeleted: true, positionRules }),
    // Unbounded, unlike the tracker check-ins below: those fill a 28-week
    // heatmap, while these are joined to trades by position id and a trade in
    // range can carry answers given outside it.
    getPositionCheckins(),
    // Which dashboard sections this user has switched off. A missing row is the
    // normal state and answers "none", so a brand-new account gets the whole
    // page rather than an empty one.
    getUserPrefs(),
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
      <PageHeader
        title="Dashboard"
        description="Your edge at a glance — filter by account, period and any tag."
      />

      <Dashboard
        trades={trades as TradeRow[]}
        accounts={accounts}
        cashEvents={cashEvents}
        loggedDates={loggedDates}
        dailyReports={dailyReports}
        positionCheckins={positionCheckins}
        fillCounts={fillCounts}
        fieldDefs={fieldDefs}
        trackerRules={trackerRules}
        checkins={checkins}
        todayKey={todayKey}
        timezone={primary?.timezone ?? DEFAULT_TZ}
        playbooks={playbooks}
        positionRules={positionRules}
        dashboardHiddenWidgets={userPrefs.dashboardHiddenWidgets}
        dashboardWidgetOrder={userPrefs.dashboardWidgetOrder}
      />
    </div>
  );
}
