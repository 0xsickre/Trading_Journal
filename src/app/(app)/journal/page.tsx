import Link from "next/link";
import { PlusCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getTradesWithStats } from "@/lib/journal/trades";
import { getAccounts } from "@/lib/journal/accounts";
import { getFieldDefs } from "@/lib/journal/field-defs";
import { getUserPrefs } from "@/lib/journal/user-prefs";
import { JournalGrid } from "@/components/journal/journal-grid";
import type { TradeRow } from "@/lib/journal/types";

export default async function JournalPage() {
  const [trades, accounts, fieldDefs, prefs] = await Promise.all([
    getTradesWithStats(),
    getAccounts(),
    // All defs: the grid READS history, and a retired field's values are still
    // on the trades that recorded them.
    getFieldDefs(false),
    getUserPrefs(),
  ]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">Journal</h1>
          <p className="text-muted-foreground">
            Every logged trade. Filter by any tag — archived options stay
            filterable.
          </p>
        </div>
        <Button asChild>
          <Link href="/trades/new">
            <PlusCircle className="size-4" /> New Trade
          </Link>
        </Button>
      </div>

      <JournalGrid
        trades={trades as TradeRow[]}
        accounts={accounts}
        fieldDefs={fieldDefs}
        hiddenColumns={prefs.journalHiddenColumns}
      />
    </div>
  );
}
