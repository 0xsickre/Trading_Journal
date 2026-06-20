import { getOptionsMap } from "@/lib/journal/options";
import { getInstruments } from "@/lib/journal/instruments";
import { getAccounts } from "@/lib/journal/accounts";
import { TradeForm } from "@/components/journal/trade-form";

export default async function NewTradePage() {
  const [optionsMap, instruments, accounts] = await Promise.all([
    getOptionsMap(true),
    getInstruments(true),
    getAccounts(),
  ]);

  return (
    <TradeForm
      optionsMap={optionsMap}
      instruments={instruments}
      accounts={accounts}
    />
  );
}
