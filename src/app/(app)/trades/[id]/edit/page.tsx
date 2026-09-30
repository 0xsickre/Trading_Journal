import { notFound } from "next/navigation";
import { getCategoryOrder, getOptionsMap } from "@/lib/journal/options";
import { getInstruments } from "@/lib/journal/instruments";
import { getAccounts } from "@/lib/journal/accounts";
import { getTradeForEdit, getTradeScenario } from "@/lib/journal/trades";
import { getTopstepSizing } from "@/lib/journal/topstep-status";
import { getFieldDefs } from "@/lib/journal/field-defs";
import { getPlaybooks } from "@/lib/journal/playbooks";
import { TradeForm } from "@/components/journal/trade-form";
import { TradeScenarioCard } from "@/components/journal/trade-scenario-card";

export default async function EditTradePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [optionsMap, instruments, accounts, initial, fieldDefs, playbooks, categoryOrder, topstepSizing, scenario] =
    await Promise.all([
      getOptionsMap(true),
      getInstruments(true),
      getAccounts(),
      getTradeForEdit(id),
      // All defs, active or not: this trade may carry a value for a field that
      // has since been retired, and the form must show it rather than drop it.
      getFieldDefs(false),
      // Everything, including retired rules: this trade may have answered one,
      // and the form must show that answer rather than silently drop it on save.
      getPlaybooks({ activeOnly: false, includeDeleted: true }),
      // The order the trader dragged the categories into.
      getCategoryOrder(),
      // Room above the MLL and today's DLL per Topstep account: the futures sizing base.
      getTopstepSizing(),
      // What would have happened (phase L), once futures-trading has measured it.
      getTradeScenario(id),
    ]);

  if (!initial) notFound();

  return (
    <TradeForm
      optionsMap={optionsMap}
      instruments={instruments}
      accounts={accounts}
      fieldDefs={fieldDefs}
      playbooks={playbooks}
      initial={initial}
      topstepSizing={topstepSizing}
      categoryOrder={categoryOrder}
      extra={scenario ? <TradeScenarioCard trade={scenario} /> : null}
    />
  );
}
