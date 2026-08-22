import { getTradesWithStats, getFillCounts } from "@/lib/journal/trades";
import { getAccounts } from "@/lib/journal/accounts";
import { getCashEvents } from "@/lib/journal/cash-events";
import { getDailyReportDates, getDailyReportsLite } from "@/lib/journal/daily-report-queries";
import { ensureDefaults } from "@/lib/journal/ensure-defaults";
import { getFieldDefs } from "@/lib/journal/field-defs";
import { getTrackerRules, getCheckins } from "@/lib/journal/tracker/queries";
import { TRACKER_SPAN_DAYS } from "@/lib/journal/tracker/compliance";
import { getPositionCheckins } from "@/lib/journal/position-checkin-queries";
import { getPlaybooks, getPositionRules } from "@/lib/journal/playbooks";
import { getUserPrefs } from "@/lib/journal/user-prefs";
import { getDashboardTemplates } from "@/lib/journal/dashboard-template-queries";
import { todayInTz } from "@/lib/journal/daily-report";
import { addDaysToDayKey, DEFAULT_TZ } from "@/lib/journal/time";
import { Dashboard } from "@/components/journal/dashboard";
import type { TradeRow } from "@/lib/journal/types";
import { PageHeader } from "@/components/app/page-header";

export default async function DashboardPage() {
  // ONE round trip before the rest, and only because the day key depends on it.
  // `getCheckins` needs the account's timezone to know which 182 days to ask
  // for, so accounts genuinely has to land first. Everything else below waits
  // on nothing and goes in one parallel batch.
  const accounts = await getAccounts();

  // The account's day, not the browser's — every day key in the tracker is in
  // account time, and the heatmap grid is anchored to this.
  const primary = accounts.find((a) => a.is_active) ?? accounts[0] ?? null;
  const todayKey = todayInTz(primary?.timezone ?? DEFAULT_TZ);

  // `tj_position_rules` is drained ONCE, and the per-rule counts are derived
  // from the result inside `getPlaybooks`. Both reads used to sit in this
  // Promise.all, draining the same table — one row per rule per trade, the
  // fastest-growing in the schema — twice on every render of the route.
  //
  // It used to be awaited alone, ahead of everything, to keep that single
  // drain. It still is a single drain: `getPlaybooks` is simply given the
  // promise instead of the resolved array, so it can start its own reads
  // immediately and await the rules only where it needs them. The round trip
  // that separate await cost is gone.
  const positionRulesPromise = getPositionRules();

  const [
    trades,
    cashEvents,
    loggedDates,
    dailyReports,
    fillCounts,
    fieldDefs,
    trackerRules,
    playbooks,
    positionCheckins,
    userPrefs,
    dashboardTemplates,
    checkinsByDay,
    positionRules,
  ] = await Promise.all([
    getTradesWithStats(),
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
    getPlaybooks({ includeDeleted: true, positionRules: positionRulesPromise }),
    // Unbounded, unlike the tracker check-ins below: those fill a 28-week
    // heatmap, while these are joined to trades by position id and a trade in
    // range can carry answers given outside it.
    getPositionCheckins(),
    // Which dashboard sections this user has switched off. A missing row is the
    // normal state and answers "none", so a brand-new account gets the whole
    // page rather than an empty one.
    getUserPrefs(),
    // The saved arrangements themselves. Small, per user, and scoped by RLS.
    getDashboardTemplates(),
    getCheckins(addDaysToDayKey(todayKey, -(TRACKER_SPAN_DAYS - 1)), todayKey),
    positionRulesPromise,
  ]);

  // Fallback seed for legacy users / a missed signup trigger. It used to be the
  // first `await` on this page, which made every dashboard render pay a round
  // trip for a no-op RPC — the seeding it covers has been done for months for
  // anyone whose accounts exist. An empty `accounts` is the only state that can
  // still need it, and it is exactly the state a brand-new user arrives in.
  if (accounts.length === 0) await ensureDefaults();

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
        dashboardTemplateId={userPrefs.dashboardTemplateId}
        dashboardTemplates={dashboardTemplates}
      />
    </div>
  );
}
