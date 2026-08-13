import Link from "next/link";
import { PlusCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getTradesWithStats } from "@/lib/journal/trades";
import { getAccounts } from "@/lib/journal/accounts";
import { getFieldDefs } from "@/lib/journal/field-defs";
import { getUserPrefs } from "@/lib/journal/user-prefs";
import { JournalGrid } from "@/components/journal/journal-grid";
import type { TradeRow } from "@/lib/journal/types";
import { PageHeader } from "@/components/app/page-header";

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
      <PageHeader
        title="Journal"
        description="Every logged trade. Filter by any tag — archived options stay filterable."
        action={
          <Button asChild>
            <Link href="/trades/new">
              <PlusCircle className="size-4" /> New Trade
            </Link>
          </Button>
        }
      />

      <JournalGrid
        trades={trades as TradeRow[]}
        accounts={accounts}
        fieldDefs={fieldDefs}
        hiddenColumns={prefs.journalHiddenColumns}
      />
    </div>
  );
}
