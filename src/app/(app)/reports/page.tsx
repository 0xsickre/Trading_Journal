import { Suspense } from "react";
import { getAccounts } from "@/lib/journal/accounts";
import { getCashEvents } from "@/lib/journal/cash-events";
import { getDailyReportsLite } from "@/lib/journal/daily-report-queries";
import { getFillCounts, getTradesWithStats } from "@/lib/journal/trades";
import { getFieldDefs } from "@/lib/journal/field-defs";
import { getPlaybooks, getPositionRules } from "@/lib/journal/playbooks";
import { ReportsWorkbench } from "@/components/journal/reports/reports-workbench";
import type { TradeRow } from "@/lib/journal/types";

export default async function ReportsPage() {
  const [
    trades,
    accounts,
    dailyReports,
    fillCounts,
    cashEvents,
    fieldDefs,
    playbooks,
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
    getPlaybooks({ includeDeleted: true }),
    getPositionRules(),
  ]);

  return (
    <div className="space-y-5">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold">Reports</h1>
        <p className="text-muted-foreground">
          Grupiši po bilo čemu, ukrsti sa bilo čim. Uz svaki broj stoji uzorak
          na kome počiva.
        </p>
      </div>

      {/* useSearchParams needs a Suspense boundary to keep the route from
          opting the whole page out of static rendering. */}
      <Suspense fallback={null}>
        <ReportsWorkbench
          trades={trades as TradeRow[]}
          accounts={accounts}
          dailyReports={dailyReports}
          fillCounts={fillCounts}
          cashEvents={cashEvents}
          fieldDefs={fieldDefs}
          playbooks={playbooks}
          positionRules={positionRules}
        />
      </Suspense>
    </div>
  );
}
