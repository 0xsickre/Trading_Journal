import { Suspense } from "react";
import { getAccounts } from "@/lib/journal/accounts";
import { getCashEvents } from "@/lib/journal/cash-events";
import { getDailyReportsLite } from "@/lib/journal/daily-report-queries";
import { getPositionCheckins } from "@/lib/journal/position-checkin-queries";
import { getWeekGrades } from "@/lib/journal/weekly-review-queries";
import { getFillCounts, getTradesWithStats } from "@/lib/journal/trades";
import { getFieldDefs } from "@/lib/journal/field-defs";
import { getOptionsMap } from "@/lib/journal/options";
import { getPlaybooks, getPositionRules } from "@/lib/journal/playbooks";
import { ReportsWorkbench } from "@/components/journal/reports/reports-workbench";
import type { TradeRow } from "@/lib/journal/types";
import { PageHeader } from "@/components/app/page-header";
import { ReportsSkeleton } from "@/components/journal/reports/reports-skeleton";

export default async function ReportsPage() {
  // `tj_position_rules` is drained ONCE, and the per-rule counts are derived
  // from the result inside `getPlaybooks`. Both reads used to sit in this
  // Promise.all, draining the same table — one row per rule per trade, the
  // fastest-growing in the schema — twice on every render of the route. It is
  // handed to `getPlaybooks` as a PROMISE, so the single drain no longer costs a
  // round trip of its own before everything else starts.
  const positionRulesPromise = getPositionRules();

  const [
    trades,
    accounts,
    dailyReports,
    fillCounts,
    cashEvents,
    fieldDefs,
    playbooks,
    optionsMap,
    positionCheckins,
    weekGrades,
    positionRules,
  ] = await Promise.all([
    getTradesWithStats(),
    getAccounts(),
    getDailyReportsLite(),
    getFillCounts(),
    getCashEvents(),
    // All defs: reports read history, and a retired field's trades still
    // carry its values.
    getFieldDefs(false),
    // Retired rules included for the same reason — their recorded answers are
    // real observations, and dropping them would move numbers for trades logged
    // long before the rule was retired.
    getPlaybooks({ includeDeleted: true, positionRules: positionRulesPromise }),
    // Inactive options included, for the third time and the same reason: an
    // emotion the trader has since retired is still the emotion those trades
    // were tagged with, and dropping it would move a tag from the Emocija
    // dimension into nothing at all.
    getOptionsMap(false),
    // Every check-in, not just a window: they feed the `touched` and
    // `thesis_state` dimensions, which group CLOSED trades by what was recorded
    // while they were open. A date-bounded read would drop the answers given
    // during a hold that started before the window.
    getPositionCheckins(),
    // Only the grade per week. The review's prose is written to be read, not
    // grouped on, and shipping five paragraphs a week to the browser to render
    // one letter would be paying for the whole review to draw a bucket label.
    getWeekGrades(),
    positionRulesPromise,
  ]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Reports"
        description="How each group of your trades did — by setup, instrument, day or any tag."
      />

      {/* useSearchParams needs a Suspense boundary to keep the route from
          opting the whole page out of static rendering. */}
      <Suspense fallback={<ReportsSkeleton />}>
        <ReportsWorkbench
          trades={trades as TradeRow[]}
          accounts={accounts}
          dailyReports={dailyReports}
          positionCheckins={positionCheckins}
          weekGrades={weekGrades}
          fillCounts={fillCounts}
          cashEvents={cashEvents}
          fieldDefs={fieldDefs}
          playbooks={playbooks}
          positionRules={positionRules}
          optionsMap={optionsMap}
        />
      </Suspense>
    </div>
  );
}
