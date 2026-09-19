// MetaTrader 5 "Trade History Report" → one import row per closed position.
//
// MT5 does not export a table. It exports a REPORT: a title, four lines about
// the account, then three tables stacked in one sheet — Positions, Orders,
// Deals — each under its own banner row, each ending in a totals row, followed
// by a balance summary, a chart and the Results block.
//
// The import wizard reads the first row of a sheet as the header, so an MT5
// report arrived as `Trade History Report | __EMPTY | __EMPTY_1 | …` with 28
// rows of prose under it. Nothing to map, and no way to tell the user why.
//
// So the report is read the way it is written: find the Positions banner, take
// the header row under it, and read rows until the table ends. Positions is the
// right table of the three — one row per position, with the open and the close
// on it. Deals would be one row per fill (and a "balance" row for the deposit),
// Orders would include the ones that never filled.
//
// The header has "Time" twice and "Price" twice — open and close. That is why
// the columns are taken by POSITION in the header row and not by name: read
// through a name-keyed parser, the second pair silently overwrites the first
// and every trade imports with its exit as its entry.

import { parseImportNumber } from "./import-number";

/** The title in A1 of every MT5 history report. */
const TITLE = "Trade History Report";

/** The banner over the table this module reads. */
const POSITIONS = "Positions";

/** The banners that end it. */
const AFTER = ["orders", "deals", "results"];

export type Mt5Position = {
  /** MT5's position ticket, kept so a re-import can be recognised. */
  id: string;
  symbol: string;
  direction: "Long" | "Short";
  /** Volume in lots, as the statement writes it. */
  volume: number;
  entryPrice: number;
  /** Wall clock as written, "2026.09.19 10:26:22" — the account's zone. */
  entryTime: string;
  exitPrice: number | null;
  exitTime: string | null;
  /** T/P as it stood at the end; the stop is deliberately not read. */
  target: number | null;
  commission: number;
  swap: number;
  /** The position's result in the ACCOUNT's currency. */
  profit: number | null;
  /** Why this row cannot be imported as read. `null` when it can. */
  problem: string | null;
};

export type Mt5Statement = {
  /** The account's currency, from "1514682848 (EUR, FTMO-Demo, demo, Hedge)". */
  currency: string | null;
  /** The account number, for the line the wizard shows above the preview. */
  account: string | null;
  positions: Mt5Position[];
};

/** The flat table's columns — the names the wizard maps onto its own fields. */
export const MT5_COLUMNS = {
  ticket: "Ticket",
  symbol: "Symbol",
  side: "Side",
  volume: "Volume",
  entryPrice: "Entry price",
  entryTime: "Entry time",
  exitPrice: "Exit price",
  exitTime: "Exit time",
  target: "T/P",
  fee: "Commission",
  swap: "Swap",
  profit: "Profit",
  issue: "Issue",
} as const;

/**
 * The statement's positions as the one-row-per-trade table the wizard reads.
 *
 * **Costs change sign here.** MT5 writes what it took off the account, so a
 * commission is `-3.50` and a swap paid is `-0.75`. The journal's `fee` and
 * `swap_funding` are costs as POSITIVE numbers — `net_pl` is
 * `gross - total_fees - total_swap` — so importing MT5's figures as they stand
 * would ADD every cost to the result and the trade would read better than it
 * was. Negating both keeps a credit a credit: a positive swap on the statement
 * becomes a negative swap here, which raises the net exactly as it should.
 */
export function mt5ImportRows(statement: Mt5Statement): Record<string, string>[] {
  const num = (n: number | null): string => (n == null ? "" : String(n));
  return statement.positions.map((p) => ({
    [MT5_COLUMNS.ticket]: p.id,
    [MT5_COLUMNS.symbol]: p.symbol,
    [MT5_COLUMNS.side]: p.direction,
    [MT5_COLUMNS.volume]: num(p.volume),
    [MT5_COLUMNS.entryPrice]: num(p.entryPrice),
    [MT5_COLUMNS.entryTime]: p.entryTime,
    [MT5_COLUMNS.exitPrice]: num(p.exitPrice),
    [MT5_COLUMNS.exitTime]: p.exitTime ?? "",
    [MT5_COLUMNS.target]: num(p.target),
    [MT5_COLUMNS.fee]: num(-p.commission),
    [MT5_COLUMNS.swap]: num(-p.swap),
    [MT5_COLUMNS.profit]: num(p.profit),
    [MT5_COLUMNS.issue]: p.problem ?? "",
  }));
}

function text(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

/** The row's first non-empty cell — how a banner row is recognised. */
function firstCell(row: unknown[]): string {
  for (const c of row) {
    const t = text(c);
    if (t) return t;
  }
  return "";
}

/** Whether a sheet read as a grid is an MT5 history report. */
export function isMt5Statement(grid: unknown[][]): boolean {
  if (grid.length === 0) return false;
  const head = grid.slice(0, 6).map(firstCell);
  return head.some((c) => c === TITLE) && grid.some((r) => firstCell(r) === POSITIONS);
}

/**
 * The column each field sits in, by its position in the header row.
 *
 * "Time" and "Price" appear twice: the first is the open, the second the close.
 */
type Layout = {
  entryTime: number; id: number; symbol: number; type: number; volume: number;
  entryPrice: number; target: number; exitTime: number; exitPrice: number;
  commission: number; swap: number; profit: number;
};

function layoutOf(header: unknown[]): Layout | null {
  const cells = header.map((c) => text(c).toLowerCase().replace(/\s+/g, ""));
  const at = (name: string, nth = 0): number => {
    let seen = 0;
    for (let i = 0; i < cells.length; i++) {
      if (cells[i] === name) {
        if (seen === nth) return i;
        seen++;
      }
    }
    return -1;
  };
  const layout: Layout = {
    entryTime: at("time", 0),
    id: at("position"),
    symbol: at("symbol"),
    type: at("type"),
    volume: at("volume"),
    entryPrice: at("price", 0),
    target: at("t/p"),
    exitTime: at("time", 1),
    exitPrice: at("price", 1),
    commission: at("commission"),
    swap: at("swap"),
    profit: at("profit"),
  };
  // Every column but the two optional ones has to be there, or this is not the
  // table this module thinks it is and reading it by position would be a guess.
  const required: (keyof Layout)[] = [
    "entryTime", "id", "symbol", "type", "volume", "entryPrice",
    "exitTime", "exitPrice", "commission", "swap", "profit",
  ];
  if (required.some((k) => layout[k] < 0)) return null;
  return layout;
}

/** `buy` is long, `sell` is short; anything else is not a position's side. */
function directionOf(cell: string): "Long" | "Short" | null {
  const s = cell.toLowerCase();
  if (s === "buy" || s.startsWith("buy ")) return "Long";
  if (s === "sell" || s.startsWith("sell ")) return "Short";
  return null;
}

/** A money or size cell, where empty means "not written" rather than zero. */
function numberOf(cell: string): number | null {
  return cell === "" ? null : parseImportNumber(cell);
}

/**
 * The account's currency and number, from the "Account:" line.
 *
 * `1514682848 (EUR, FTMO-Demo, demo, Hedge)`. Both are read from the same line
 * because the currency is the one thing in the report that tells the wizard
 * whether the figures belong in the account they are being imported into.
 */
function accountOf(grid: unknown[][]): { account: string | null; currency: string | null } {
  for (const row of grid.slice(0, 8)) {
    if (firstCell(row).toLowerCase() !== "account:") continue;
    for (const cell of row) {
      const m = text(cell).match(/^(\S+)\s*\(([A-Z]{3})\b/);
      if (m) return { account: m[1], currency: m[2] };
    }
  }
  return { account: null, currency: null };
}

/**
 * The report's closed positions, or `null` when the sheet is not one.
 *
 * A row that cannot be read is returned with `problem` set, never dropped: the
 * preview already shows such a row as one that will not import, which is a
 * visible question instead of a silent gap in the history.
 */
export function readMt5Statement(grid: unknown[][]): Mt5Statement | null {
  if (!isMt5Statement(grid)) return null;
  const banner = grid.findIndex((r) => firstCell(r) === POSITIONS);
  const header = grid[banner + 1];
  if (!header) return null;
  const layout = layoutOf(header);
  if (!layout) return null;

  const positions: Mt5Position[] = [];
  for (const row of grid.slice(banner + 2)) {
    const first = firstCell(row);
    if (first === "") continue;
    // The next banner ends the table. So does the Results block; the totals row
    // under the last position has no ticket and no symbol, and falls out below.
    if (AFTER.includes(first.toLowerCase())) break;

    const cell = (i: number) => text(row[i]);
    const id = cell(layout.id);
    const symbol = cell(layout.symbol);
    if (!id || !symbol) continue;

    const problems: string[] = [];
    const direction = directionOf(cell(layout.type));
    if (!direction) problems.push(`type "${cell(layout.type)}"`);
    const volume = numberOf(cell(layout.volume));
    if (volume == null || volume <= 0) problems.push("volume");
    const entryPrice = numberOf(cell(layout.entryPrice));
    if (entryPrice == null || entryPrice <= 0) problems.push("entry price");
    const entryTime = cell(layout.entryTime);
    if (!entryTime) problems.push("entry time");

    // A position with no close is still open: not a problem, just no exit.
    const exitTime = cell(layout.exitTime) || null;
    const exitRaw = cell(layout.exitPrice);
    const exitPrice = exitRaw === "" ? null : numberOf(exitRaw);
    if (exitRaw !== "" && (exitPrice == null || exitPrice <= 0)) problems.push("exit price");

    const commission = numberOf(cell(layout.commission));
    if (cell(layout.commission) !== "" && commission == null) problems.push("commission");
    const swap = numberOf(cell(layout.swap));
    if (cell(layout.swap) !== "" && swap == null) problems.push("swap");
    const profit = numberOf(cell(layout.profit));
    if (cell(layout.profit) !== "" && profit == null) problems.push("profit");

    positions.push({
      id,
      symbol: symbol.toUpperCase(),
      direction: direction ?? "Long",
      volume: volume ?? 0,
      entryPrice: entryPrice ?? 0,
      entryTime,
      exitPrice,
      exitTime,
      target: layout.target >= 0 ? numberOf(cell(layout.target)) : null,
      commission: commission ?? 0,
      swap: swap ?? 0,
      profit,
      problem: problems.length > 0 ? problems.join(", ") : null,
    });
  }

  return { ...accountOf(grid), positions };
}
