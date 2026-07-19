import { getOptionsMap } from "@/lib/journal/options";
import { getInstruments } from "@/lib/journal/instruments";
import { getAccounts } from "@/lib/journal/accounts";
import { getFailedFtmoAccountIds } from "@/lib/journal/ftmo-status";
import { TradeForm } from "@/components/journal/trade-form";

export default async function NewTradePage() {
  const [optionsMap, instruments, accounts, failedFtmo] = await Promise.all([
    getOptionsMap(true),
    getInstruments(true),
    getAccounts(),
    getFailedFtmoAccountIds(),
  ]);

  return (
    <TradeForm
      optionsMap={optionsMap}
      instruments={instruments}
      accounts={accounts}
      ftmoFailedAccountIds={[...failedFtmo]}
    />
  );
}
