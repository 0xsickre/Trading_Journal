import type { MatchCandidate } from "./import-match";
import type { TradeRow } from "./types";

/**
 * The trades an import may match, in the shape `matchImportRow` reads. One
 * place, so `/import` and the NinjaTrader sync (phase I3) ask the same question
 * of the same trades.
 */
export function importCandidates(trades: readonly TradeRow[]): MatchCandidate[] {
  return trades.map((t) => ({
    id: t.id,
    instrument: (t.instrument as string) ?? null,
    direction: (t.direction as string) ?? null,
    // For the weaker, time-blind question a suggestion is built on: the account
    // it may not cross, the size it may agree on, and the number a human reads
    // to recognise their own trade.
    accountId: (t.account_id as string) ?? null,
    entryQty: t.stats?.entry_qty ?? null,
    tradeNo: (t.trade_no as number) ?? null,
    avgEntry: t.stats?.avg_entry ?? null,
    avgExit: t.stats?.avg_exit ?? null,
    openedAt: t.stats?.opened_at ?? null,
    totalFees: t.stats?.total_fees ?? 0,
    grossPl: t.stats?.gross_pl ?? null,
    netPl: t.stats?.net_pl ?? null,
    // For a plan written before its order filled: the limit it rests at and
    // when it was written, so the export's fill can find it (import-match.ts).
    status: (t.status as string) ?? null,
    plannedEntry: t.entry_price != null ? Number(t.entry_price) : null,
    plannedAt: (t.created_at as string) ?? null,
    finalStop: t.final_stop_price != null ? Number(t.final_stop_price) : null,
    entryOrderType: (t.entry_order_type as string) ?? null,
  }));
}
