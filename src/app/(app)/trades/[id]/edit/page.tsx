import { notFound } from "next/navigation";
import { getCategoryOrder, getOptionsMap } from "@/lib/journal/options";
import { getInstruments } from "@/lib/journal/instruments";
import { getAccounts } from "@/lib/journal/accounts";
import { getTradeForEdit } from "@/lib/journal/trades";
import { getAccountEquities } from "@/lib/journal/equity";
import { getFieldDefs } from "@/lib/journal/field-defs";
import { getPlaybooks } from "@/lib/journal/playbooks";
import { TradeForm } from "@/components/journal/trade-form";

export default async function EditTradePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [optionsMap, instruments, accounts, initial, accountEquity, fieldDefs, playbooks, categoryOrder] =
    await Promise.all([
      getOptionsMap(true),
      getInstruments(true),
      getAccounts(),
      getTradeForEdit(id),
      getAccountEquities(),
      // All defs, active or not: this trade may carry a value for a field that
      // has since been retired, and the form must show it rather than drop it.
      getFieldDefs(false),
      // Everything, including retired rules: this trade may have answered one,
      // and the form must show that answer rather than silently drop it on save.
      getPlaybooks({ activeOnly: false, includeDeleted: true }),
      // The order the trader dragged the categories into.
      getCategoryOrder(),
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
      accountEquity={accountEquity}
      categoryOrder={categoryOrder}
    />
  );
}
