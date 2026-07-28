import { getOptionsMap } from "@/lib/journal/options";
import { getInstruments } from "@/lib/journal/instruments";
import { getAccounts } from "@/lib/journal/accounts";
import { getFailedFtmoAccountIds } from "@/lib/journal/ftmo-status";
import { getAccountEquities } from "@/lib/journal/equity";
import { TradeForm } from "@/components/journal/trade-form";

export default async function NewTradePage() {
  const [optionsMap, instruments, accounts, failedFtmo, accountEquity] =
    await Promise.all([
      getOptionsMap(true),
      getInstruments(true),
      getAccounts(),
      getFailedFtmoAccountIds(),
      getAccountEquities(),
    ]);

  return (
    <TradeForm
      optionsMap={optionsMap}
      instruments={instruments}
      accounts={accounts}
      ftmoFailedAccountIds={[...failedFtmo]}
      accountEquity={accountEquity}
    />
  );
}
