// TopstepX "Trades" export (CSV) → one import row per trade.
//
// The layout, read off a real export on 28.09.2026:
//
//   Id,ContractName,EnteredAt,ExitedAt,EntryPrice,ExitPrice,Fees,PnL,Size,Type,TradeDay,TradeDuration,Commissions
//   3142050021,MNQZ6,09/28/2026 10:43:54 +02:00,09/28/2026 10:47:38 +02:00,30584.000000000,30600.250000000,0.72000,-32.500000000,1,Short,09/28/2026 00:00:00 -05:00,00:03:44.2166590,0.50000
//
// Three things about it would import a confidently wrong trade through the
// generic column mapping:
//
//   1. The dates are MONTH-first ("09/28/2026"), which `parseImportTime` rightly
//      refuses as ambiguous. Here the layout is known — the 28 in that row can
//      only be a day — so the date is rewritten as ISO with the offset the file
//      carries, and a field that is not a valid month or day is refused rather
//      than swapped.
//   2. The contract carries its month ("MNQZ6"). The trade is the catalog's
//      root, MNQ — every month shares one contract spec — and which month was
//      traded is read back off the exchange's prices when MAE/MFE is measured
//      (futures-trading `tools/journal_mae.py`).
//   3. Costs come in two columns: `Fees` (exchange and NFA) and `Commissions`
//      (Topstep's). Both are costs on the trade; the journal's fee is their sum.
//      `PnL` is GROSS — the price move times the multiplier, fees not taken — and
//      is checked against exactly that, so a contract whose multiplier differs
//      from the catalog's is caught here rather than in the P&L.

import { normalizeInstrumentSymbol } from "./instrument-aliases";
import { parseImportNumber } from "./import-number";

/** The export's header, in its own order. */
export const TOPSTEPX_HEADERS = [
  "Id",
  "ContractName",
  "EnteredAt",
  "ExitedAt",
  "EntryPrice",
  "ExitPrice",
  "Fees",
  "PnL",
  "Size",
  "Type",
  "TradeDay",
  "TradeDuration",
  "Commissions",
] as const;

/** The flat table's columns — the names the wizard maps onto its own fields. */
export const TOPSTEPX_COLUMNS = {
  ticket: "Ticket",
  contract: "Contract",
  symbol: "Symbol",
  side: "Side",
  volume: "Volume",
  entryPrice: "Entry price",
  entryTime: "Entry time",
  exitPrice: "Exit price",
  exitTime: "Exit time",
  fee: "Fees",
  profit: "Profit",
  issue: "Issue",
} as const;

export type TopstepXTrade = {
  /** TopstepX's trade id, kept so a re-import can be recognised. */
  id: string;
  /** As exported, month included: "MNQZ6". */
  contract: string;
  /** The catalog root: "MNQ". */
  symbol: string;
  direction: "Long" | "Short";
  size: number;
  entryPrice: number;
  /** ISO with the file's own offset: "2026-09-28T10:43:54+02:00". */
  entryTime: string;
  exitPrice: number;
  exitTime: string;
  /** Fees + commissions, positive — a cost. */
  fees: number;
  /** TopstepX's gross result. */
  pnl: number;
  /** Why this row cannot be imported as read. `null` when it can. */
  problem: string | null;
};

/** Whether a CSV's header row is TopstepX's trades export. */
export function isTopstepXTrades(headers: string[]): boolean {
  const have = new Set(headers.map((h) => h.trim()));
  return TOPSTEPX_HEADERS.every((h) => have.has(h));
}

/**
 * "09/28/2026 10:43:54 +02:00" → "2026-09-28T10:43:54+02:00".
 *
 * Month first, always: that is TopstepX's layout, not a guess about this row.
 * An offset is required — without one the clock would have to be assumed, and
 * a wrong zone puts every fill hours away from the price it was made at.
 */
export function topstepXTime(raw: string): string | null {
  const m = raw
    .trim()
    .match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2}):(\d{2})(?:\.\d+)? ([+-]\d{2}):?(\d{2})$/);
  if (!m) return null;
  const [, mo, d, y, h, mi, s, oh, om] = m;
  const month = Number(mo);
  const day = Number(d);
  // Day 0 of the next month is the last day of this one: 31 February is
  // refused here instead of rolling into March inside Date.
  const daysInMonth = new Date(Date.UTC(Number(y), month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth) return null;
  if (Number(h) > 23 || Number(mi) > 59 || Number(s) > 59) return null;
  const iso = `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}T${h.padStart(2, "0")}:${mi}:${s}${oh}:${om}`;
  return Number.isNaN(new Date(iso).getTime()) ? null : iso;
}

/** Read the export's rows. A row that cannot be read is kept, with its problem. */
export function readTopstepXTrades(
  rows: Record<string, unknown>[],
  pointValueOf: (symbol: string) => number | null,
): TopstepXTrade[] {
  const text = (v: unknown) => (v == null ? "" : String(v).trim());
  const num = (v: unknown) => parseImportNumber(text(v));
  return rows
    .filter((r) => text(r.Id) !== "")
    .map((r) => {
      const contract = text(r.ContractName);
      const symbol = normalizeInstrumentSymbol(contract) ?? contract;
      const type = text(r.Type).toLowerCase();
      const direction = type === "short" ? "Short" : "Long";
      const entryTime = topstepXTime(text(r.EnteredAt));
      const exitTime = topstepXTime(text(r.ExitedAt));
      const entryPrice = num(r.EntryPrice);
      const exitPrice = num(r.ExitPrice);
      const size = num(r.Size);
      const fees = (num(r.Fees) ?? 0) + (num(r.Commissions) ?? 0);
      const pnl = num(r.PnL);

      let problem: string | null = null;
      if (type !== "long" && type !== "short") problem = `Type "${text(r.Type)}" is neither Long nor Short`;
      else if (!entryTime || !exitTime) problem = "EnteredAt/ExitedAt is not MM/DD/YYYY HH:MM:SS ±HH:MM";
      else if (entryPrice == null || exitPrice == null || size == null || size <= 0) problem = "price or size missing";
      else if (pnl != null) {
        // The gross result is the price move times the multiplier times the
        // size. A contract the catalog prices differently is caught here.
        const pv = pointValueOf(symbol);
        if (pv == null) problem = `${symbol} is not in the instrument catalog`;
        else {
          const move = direction === "Long" ? exitPrice - entryPrice : entryPrice - exitPrice;
          const expected = move * pv * size;
          if (Math.abs(expected - pnl) > 0.01 + 1e-9 * Math.abs(pnl)) {
            problem = `PnL ${pnl} is not the price move × ${pv} × ${size} = ${expected.toFixed(2)} — the catalog's multiplier for ${symbol} is not TopstepX's`;
          }
        }
      }
      return {
        id: text(r.Id),
        contract,
        symbol,
        direction,
        size: size ?? 0,
        entryPrice: entryPrice ?? 0,
        entryTime: entryTime ?? "",
        exitPrice: exitPrice ?? 0,
        exitTime: exitTime ?? "",
        fees,
        pnl: pnl ?? 0,
        problem,
      } satisfies TopstepXTrade;
    });
}

/** The trades as the one-row-per-trade table the wizard reads. */
export function topstepXImportRows(trades: TopstepXTrade[]): Record<string, string>[] {
  return trades.map((t) => ({
    [TOPSTEPX_COLUMNS.ticket]: t.id,
    [TOPSTEPX_COLUMNS.contract]: t.contract,
    [TOPSTEPX_COLUMNS.symbol]: t.symbol,
    [TOPSTEPX_COLUMNS.side]: t.direction,
    [TOPSTEPX_COLUMNS.volume]: String(t.size),
    [TOPSTEPX_COLUMNS.entryPrice]: String(t.entryPrice),
    [TOPSTEPX_COLUMNS.entryTime]: t.entryTime,
    [TOPSTEPX_COLUMNS.exitPrice]: String(t.exitPrice),
    [TOPSTEPX_COLUMNS.exitTime]: t.exitTime,
    [TOPSTEPX_COLUMNS.fee]: String(t.fees),
    [TOPSTEPX_COLUMNS.profit]: String(t.pnl),
    [TOPSTEPX_COLUMNS.issue]: t.problem ?? "",
  }));
}
