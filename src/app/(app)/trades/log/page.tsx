import { getOptionsMap } from "@/lib/journal/options";
import { getInstruments } from "@/lib/journal/instruments";
import { getAccounts } from "@/lib/journal/accounts";
import { getPlaybooks } from "@/lib/journal/playbooks";
import { getFailedFtmoAccountIds } from "@/lib/journal/ftmo-status";
import { getFailedTopstepAccountIds } from "@/lib/journal/topstep-status";
import { PageHeader } from "@/components/app/page-header";
import { QuickLogForm } from "@/components/journal/quick-log-form";

/**
 * Log a trade after it closed — the day trader's entry point. The plan form
 * (`/trades/new`) stays for a limit written well before price gets there.
 */
export default async function LogTradePage() {
  const [optionsMap, instruments, accounts, playbooks, failedFtmo, failedTopstep] = await Promise.all([
    getOptionsMap(true),
    getInstruments(true),
    getAccounts(),
    getPlaybooks({ activeOnly: true }),
    // A blown account is warned about here, never blocked: this is the record.
    getFailedFtmoAccountIds(),
    getFailedTopstepAccountIds(),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Log Trade"
        description="Right after the trade is flat: four numbers off the platform, then setup, grade and what went wrong. The day's TopstepX export corrects the numbers; your answers stay."
      />
      <QuickLogForm
        accounts={accounts}
        instruments={instruments}
        playbooks={playbooks}
        optionsMap={optionsMap}
        ftmoFailedAccountIds={[...failedFtmo]}
        topstepFailedAccountIds={[...failedTopstep]}
      />
    </div>
  );
}
