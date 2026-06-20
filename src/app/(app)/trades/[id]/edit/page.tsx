import { notFound } from "next/navigation";
import { getOptionsMap } from "@/lib/journal/options";
import { getInstruments } from "@/lib/journal/instruments";
import { getAccounts } from "@/lib/journal/accounts";
import { getTradeForEdit } from "@/lib/journal/trades";
import { TradeForm } from "@/components/journal/trade-form";

export default async function EditTradePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [optionsMap, instruments, accounts, initial] = await Promise.all([
    getOptionsMap(true),
    getInstruments(true),
    getAccounts(),
    getTradeForEdit(id),
  ]);

  if (!initial) notFound();

  return (
    <TradeForm
      optionsMap={optionsMap}
      instruments={instruments}
      accounts={accounts}
      initial={initial}
    />
  );
}
