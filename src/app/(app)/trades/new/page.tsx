import { getCategoryOrder, getOptionsMap } from "@/lib/journal/options";
import { getInstruments } from "@/lib/journal/instruments";
import { getAccounts } from "@/lib/journal/accounts";
import { getFailedFtmoAccountIds } from "@/lib/journal/ftmo-status";
import { getAccountEquities } from "@/lib/journal/equity";
import { getFailedTopstepAccountIds, getTopstepSizing } from "@/lib/journal/topstep-status";
import { getFieldDefs } from "@/lib/journal/field-defs";
import { getPlaybooks } from "@/lib/journal/playbooks";
import { TradeForm } from "@/components/journal/trade-form";

export default async function NewTradePage() {
  const [optionsMap, instruments, accounts, failedFtmo, accountEquity, fieldDefs, playbooks, categoryOrder, topstepSizing, failedTopstep] =
    await Promise.all([
      getOptionsMap(true),
      getInstruments(true),
      getAccounts(),
      getFailedFtmoAccountIds(),
      getAccountEquities(),
      // Active only: a deactivated field must not be offered for NEW input.
      getFieldDefs(true),
      // Active only: a retired playbook must not be offered for a NEW trade.
      getPlaybooks({ activeOnly: true }),
      // The order the trader dragged the categories into.
      getCategoryOrder(),
      // Room above the MLL and today's DLL per Topstep account: the futures sizing base.
      getTopstepSizing(),
      // Topstep accounts past their MLL: a new plan is refused, as on frozen FTMO.
      getFailedTopstepAccountIds(),
    ]);

  return (
    <TradeForm
      optionsMap={optionsMap}
      instruments={instruments}
      accounts={accounts}
      fieldDefs={fieldDefs}
      playbooks={playbooks}
      ftmoFailedAccountIds={[...failedFtmo]}
      topstepFailedAccountIds={[...failedTopstep]}
      accountEquity={accountEquity}
      topstepSizing={topstepSizing}
      categoryOrder={categoryOrder}
    />
  );
}
