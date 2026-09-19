import { getTradesWithStats } from "@/lib/journal/trades";
import { getAccounts } from "@/lib/journal/accounts";
import { getFieldDefs } from "@/lib/journal/field-defs";
import { getUserPrefs } from "@/lib/journal/user-prefs";
import { getOptionsMap } from "@/lib/journal/options";
import { getPlaybooks, getPositionRules } from "@/lib/journal/playbooks";
import { JournalGrid } from "@/components/journal/journal-grid";
import type { TradeRow } from "@/lib/journal/types";
import { PageHeader } from "@/components/app/page-header";

/**
 * Server actions on this page may fill MAE/MFE from Dukascopy after they answer
 * (`fillExcursionsFromFeed`, run through `after`). That work lives inside this
 * route's time limit, and the platform default of 10 s is short for a week of
 * candle files; 60 s is the Hobby plan's ceiling.
 */
export const maxDuration = 60;

export default async function JournalPage() {
  // Answers first: `getPlaybooks` needs them to report per-rule statistics, and
  // the grid needs both to derive the setup grade. Same two-step the dashboard
  // page does, for the same reason.
  const positionRules = await getPositionRules();

  const [trades, accounts, fieldDefs, prefs, optionsMap, playbooks] = await Promise.all([
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
    getPlaybooks({ includeDeleted: true, positionRules }),
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
        playbooks={playbooks}
        positionRules={positionRules}
      />
    </div>
  );
}
