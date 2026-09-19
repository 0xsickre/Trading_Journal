import { getTradesWithStats } from "@/lib/journal/trades";
import { getAccounts } from "@/lib/journal/accounts";
import { getFieldDefs } from "@/lib/journal/field-defs";
import { getUserPrefs } from "@/lib/journal/user-prefs";
import { getOptionsMap } from "@/lib/journal/options";
import { getPlaybooks, getPositionRules } from "@/lib/journal/playbooks";
import { JournalGrid } from "@/components/journal/journal-grid";
import type { TradeRow } from "@/lib/journal/types";
import { PageHeader } from "@/components/app/page-header";

export default async function JournalPage() {
  // `getPlaybooks` needs the answers to report per-rule statistics, and the grid
  // needs both to derive the setup grade. It is handed the PROMISE, as on the
  // dashboard, so the table is still drained once and nothing waits for it
  // before starting — awaiting it alone first cost a round trip.
  const positionRulesPromise = getPositionRules();

  const [trades, accounts, fieldDefs, prefs, optionsMap, playbooks, positionRules] = await Promise.all([
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
    // Retired rules included: the grid READS history, and a trade graded under
    // a rule since withdrawn still earned that grade.
    getPlaybooks({ includeDeleted: true, positionRules: positionRulesPromise }),
    positionRulesPromise,
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Trades"
        description="Every trade and plan you have logged — filter, review, and open one to edit it."
      />

      <JournalGrid
        trades={trades as TradeRow[]}
        accounts={accounts}
        fieldDefs={fieldDefs}
        hiddenColumns={prefs.journalHiddenColumns}
        optionsMap={optionsMap}
        playbooks={playbooks}
        positionRules={positionRules}
      />
    </div>
  );
}
