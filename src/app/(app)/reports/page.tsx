import { Suspense } from "react";
import { getAccounts } from "@/lib/journal/accounts";
import { getCashEvents } from "@/lib/journal/cash-events";
import { getDailyReportsLite } from "@/lib/journal/daily-report-queries";
import { getFillCounts, getTradesWithStats } from "@/lib/journal/trades";
import { ReportsWorkbench } from "@/components/journal/reports/reports-workbench";
import type { TradeRow } from "@/lib/journal/types";

export default async function ReportsPage() {
  const [trades, accounts, dailyReports, fillCounts, cashEvents] =
    await Promise.all([
      getTradesWithStats(),
      getAccounts(),
      getDailyReportsLite(),
      getFillCounts(),
      getCashEvents(),
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
        />
      </Suspense>
    </div>
  );
}
