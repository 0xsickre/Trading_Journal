import Link from "next/link";
import { PlusCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getTradesWithStats, getFillCounts } from "@/lib/journal/trades";
import { getAccounts } from "@/lib/journal/accounts";
import { getCashEvents } from "@/lib/journal/cash-events";
import { getDailyReportDates, getDailyReportsLite } from "@/lib/journal/daily-report-queries";
import { ensureDefaults } from "@/lib/journal/ensure-defaults";
import { Dashboard } from "@/components/journal/dashboard";
import type { TradeRow } from "@/lib/journal/types";

export default async function DashboardPage() {
  // Fallback seed for legacy users / missed signup trigger — runs on the landing
  // page only (must finish before we read accounts on a brand-new user).
  await ensureDefaults();
  const [trades, accounts, cashEvents, loggedDates, dailyReports, fillCounts] =
    await Promise.all([
      getTradesWithStats(),
      getAccounts(),
      getCashEvents(),
      getDailyReportDates(),
      getDailyReportsLite(),
      getFillCounts(),
    ]);

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
      />
    </div>
  );
}
