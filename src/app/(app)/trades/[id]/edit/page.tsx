import { notFound } from "next/navigation";
import { getOptionsMap } from "@/lib/journal/options";
import { getInstruments } from "@/lib/journal/instruments";
import { getAccounts } from "@/lib/journal/accounts";
import { getTradeForEdit } from "@/lib/journal/trades";
import { getAccountEquities } from "@/lib/journal/equity";
import { getFieldDefs } from "@/lib/journal/field-defs";
import { TradeForm } from "@/components/journal/trade-form";

export default async function EditTradePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [optionsMap, instruments, accounts, initial, accountEquity, fieldDefs] =
    await Promise.all([
      getOptionsMap(true),
      getInstruments(true),
      getAccounts(),
      getTradeForEdit(id),
      getAccountEquities(),
      // All defs, active or not: this trade may carry a value for a field that
      // has since been retired, and the form must show it rather than drop it.
      getFieldDefs(false),
    ]);

  if (!initial) notFound();

  return (
    <TradeForm
      optionsMap={optionsMap}
      instruments={instruments}
      accounts={accounts}
      fieldDefs={fieldDefs}
      initial={initial}
      accountEquity={accountEquity}
    />
  );
}
