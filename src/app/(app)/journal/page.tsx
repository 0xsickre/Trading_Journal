import { getTradesWithStats } from "@/lib/journal/trades";
import { getAccounts } from "@/lib/journal/accounts";
import { getFieldDefs } from "@/lib/journal/field-defs";
import { getUserPrefs } from "@/lib/journal/user-prefs";
import { getOptionsMap } from "@/lib/journal/options";
import { JournalGrid } from "@/components/journal/journal-grid";
import type { TradeRow } from "@/lib/journal/types";
import { PageHeader } from "@/components/app/page-header";

export default async function JournalPage() {
  const [trades, accounts, fieldDefs, prefs, optionsMap] = await Promise.all([
    getTradesWithStats(),
    getAccounts(),
    // All defs: the grid READS history, and a retired field's values are still
    // on the trades that recorded them.
    getFieldDefs(false),
    getUserPrefs(),
    // Powers the bulk "Add tag" picker — same option-list source the
    // per-trade form uses, so a bulk-applied value is never one the form
    // wouldn't also offer.
    getOptionsMap(),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Journal"
        description="Every logged trade. Filter by any tag — archived options stay filterable."
      />

      <JournalGrid
        trades={trades as TradeRow[]}
        accounts={accounts}
        fieldDefs={fieldDefs}
        hiddenColumns={prefs.journalHiddenColumns}
        optionsMap={optionsMap}
      />
    </div>
  );
}
