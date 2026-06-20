import Link from "next/link";
import { PlusCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getTradesWithStats } from "@/lib/journal/trades";
import { getAccounts } from "@/lib/journal/accounts";
import { Dashboard } from "@/components/journal/dashboard";
import type { TradeRow } from "@/lib/journal/types";

export default async function DashboardPage() {
  const [trades, accounts] = await Promise.all([
    getTradesWithStats(),
    getAccounts(),
  ]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
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

      <Dashboard trades={trades as TradeRow[]} accounts={accounts} />
    </div>
  );
}
