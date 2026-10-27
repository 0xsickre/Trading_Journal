import { getAccounts } from "@/lib/journal/accounts";
import { getInstruments } from "@/lib/journal/instruments";
import { getTradesWithStats } from "@/lib/journal/trades";
import { getImportBatches } from "@/lib/journal/import-batches";
import { importCandidates } from "@/lib/journal/import-candidates";
import {
  ImportWizard,
  type MatchCandidate,
} from "@/components/journal/import-wizard";
import { ImportHistory } from "@/components/journal/import-history";
import { PageHeader } from "@/components/app/page-header";

export default async function ImportPage() {
  const [accounts, trades, batches, instruments] = await Promise.all([
    getAccounts(),
    getTradesWithStats(),
    getImportBatches(),
    getInstruments(),
  ]);

  const candidates: MatchCandidate[] = importCandidates(trades);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Import Trades"
        description="Upload a broker CSV/Excel. Already-logged trades are matched so only objective numbers update — your psychology and ICT notes stay intact."
      />
      <ImportWizard
        accounts={accounts}
        candidates={candidates}
        // Only symbol and point value cross to the client: that pair is all the
        // TradingView size check needs.
        instruments={instruments.map((i) => ({ symbol: i.symbol, point_value: i.point_value }))}
      />
      <ImportHistory batches={batches} accounts={accounts} />
    </div>
  );
}
