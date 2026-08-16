import { getAccounts } from "@/lib/journal/accounts";
import { getTradesWithStats } from "@/lib/journal/trades";
import { getImportBatches } from "@/lib/journal/import-batches";
import {
  ImportWizard,
  type MatchCandidate,
} from "@/components/journal/import-wizard";
import { ImportHistory } from "@/components/journal/import-history";
import { PageHeader } from "@/components/app/page-header";

export default async function ImportPage() {
  const [accounts, trades, batches] = await Promise.all([
    getAccounts(),
    getTradesWithStats(),
    getImportBatches(),
  ]);

  const candidates: MatchCandidate[] = trades.map((t) => ({
    id: t.id,
    instrument: (t.instrument as string) ?? null,
    direction: (t.direction as string) ?? null,
    avgEntry: t.stats?.avg_entry ?? null,
    avgExit: t.stats?.avg_exit ?? null,
    openedAt: t.stats?.opened_at ?? null,
    totalFees: t.stats?.total_fees ?? 0,
    totalSwap: t.stats?.total_swap ?? 0,
    grossPl: t.stats?.gross_pl ?? null,
    netPl: t.stats?.net_pl ?? null,
  }));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Import Trades"
        description="Upload a broker CSV/Excel. Already-logged trades are matched so only objective numbers update — your psychology and ICT notes stay intact."
      />
      <ImportWizard accounts={accounts} candidates={candidates} />
      <ImportHistory batches={batches} accounts={accounts} />
    </div>
  );
}
