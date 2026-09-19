// TradingView Strategy Tester / Bar Replay export → one import row per position.
//
// The export ("List of trades" → Excel) is not a broker statement, and four
// things about it would each import a confidently wrong trade through the
// generic column mapping:
//
//   1. It writes a trade as TWO rows — "Entry long" and "Exit long" under the
//      same "Trade number" — so a plain mapping creates two positions per trade.
//   2. Its first sheet is "Performance", a summary; the trades are on "Trades".
//      The generic reader takes the first sheet.
//   3. "Size (qty)" is in TradingView's units — ounces, pounds, index units for
//      a CFD, contracts for futures — while a fill's `qty` here is counted in
//      the instrument's own lots (see default-instruments.ts). 50 oz of gold
//      would import as 50 lots: a hundred times the money.
//   4. A position closed in parts is exported as one "trade" per exit, each
//      with its own entry row at the same time and price. They are joined back
//      into one position (`groupTradingViewPositions`).
//
// The third is not resolved by guessing the symbol's kind. The export carries
// its own money, so the scale is READ from it: TradingView's gross result
// divided by (price move × size) is 1 when it counts units and the contract's
// point value when it counts contracts. Anything else — a quote currency that
// is not the P&L currency, an instrument whose point value differs from the
// catalog's — is refused, and says which of the two it found.
//
// TradingView's favorable/adverse excursion becomes the trade's MFE/MAE PRICES
// (`tradingViewExcursion`). It is reported in money and net of the entry
// commission, so the price is recovered by putting that commission back and
// dividing by the size. Checked against every MFE typed by hand from the same
// exports: equal to the cent.

import { parseImportNumber } from "./import-number";

const TRADE = "Trade number";
const TYPE = "Type";
const TIME = "Date and time";
const SIGNAL = "Signal";
const SIZE = "Size (qty)";

/** The sheet the export keeps its trades on. */
export const TRADINGVIEW_SHEET = "Trades";

/** Money columns carry their currency in the header: "Net PnL USD". */
function currencyColumn(headers: string[], label: string): { header: string; currency: string } | null {
  const re = new RegExp(`^${label} ([A-Z]{3})$`);
  for (const h of headers) {
    const m = h.trim().match(re);
    if (m) return { header: h, currency: m[1] };
  }
  return null;
}

type Columns = {
  price: string;
  netPnl: string;
  commission: string;
  favorable: string | null;
  adverse: string | null;
  /** The currency of the export's money — P&L and commission. */
  currency: string;
};

function columnsOf(headers: string[]): Columns | null {
  const trimmed = headers.map((h) => h.trim());
  for (const h of [TRADE, TYPE, TIME, SIGNAL, SIZE]) if (!trimmed.includes(h)) return null;
  const price = currencyColumn(headers, "Price");
  const net = currencyColumn(headers, "Net PnL");
  const commission = currencyColumn(headers, "Commission");
  if (!price || !net || !commission) return null;
  // One currency for the money, or the arithmetic below mixes two.
  if (net.currency !== commission.currency) return null;
  return {
    price: price.header,
    netPnl: net.header,
    commission: commission.header,
    favorable: currencyColumn(headers, "Favorable excursion")?.header ?? null,
    adverse: currencyColumn(headers, "Adverse excursion")?.header ?? null,
    currency: net.currency,
  };
}

/** Whether a header row is TradingView's list of trades. */
export function isTradingViewTrades(headers: string[]): boolean {
  return columnsOf(headers) != null;
}

/**
 * The symbol from TradingView's file name, `<Strategy>_<EXCHANGE>_<SYMBOL>_<date>_<id>.xlsx`.
 *
 * The export has no symbol column — the file name is the only place it is
 * written. A name that has been changed does not match, and the import says so
 * instead of guessing.
 */
export function symbolFromTradingViewFilename(filename: string): string | null {
  const m = filename.match(
    /_([A-Za-z0-9]+)_([A-Za-z0-9.!]+)_\d{4}-\d{2}-\d{2}(?:_[A-Za-z0-9]+)?\.[A-Za-z]+$/,
  );
  return m ? m[2].toUpperCase() : null;
}

/**
 * An Excel date serial as the wall clock it shows, "YYYY-MM-DD HH:mm:ss".
 *
 * Excel stores the clock, not an instant: 45189.5833 is 20 Sep 2023 14:00 in
 * whatever zone the chart was in. Reading it through `Date` in the local zone
 * would shift it by the machine's offset, so the arithmetic stays in UTC and
 * the result is handed to `parseImportTime` with the account's zone, like any
 * other wall-clock cell.
 */
export function excelSerialToWallClock(serial: number): string | null {
  if (!Number.isFinite(serial)) return null;
  const ms = Math.round((serial - 25569) * 86400) * 1000;
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  if (y < 1990 || y > 2100) return null;
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${y}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
  );
}

function numberOf(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") return parseImportNumber(v);
  return null;
}

function timeOf(v: unknown): string | null {
  if (typeof v === "number") return excelSerialToWallClock(v);
  if (typeof v === "string" && v.trim()) return v.trim();
  return null;
}

function textOf(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

export type TradingViewTrade = {
  number: string;
  direction: "Long" | "Short";
  /** TradingView's own size — units or contracts, see `resolveTradingViewScale`. */
  size: number;
  entryPrice: number;
  entryTime: string;
  /** The entry order's name, e.g. "Buy limit order" — part of what makes two trades one fill. */
  entrySignal: string;
  exitPrice: number | null;
  exitTime: string | null;
  /** The exit order's name, e.g. "Bracket Stop Loss". Empty without an exit. */
  exitSignal: string;
  commission: number;
  netPnl: number | null;
  favorable: number | null;
  adverse: number | null;
  /** Why this trade cannot be imported as read. `null` when it can. */
  problem: string | null;
};

export type TradingViewExport = {
  currency: string;
  trades: TradingViewTrade[];
};

/**
 * Pairs the export's entry and exit rows into trades.
 *
 * A trade that does not pair cleanly — two entries, an exit without an entry,
 * sides or sizes that disagree, a cell that does not read — is still returned,
 * with `problem` naming why, so the preview can show it instead of dropping it.
 */
export function readTradingViewExport(rows: Record<string, unknown>[]): TradingViewExport | null {
  if (rows.length === 0) return null;
  const cols = columnsOf(Object.keys(rows[0]));
  if (!cols) return null;

  const groups = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const n = textOf(row[TRADE]);
    if (!n) continue;
    const g = groups.get(n);
    if (g) g.push(row);
    else groups.set(n, [row]);
  }

  const trades: TradingViewTrade[] = [];
  for (const [number, group] of groups) {
    const kind = (r: Record<string, unknown>) => textOf(r[TYPE]).toLowerCase();
    const entries = group.filter((r) => kind(r).startsWith("entry"));
    const exits = group.filter((r) => kind(r).startsWith("exit"));
    const problems: string[] = [];
    if (entries.length !== 1) problems.push(`${entries.length} entry rows`);
    if (exits.length > 1) problems.push(`${exits.length} exit rows`);
    if (entries.length + exits.length !== group.length) problems.push("a row that is neither entry nor exit");

    const entry = entries[0] ?? exits[0];
    // TradingView lists a still-open trade with an exit row signalled "Open",
    // priced at the last bar. That is a mark, not a fill.
    const exit = exits.length === 1 && textOf(exits[0][SIGNAL]).toLowerCase() !== "open"
      ? exits[0]
      : null;

    const side = (r: Record<string, unknown>) =>
      kind(r).endsWith("short") ? "Short" : kind(r).endsWith("long") ? "Long" : null;
    const direction = side(entry);
    if (!direction) problems.push("no long/short in Type");
    if (exit && side(exit) !== direction) problems.push("entry and exit disagree on side");

    const size = numberOf(entry[SIZE]);
    if (size == null || size <= 0) problems.push("size");
    if (exit && numberOf(exit[SIZE]) !== size) problems.push("entry and exit sizes differ");

    const entryPrice = numberOf(entry[cols.price]);
    if (entryPrice == null || entryPrice <= 0) problems.push("entry price");
    const entryTime = timeOf(entry[TIME]);
    if (!entryTime) problems.push("entry time");
    const exitPrice = exit ? numberOf(exit[cols.price]) : null;
    if (exit && (exitPrice == null || exitPrice <= 0)) problems.push("exit price");
    const exitTime = exit ? timeOf(exit[TIME]) : null;
    if (exit && !exitTime) problems.push("exit time");

    // Both rows repeat the trade's totals; the exit row is the one written when
    // the trade was complete.
    const totals = exit ?? entry;
    const commission = numberOf(totals[cols.commission]);
    if (commission == null || commission < 0) problems.push("commission");
    const netPnl = exit ? numberOf(exit[cols.netPnl]) : null;
    if (exit && netPnl == null) problems.push("net P&L");

    trades.push({
      number,
      direction: direction ?? "Long",
      size: size ?? 0,
      entryPrice: entryPrice ?? 0,
      entryTime: entryTime ?? "",
      entrySignal: textOf(entry[SIGNAL]),
      exitPrice,
      exitTime,
      exitSignal: exit ? textOf(exit[SIGNAL]) : "",
      commission: commission ?? 0,
      netPnl,
      favorable: cols.favorable ? numberOf(totals[cols.favorable]) : null,
      adverse: cols.adverse ? numberOf(totals[cols.adverse]) : null,
      problem: problems.length > 0 ? problems.join(", ") : null,
    });
  }

  trades.sort((a, b) => Number(a.number) - Number(b.number));
  return { currency: cols.currency, trades };
}

function priceMove(t: TradingViewTrade): number | null {
  if (t.exitPrice == null) return null;
  return (t.exitPrice - t.entryPrice) * (t.direction === "Short" ? -1 : 1);
}

/** TradingView's result before commission, the figure prices × size must explain. */
function grossOf(t: TradingViewTrade): number | null {
  return t.netPnl == null ? null : t.netPnl + t.commission;
}

export type TradingViewScale =
  | { ok: true; unit: "units" | "contracts"; /** TradingView size ÷ this = journal qty. */ divisor: number }
  | { ok: false; error: string };

/**
 * How TradingView's size maps onto the journal's qty for this instrument.
 *
 * Read off the trade with the largest move × size, where rounding in the
 * exported cents matters least. TradingView's money per 1.00 of price per 1 of
 * its size is either 1 (it counts units — a CFD, spot) or the point value (it
 * counts contracts — futures). Within 1% of either is accepted; anything else
 * is refused with the figure it found.
 */
export function resolveTradingViewScale(
  trades: TradingViewTrade[],
  pointValue: number | null,
): TradingViewScale {
  if (pointValue == null || !(pointValue > 0)) {
    return { ok: false, error: "the instrument has no point value in the catalog" };
  }
  let best: { t: TradingViewTrade; weight: number } | null = null;
  for (const t of trades) {
    const move = priceMove(t);
    if (t.problem || move == null || move === 0 || grossOf(t) == null) continue;
    const weight = Math.abs(move * t.size);
    if (!best || weight > best.weight) best = { t, weight };
  }
  if (!best) {
    return { ok: false, error: "no closed trade with a price move to check the size against" };
  }
  const perUnit = grossOf(best.t)! / (priceMove(best.t)! * best.t.size);
  if (Math.abs(perUnit - 1) <= 0.01) return { ok: true, unit: "units", divisor: pointValue };
  if (Math.abs(perUnit / pointValue - 1) <= 0.01) return { ok: true, unit: "contracts", divisor: 1 };
  return {
    ok: false,
    error:
      `TradingView's P&L is ${round(perUnit)} per 1.00 per unit of size, which is neither ` +
      `1 (units) nor the catalog point value ${pointValue} (contracts)`,
  };
}

function round(n: number): string {
  return String(Math.round(n * 10_000) / 10_000);
}

/**
 * Whether one trade's own P&L agrees with its prices at the resolved scale.
 * The scale is read off one trade; this holds every other trade to it.
 */
export function tradingViewPnlMismatch(
  t: TradingViewTrade,
  scale: Extract<TradingViewScale, { ok: true }>,
  pointValue: number,
): string | null {
  const move = priceMove(t);
  const gross = grossOf(t);
  if (move == null || gross == null) return null;
  const implied = move * (t.size / scale.divisor) * pointValue;
  const tolerance = Math.max(0.05, Math.abs(gross) * 0.005);
  if (Math.abs(implied - gross) <= tolerance) return null;
  return `P&L ${round(gross)} ≠ size × move ${round(implied)}`;
}

/** One exit fill of a position — a TradingView trade that closed. */
export type TradingViewExitLeg = {
  number: string;
  price: number;
  time: string;
  size: number;
  commission: number;
};

/**
 * What the journal calls one trade: one entry fill, and every exit taken out
 * of it.
 *
 * TradingView splits a position into one "trade" per exit. A long of 1.65
 * lots closed 0.5 at the first target and 1.15 at the second is exported as
 * trades #1 and #2, each with its own entry row — same time, same price, same
 * order — and each size cut to its exit. Imported as they stand they are two
 * positions, and there is no operation that joins two positions afterwards.
 */
export type TradingViewPosition = {
  /** TradingView's trade numbers this position is made of. */
  numbers: string[];
  direction: "Long" | "Short";
  entryPrice: number;
  entryTime: string;
  /** The whole entry: the sum of every leg's size. */
  size: number;
  /** Closed legs, earliest first. A leg still open has no exit here. */
  exits: TradingViewExitLeg[];
  /** Commission of the legs still open — charged on the entry, since nothing closed them. */
  openCommission: number;
  /** Every leg's problem, named with its trade number. `null` when there is none. */
  problem: string | null;
};

/**
 * Joins the trades TradingView split off one entry back into one position.
 *
 * Trades are one entry when direction, entry time, entry price and entry order
 * all agree. A trade with a problem is never joined: it stands alone, so the
 * problem stays on the row it belongs to and cannot skip its neighbours.
 */
export function groupTradingViewPositions(trades: TradingViewTrade[]): TradingViewPosition[] {
  const byEntry = new Map<string, TradingViewTrade[]>();
  const order: TradingViewTrade[][] = [];
  for (const t of trades) {
    if (t.problem) {
      order.push([t]);
      continue;
    }
    const key = [t.direction, t.entryTime, t.entryPrice, t.entrySignal].join("|");
    const group = byEntry.get(key);
    if (group) {
      group.push(t);
    } else {
      const fresh = [t];
      byEntry.set(key, fresh);
      order.push(fresh);
    }
  }

  return order.map((legs) => {
    const first = legs[0];
    const exits: TradingViewExitLeg[] = [];
    let openCommission = 0;
    for (const t of legs) {
      if (t.exitPrice != null && t.exitTime != null) {
        exits.push({ number: t.number, price: t.exitPrice, time: t.exitTime, size: t.size, commission: t.commission });
      } else {
        openCommission += t.commission;
      }
    }
    exits.sort((a, b) => a.time.localeCompare(b.time));
    const problems = legs
      .filter((t) => t.problem)
      .map((t) => (legs.length > 1 ? `#${t.number}: ${t.problem}` : t.problem!));
    return {
      numbers: legs.map((t) => t.number),
      direction: first.direction,
      entryPrice: first.entryPrice,
      entryTime: first.entryTime,
      size: legs.reduce((s, t) => s + t.size, 0),
      exits,
      openCommission,
      problem: problems.length > 0 ? problems.join("; ") : null,
    };
  });
}

/**
 * MAE and MFE as PRICES, from TradingView's own excursions, for a position whose
 * every leg is closed.
 *
 * Each leg reports its excursions in money, net of its entry commission (half
 * of the leg's commission; the other half is the exit's). Putting that back and
 * dividing by the leg's size in money per 1.00 of price gives the distance from
 * the entry. The position's extreme is the furthest across its legs, and never
 * nearer than a price it actually filled at.
 *
 * TradingView measures over WHOLE BARS of the chart, so the bar a stop was hit
 * in reaches past the stop: a long stopped at 1326.629 shows an adverse
 * excursion down to 1324.26. The position was closed at the stop, so when the
 * LAST exit is a stop at a loss the MAE is held to it, and when it is a take
 * profit the MFE is held to that. A stop at or beyond breakeven is NOT a bound:
 * it was moved there, and before it moved the price was free to go further.
 * Nor are earlier exits: the legs still open after them saw the prices beyond.
 *
 * `perUnit` is TradingView's money per 1.00 of price per 1 of its size: 1 when
 * it counts units, the point value when it counts contracts
 * (`resolveTradingViewScale`). Rounded to the finest decimals the fills carry.
 * `null` when any leg is open, has a problem, or carries no excursion.
 */
export function tradingViewExcursion(
  legs: readonly TradingViewTrade[],
  perUnit: number,
): { mae: number; mfe: number } | null {
  if (legs.length === 0 || !(perUnit > 0)) return null;
  const sign = legs[0].direction === "Short" ? -1 : 1;
  const entry = legs[0].entryPrice;
  let favorable = 0;
  let adverse = 0;
  const fills = [entry];
  for (const t of legs) {
    if (t.problem || t.exitPrice == null || t.exitTime == null) return null;
    if (t.favorable == null || t.adverse == null || !(t.size > 0)) return null;
    const entryCommission = t.commission / 2;
    const money = t.size * perUnit;
    // A zero is TradingView's floor, "never went that way" — not a figure to
    // put the commission back onto.
    if (t.favorable > 0) favorable = Math.max(favorable, (t.favorable + entryCommission) / money);
    if (t.adverse < 0) adverse = Math.max(adverse, (-t.adverse - entryCommission) / money);
    fills.push(t.exitPrice);
  }
  let mfe = entry + sign * favorable;
  let mae = entry - sign * adverse;
  // Never nearer than a fill: an exit is a price the position certainly saw.
  const best = sign > 0 ? Math.max(...fills) : Math.min(...fills);
  const worst = sign > 0 ? Math.min(...fills) : Math.max(...fills);
  mfe = sign > 0 ? Math.max(mfe, best) : Math.min(mfe, best);
  mae = sign > 0 ? Math.min(mae, worst) : Math.max(mae, worst);

  const last = [...legs].sort((a, b) => (a.exitTime! < b.exitTime! ? -1 : 1)).at(-1)!;
  const signal = last.exitSignal.toLowerCase();
  const lastPrice = last.exitPrice!;
  const atLoss = sign * (lastPrice - entry) < 0;
  if (signal.includes("stop loss") && atLoss) {
    mae = sign > 0 ? Math.max(mae, lastPrice) : Math.min(mae, lastPrice);
  } else if (signal.includes("take profit")) {
    mfe = sign > 0 ? Math.min(mfe, lastPrice) : Math.max(mfe, lastPrice);
  }

  const decimals = Math.max(...fills.map(decimalsOf));
  const fix = (n: number) => Number(n.toFixed(decimals));
  return { mae: fix(mae), mfe: fix(mfe) };
}

function decimalsOf(n: number): number {
  const s = String(n);
  const dot = s.indexOf(".");
  return dot < 0 ? 0 : Math.min(s.length - dot - 1, 8);
}
