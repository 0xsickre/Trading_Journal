import { getOptionsMap } from "@/lib/journal/options";
import { getInstruments } from "@/lib/journal/instruments";
import { getAccounts } from "@/lib/journal/accounts";
import { getPlaybooks } from "@/lib/journal/playbooks";
import { primaryAccount } from "@/lib/journal/account-rules";
import { todayFor } from "@/lib/journal/time";
import { PageHeader } from "@/components/app/page-header";
import { MissedSetupForm } from "@/components/journal/missed-setup-form";

/** A setup seen and not taken, written from the recording (phase O). */
export default async function MissedSetupPage() {
  const [optionsMap, instruments, accounts, playbooks] = await Promise.all([
    getOptionsMap(true),
    getInstruments(true),
    getAccounts(),
    getPlaybooks({ activeOnly: true }),
  ]);
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Propušten setup"
        description="Sa snimka: gde je bio ulaz, stop i cilj i kada. Ishod se meri iz berzanskih sveća, kao da si ušao."
      />
      <MissedSetupForm
        accounts={accounts}
        instruments={instruments}
        playbooks={playbooks}
        optionsMap={optionsMap}
        today={todayFor(primaryAccount(accounts))}
      />
    </div>
  );
}
