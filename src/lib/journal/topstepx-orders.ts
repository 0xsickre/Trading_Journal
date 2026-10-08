// TopstepX "Orders" export (CSV) → the bracket of each trade (phase O, 08.10.2026).
//
// The trades export has no stop and no target, so an imported trade had no R.
// The orders export has both, as the bracket's two orders:
//
//   Id,AccountName,ContractName,Status,Type,Size,Side,CreatedAt,TradeDay,FilledAt,CancelledAt,TriggeredAt,StopPrice,LimitPrice,ExecutePrice,TriggeredPrice,PositionDisposition,CreationDisposition,RejectionReason,ExchangeOrderId,PlatformOrderId
//   3614074691,…,MNQZ6,Filled,Market,3,Bid,10/07/2026 16:20:37 +02:00,…,10/07/2026 16:20:37 +02:00,,,,,31246.5,,Opening,Trader,…
//   3614074697,…,MNQZ6,Cancelled,Stop,3,Ask,10/07/2026 16:20:37 +02:00,…,,10/07/2026 17:49:06 +02:00,,31227.5,,,,Undetermined,StopLoss,…
//   3614074698,…,MNQZ6,Filled,Limit,3,Ask,10/07/2026 16:20:37 +02:00,…,10/07/2026 17:49:06 +02:00,,,,31366.5,31366.5,,Closing,TakeProfit,…
//
// One thing about it decides how it may be used: an order is ONE row, and a
// stop that was moved keeps only its LAST price. Shown by the trader's test on
// 08.10.2026 (stop placed lower, then moved to breakeven: one row, at the
// entry). So the stop in the file is the original only when it was never
// moved — and that is answered here only where it is certain (a stop at the
// entry or in profit was moved), and on read where it needs the MAE
// (`stop-moved.ts`).

import { normalizeInstrumentSymbol } from "./instrument-aliases";
import { parseImportNumber } from "./import-number";
import { topstepXTime, type TopstepXTrade } from "./topstepx-export";

/** The columns this reader needs; the export carries more. */
export const TOPSTEPX_ORDER_HEADERS = [
  "Id",
  "ContractName",
  "Status",
  "Type",
  "Size",
  "Side",
  "CreatedAt",
  "FilledAt",
  "StopPrice",
  "LimitPrice",
  "ExecutePrice",
  "PositionDisposition",
  "CreationDisposition",
] as const;

export type TopstepXOrder = {
  id: string;
  /** The catalog root: "MNQ". */
  symbol: string;
  status: "filled" | "cancelled" | "other";
  type: "market" | "limit" | "stop" | "other";
  size: number;
  side: "buy" | "sell";
  /** ISO with the file's offset. */
  createdAt: string | null;
  filledAt: string | null;
  stopPrice: number | null;
  limitPrice: number | null;
  executePrice: number | null;
  opening: boolean;
  /** Who made it: the trader, or the bracket's stop loss / take profit. */
  creation: "trader" | "stop_loss" | "take_profit" | "other";
};

export type EntryOrderType = "market" | "limit" | "stop";
export type ExitKind = "stop" | "target" | "manual";

export type TopstepXBracket = {
  entryType: EntryOrderType | null;
  /** The stop's LAST price — a moved stop overwrites it. */
  finalStop: number | null;
  target: number | null;
  exitKind: ExitKind | null;
  /** The last stop sits at the entry or in profit: it was moved (breakeven or trailing). */
  stopMovedToProfit: boolean;
};

/** Whether a CSV's header row is TopstepX's orders export. */
export function isTopstepXOrders(headers: string[]): boolean {
  const have = new Set(headers.map((h) => h.trim()));
  return TOPSTEPX_ORDER_HEADERS.every((h) => have.has(h));
}

const lower = (v: unknown) => (v == null ? "" : String(v).trim().toLowerCase());

export function readTopstepXOrders(rows: Record<string, unknown>[]): TopstepXOrder[] {
  const text = (v: unknown) => (v == null ? "" : String(v).trim());
  const num = (v: unknown) => parseImportNumber(text(v));
  const time = (v: unknown) => (text(v) ? topstepXTime(text(v)) : null);
  return rows
    .filter((r) => text(r.Id) !== "")
    .map((r) => {
      const contract = text(r.ContractName);
      const status = lower(r.Status);
      const type = lower(r.Type);
      const creation = lower(r.CreationDisposition);
      return {
        id: text(r.Id),
        symbol: normalizeInstrumentSymbol(contract) ?? contract,
        status: status === "filled" ? "filled" : status === "cancelled" ? "cancelled" : "other",
        type: type === "market" || type === "limit" || type === "stop" ? type : "other",
        size: num(r.Size) ?? 0,
        // TopstepX writes the side as the book it took: Bid = buy, Ask = sell.
        side: lower(r.Side) === "bid" ? "buy" : "sell",
        createdAt: time(r.CreatedAt),
        filledAt: time(r.FilledAt),
        stopPrice: num(r.StopPrice),
        limitPrice: num(r.LimitPrice),
        executePrice: num(r.ExecutePrice),
        opening: lower(r.PositionDisposition) === "opening",
        creation:
          creation === "trader"
            ? "trader"
            : creation === "stoploss"
              ? "stop_loss"
              : creation === "takeprofit"
                ? "take_profit"
                : "other",
      } satisfies TopstepXOrder;
    });
}

const ms = (iso: string | null | undefined) => Date.parse(String(iso ?? ""));

/** Two seconds: the export's fill time and the trades export's entry time are the same event. */
const SAME_EVENT_MS = 2_000;

/**
 * The bracket of one trade, or null when the file holds no order for it.
 *
 * The entry is the filled opening order of the same contract and side within
 * two seconds of the trade's entry. The stop and the target are the orders the
 * bracket created on the other side between the entry and the exit — a stop
 * added a minute after the fill is still the trade's stop. With more than one,
 * the one that was filled wins, else the latest created.
 */
export function bracketFor(
  trade: Pick<TopstepXTrade, "symbol" | "direction" | "entryTime" | "exitTime" | "entryPrice">,
  orders: readonly TopstepXOrder[],
): TopstepXBracket | null {
  const buy = trade.direction === "Long";
  const entryAt = ms(trade.entryTime);
  const exitAt = ms(trade.exitTime);
  if (!Number.isFinite(entryAt)) return null;
  const same = orders.filter((o) => o.symbol === trade.symbol);

  const entry = same.find(
    (o) =>
      o.opening &&
      o.status === "filled" &&
      o.side === (buy ? "buy" : "sell") &&
      Math.abs(ms(o.filledAt) - entryAt) <= SAME_EVENT_MS,
  );
  const createdAt = ms(entry?.createdAt) || entryAt;
  const until = Number.isFinite(exitAt) ? exitAt : Number.POSITIVE_INFINITY;
  const inTrade = (o: TopstepXOrder) =>
    o.side === (buy ? "sell" : "buy") && ms(o.createdAt) >= createdAt - SAME_EVENT_MS && ms(o.createdAt) <= until;
  const pick = (list: TopstepXOrder[]) =>
    list.find((o) => o.status === "filled") ??
    [...list].sort((a, b) => ms(b.createdAt) - ms(a.createdAt))[0] ??
    null;

  const stop = pick(same.filter((o) => inTrade(o) && o.creation === "stop_loss"));
  const target = pick(same.filter((o) => inTrade(o) && o.creation === "take_profit"));
  if (!entry && !stop && !target) return null;

  const finalStop = stop?.stopPrice ?? null;
  const stopMovedToProfit =
    finalStop != null && (buy ? finalStop >= trade.entryPrice : finalStop <= trade.entryPrice);
  const exitKind: ExitKind | null = !Number.isFinite(exitAt)
    ? null
    : stop?.status === "filled"
      ? "stop"
      : target?.status === "filled"
        ? "target"
        : "manual";

  return {
    entryType: entry && entry.type !== "other" ? entry.type : null,
    finalStop,
    target: target?.limitPrice ?? null,
    exitKind,
    stopMovedToProfit,
  };
}
