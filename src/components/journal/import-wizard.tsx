"use client";

import { pickableAccounts, primaryAccount } from "@/lib/journal/account-rules";
import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Upload, ArrowRight, CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Account } from "@/lib/journal/types";
import { parseImportTime, fmtInTz, DEFAULT_TZ, DAY_TIME } from "@/lib/journal/time";
import { parseImportNumber as num } from "@/lib/journal/import-number";
import { fmtNum } from "@/lib/journal/format";
import {
  instrumentsMatch,
  normalizeInstrumentSymbol,
} from "@/lib/journal/instrument-aliases";
import { matchImportRow, type MatchCandidate } from "@/lib/journal/import-match";
import {
  TRADINGVIEW_SHEET,
  groupTradingViewPositions,
  isTradingViewTrades,
  readTradingViewExport,
  resolveTradingViewScale,
  symbolFromTradingViewFilename,
  tradingViewExcursion,
  tradingViewPnlMismatch,
  type TradingViewExport,
} from "@/lib/journal/tradingview-export";
import {
  commitImport,
  type ImportExec,
  type ImportItem,
} from "@/app/(app)/import/actions";

export type { MatchCandidate };

type Canonical =
  | "instrument"
  | "direction"
  | "qty"
  | "entry_price"
  | "entry_time"
  | "exit_price"
  | "exit_time"
  | "fee"
  | "swap"
  | "profit"
  | "target";

const CANONICAL: { key: Canonical; label: string; required?: boolean }[] = [
  { key: "instrument", label: "Instrument", required: true },
  { key: "direction", label: "Direction", required: true },
  { key: "qty", label: "Quantity / Size", required: true },
  { key: "entry_price", label: "Entry Price", required: true },
  { key: "entry_time", label: "Entry Time", required: true },
  { key: "exit_price", label: "Exit Price" },
  { key: "exit_time", label: "Exit Time" },
  { key: "fee", label: "Fee / Commission" },
  { key: "swap", label: "Swap / Funding" },
  { key: "profit", label: "Profit / P&L (bruto)" },
  // Target, and deliberately NOT stop loss.
  //
  // A statement states the stop AS IT STOOD AT THE END. A stop moved to
  // breakeven during the trade is the commonest thing a swing trader does, and
  // importing that number would overwrite the stop the risk was actually taken
  // with — every R on the trade recomputed against a stop that was never risked.
  // The target has no such trap: it is where the trade was aiming, and a trade
  // that has none gains one from the file rather than losing one it had (see
  // `commitImport`).
  { key: "target", label: "Target / T/P" },
];

const KEYWORDS: Record<Canonical, string[]> = {
  instrument: ["symbol", "instrument", "ticker", "market", "pair"],
  direction: ["direction", "side", "action", "b/s", "type"],
  qty: ["qty", "quantity", "size", "volume", "lots", "contracts", "shares", "units"],
  entry_price: ["entry price", "open price", "entryprice", "openprice", "price in", "entry"],
  entry_time: ["entry time", "open time", "opentime", "time in", "entry date", "open"],
  exit_price: ["exit price", "close price", "closeprice", "price out", "exit"],
  exit_time: ["exit time", "close time", "closetime", "time out", "exit date", "close"],
  fee: ["commission", "fee", "comm", "fees"],
  swap: ["swap", "funding", "rollover"],
  // Deliberately after `swap` in the auto-mapping order: broker statements
  // often carry both "Swap" and "Profit", and `includes` on "profit" would also
  // hit a "Gross profit" column. The order in CANONICAL decides who claims a
  // header first.
  profit: ["profit", "p/l", "pnl", "p&l", "net p", "gross p", "result", "realized"],
  target: ["t/p", "take profit", "takeprofit", "target"],
};

function autoMap(headers: string[]): Record<Canonical, string> {
  const map = {} as Record<Canonical, string>;
  for (const { key } of CANONICAL) {
    const found = headers.find((h) =>
      KEYWORDS[key].some((kw) => h.toLowerCase().includes(kw)),
    );
    map[key] = found ?? "";
  }
  return map;
}

/** Columns of the one-row-per-trade table a TradingView export is flattened into. */
const TV_MAP: Record<Canonical, string> = {
  instrument: "Symbol",
  direction: "Side",
  qty: "Qty",
  entry_price: "Entry price",
  entry_time: "Entry time",
  exit_price: "Exit price",
  exit_time: "Exit time",
  fee: "Commission",
  swap: "",
  // Not mapped on purpose: the money is derived from prices × point value ×
  // the account's rate, which the size check has just proven equal to
  // TradingView's own result. An override would also skip the FX conversion.
  profit: "",
  // TradingView exports fills, not orders: there is no T/P column to map.
  target: "",
};
const TV_ISSUE = "Issue";
/**
 * The row's own result, as a number the matcher can compare.
 *
 * Not the `profit` mapping: that one is a broker's GROSS figure and is written
 * onto the trade. This is only ever read, to recognise a hand-typed trade whose
 * size was stated differently — see `import-match.ts`.
 */
const NET_RESULT = "Net result";

/**
 * The fills of a row whose source already knows them one by one — a position
 * TradingView closed in several exits. The flat row cannot carry more than one
 * exit, so these travel beside it, in the same order.
 */
type FillPlan = {
  /** Commission of legs still open, charged on the entry. */
  entryFee: number;
  exits: { price: number; qty: number; time: string; fee: number }[];
  /** MAE/MFE prices off TradingView's own excursions, when every leg closed. */
  excursion: { mae: number; mfe: number } | null;
};

/**
 * A row under review. `_blocked` is set when a key cell could not be read:
 * "merge" means the row may be created by hand but never merged, "all" that it
 * has no fill at all and can only be skipped.
 */
type ReviewItem = ImportItem & {
  _diff?: string[];
  _candidates?: MatchCandidate[];
  _blocked?: "merge" | "all";
};

/** Rows sent per request: each chunk commits well inside the platform's time limit. */
const COMMIT_CHUNK = 50;

/** A price as the file wrote it, without the two-decimal rounding that hid a changed fill. */
function px(n: number | null | undefined): string {
  return n == null || !Number.isFinite(n) ? "—" : String(Number(n.toFixed(6)));
}

/**
 * Whether two numbers differ beyond floating-point noise, relative to their size:
 * a flat 1e-9 is noise on a 0.0001 price and a real change on 20,000.
 */
function differs(a: number, b: number): boolean {
  return Math.abs(a - b) > 1e-9 * Math.max(1, Math.abs(a));
}

/** An instrument's point value, the one figure the TradingView size check needs. */
export type ImportInstrument = { symbol: string; point_value: number | null };

function normDirection(v: string | undefined): string | null {
  const s = (v ?? "").toLowerCase();
  if (!s) return null;
  if (s.includes("sell") || s.includes("short") || s === "s") return "Short";
  if (s.includes("buy") || s.includes("long") || s === "b") return "Long";
  return v ?? null;
}

export function ImportWizard({
  accounts,
  candidates,
  instruments = [],
}: {
  accounts: Account[];
  candidates: MatchCandidate[];
  instruments?: ImportInstrument[];
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [accountId, setAccountId] = useState<string>(
    primaryAccount(accounts)?.id ?? "",
  );
  const account = accounts.find((a) => a.id === accountId) ?? null;
  const tz = account?.timezone ?? DEFAULT_TZ;
  /**
   * The zone the TradingView chart was in, which is NOT the account's.
   *
   * The export writes the chart's wall clock with no offset. It used to be read
   * in the account's zone, and a chart on New York time imported into a
   * Belgrade account put every fill six hours early — checked against the
   * market's own 1-minute candles, 1 of 7 fills landed in a bar that traded its
   * price under that reading, and 7 of 7 under New York. New York is the
   * default because it is where TradingView users on US instruments and on
   * forex most often leave the chart; it is a select because it is a fact
   * about the chart that only the trader knows.
   */
  const [fileTz, setFileTz] = useState("America/New_York");

  const [filename, setFilename] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [map, setMap] = useState<Record<Canonical, string>>(
    {} as Record<Canonical, string>,
  );
  const [items, setItems] = useState<ReviewItem[]>([]);
  // Set when the file is TradingView's list of trades; the column mapping is
  // then skipped, because the layout is known and a trade spans two rows.
  const [tv, setTv] = useState<{ symbol: string; data: TradingViewExport } | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFilename(file.name);
    setTv(null);
    try {
      let parsed: Record<string, string>[] = [];
      // TradingView's rows, read with their raw cell values: its dates are
      // Excel serials, and formatted as text they come out as "9/20/23 14:00",
      // which the time parser rightly refuses as ambiguous.
      let tvRows: Record<string, unknown>[] | null = null;
      if (file.name.toLowerCase().endsWith(".csv")) {
        const text = await file.text();
        const Papa = (await import("papaparse")).default;
        const res = Papa.parse<Record<string, string>>(text, {
          header: true,
          skipEmptyLines: true,
        });
        parsed = res.data;
        if (parsed.length > 0 && isTradingViewTrades(Object.keys(parsed[0]))) tvRows = parsed;
      } else {
        const buf = await file.arrayBuffer();
        const XLSX = await import("xlsx");
        const wb = XLSX.read(buf, { type: "array" });
        const tvSheet = wb.Sheets[TRADINGVIEW_SHEET];
        if (tvSheet) {
          const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(tvSheet, {
            defval: "",
            raw: true,
          });
          if (raw.length > 0 && isTradingViewTrades(Object.keys(raw[0]))) tvRows = raw;
        }
        if (!tvRows) {
          // A statement's dates as real dates, written out unambiguously. Read as
          // text they came out in whatever short form the cell was formatted with
          // ("3/5/26 14:30"), which the time parser rightly refuses. Read a second
          // time and only here: TradingView's own path needs the raw serials.
          const dated = XLSX.read(buf, { type: "array", cellDates: true });
          const ws = dated.Sheets[dated.SheetNames[0]];
          parsed = XLSX.utils.sheet_to_json(ws, {
            defval: "",
            raw: false,
            dateNF: "yyyy-mm-dd hh:mm:ss",
          });
        }
      }
      if (tvRows) {
        const symbol = symbolFromTradingViewFilename(file.name);
        const data = readTradingViewExport(tvRows);
        setHeaders([]);
        setRows([]);
        if (!symbol || !data) {
          toast.error(
            "TradingView export, but the symbol could not be read from the file name. " +
              "Keep the name TradingView gave it (…_EXCHANGE_SYMBOL_date_….xlsx).",
          );
          return;
        }
        setTv({ symbol, data });
        return;
      }
      if (parsed.length === 0) {
        toast.error("No rows found in file");
        return;
      }
      const hdrs = Object.keys(parsed[0]);
      setHeaders(hdrs);
      setRows(parsed);
      setMap(autoMap(hdrs));
    } catch (err) {
      toast.error("Failed to parse file");
      console.error(err);
    }
  }

  /**
   * TradingView trades as the flat table the row builder reads, or `null`
   * after saying why the file as a whole cannot be imported.
   */
  function tradingViewRows(): { rows: Record<string, string>[]; plans: FillPlan[] } | null {
    if (!tv) return null;
    const currency = tv.data.currency;
    if (account && account.currency !== currency) {
      toast.error(
        `TradingView's money is in ${currency}, the account "${account.name}" is in ${account.currency}. ` +
          `Pick a ${currency} account.`,
      );
      return null;
    }
    const instrument = normalizeInstrumentSymbol(tv.symbol);
    const pointValue = instruments.find((i) => i.symbol === instrument)?.point_value ?? null;
    if (pointValue == null) {
      toast.error(
        `${instrument ?? tv.symbol} is not in the instrument catalog. Add it in Settings → Instruments ` +
          "with its contract size, then import again — the size cannot be converted without it.",
      );
      return null;
    }
    const scale = resolveTradingViewScale(tv.data.trades, pointValue);
    if (!scale.ok) {
      toast.error(`The size cannot be matched to ${instrument}: ${scale.error}.`);
      return null;
    }
    // Each TradingView trade is held to the scale first, then the ones split
    // off one entry are joined back into one position.
    const checked = tv.data.trades.map((t) => ({
      ...t,
      problem: t.problem ?? tradingViewPnlMismatch(t, scale, pointValue),
    }));
    const byNumber = new Map(checked.map((t) => [t.number, t]));
    const lots = (size: number) => Number((size / scale.divisor).toFixed(8));
    const list = (f: (t: (typeof checked)[number]) => number | null, numbers: string[]) =>
      numbers.map((n) => f(byNumber.get(n)!)).map((v) => (v == null ? "" : String(v))).join(", ");

    const rows: Record<string, string>[] = [];
    const plans: FillPlan[] = [];
    for (const pos of groupTradingViewPositions(checked)) {
      const exits = pos.exits.map((e) => ({
        price: e.price,
        qty: lots(e.size),
        time: e.time,
        fee: e.commission,
      }));
      const openQty = pos.numbers
        .map((n) => byNumber.get(n)!)
        .filter((t) => t.exitPrice == null)
        .reduce((sum, t) => sum + lots(t.size), 0);
      // The entry is summed from the same rounded legs the exits carry, in the
      // same order `computeStatus` sums them, so a fully closed position reads
      // closed and not "partial" by a rounding residue.
      const qty = exits.reduce((sum, e) => sum + e.qty, 0) + openQty;
      const exitQty = exits.reduce((sum, e) => sum + e.qty, 0);
      const avgExit = exitQty > 0
        ? exits.reduce((sum, e) => sum + e.price * e.qty, 0) / exitQty
        : null;
      const fees = exits.reduce((sum, e) => sum + e.fee, 0) + pos.openCommission;
      // TradingView's money per 1.00 of price per 1 of its size.
      const excursion = tradingViewExcursion(
        pos.numbers.map((n) => byNumber.get(n)!),
        scale.unit === "units" ? 1 : pointValue,
      );
      rows.push({
        Symbol: tv.symbol,
        Side: pos.direction,
        Qty: String(qty),
        "Entry price": String(pos.entryPrice),
        "Entry time": pos.entryTime,
        // Read by the row builder only for matching and the review's
        // differences; the fills themselves come from the plan.
        "Exit price": avgExit == null ? "" : String(avgExit),
        "Exit time": exits.at(-1)?.time ?? "",
        Commission: String(fees),
        "TradingView trade": pos.numbers.join(", "),
        "TradingView size": list((t) => t.size, pos.numbers),
        "TradingView net P&L": list((t) => t.netPnl, pos.numbers),
        [NET_RESULT]: pos.exits.length > 0
          ? String(
              pos.numbers
                .map((n) => byNumber.get(n)!.netPnl)
                .reduce((sum: number, v) => sum + (v ?? 0), 0),
            )
          : "",
        "TradingView favorable excursion": list((t) => t.favorable, pos.numbers),
        "TradingView adverse excursion": list((t) => t.adverse, pos.numbers),
        "MAE / MFE": excursion ? `${excursion.mae} / ${excursion.mfe}` : "",
        [TV_ISSUE]: pos.problem ?? "",
      });
      plans.push({ entryFee: pos.openCommission, exits, excursion });
    }
    return { rows, plans };
  }

  /**
   * How an existing trade is named on screen.
   *
   * A suggestion asks the reader to recognise their own trade, so it has to
   * carry what they would recognise it by: its number, when it was opened, the
   * prices, and what it made.
   */
  function labelOf(cand: MatchCandidate): string {
    const parts = [cand.tradeNo != null ? `#${cand.tradeNo}` : "a trade"];
    if (cand.openedAt) parts.push(fmtInTz(cand.openedAt, tz, DAY_TIME));
    if (cand.avgEntry != null) {
      parts.push(
        cand.avgExit != null
          ? `${px(cand.avgEntry)}→${px(cand.avgExit)}`
          : px(cand.avgEntry),
      );
    }
    if (cand.netPl != null) parts.push(String(fmtNum(cand.netPl, 2)));
    return parts.join(" · ");
  }

  function buildItems() {
    if (tv) {
      const flat = tradingViewRows();
      if (flat) buildFrom(flat.rows, TV_MAP, TV_ISSUE, flat.plans, fileTz);
      return;
    }
    for (const req of ["instrument", "direction", "qty", "entry_price", "entry_time"] as Canonical[]) {
      if (!map[req]) {
        toast.error(`Map a column for "${req}"`);
        return;
      }
    }
    buildFrom(rows, map, null, null);
  }

  function buildFrom(
    rows: Record<string, string>[],
    map: Record<Canonical, string>,
    issueCol: string | null,
    plans: FillPlan[] | null,
    /** The zone the file's wall clock is in — the account's for a statement. */
    timeZone: string = tz,
  ) {
    const built: ReviewItem[] =
      rows.map((row, index) => {
      const instrument =
        normalizeInstrumentSymbol(row[map.instrument] ?? "") ?? null;
      const direction = normDirection(row[map.direction]);

      // Cells the parsers refused rather than guess at. Named on the row, not
      // swallowed: a refused price already shows as "—", but a refused qty or
      // fee falls back to 0 and looks like a real zero. `tj_replace_executions`
      // then drops a qty-0 fill outright, so the row would import as an empty
      // position with nothing saying which cell was the problem.
      const unreadable: string[] = [];
      const read = (col: string, label: string): number | null => {
        const raw = row[col];
        const n = num(raw);
        if (n == null && raw != null && raw.trim() !== "") unreadable.push(label);
        return n;
      };

      const qty = read(map.qty, "qty") ?? 0;
      const entryPrice = read(map.entry_price, "entry price");
      const entryTime = parseImportTime(row[map.entry_time], timeZone);
      if (!entryTime && row[map.entry_time]?.trim()) unreadable.push("entry time");
      const exitPrice = map.exit_price ? read(map.exit_price, "exit price") : null;
      const exitTime = map.exit_time ? parseImportTime(row[map.exit_time], timeZone) : null;
      if (map.exit_time && !exitTime && row[map.exit_time]?.trim())
        unreadable.push("exit time");
      const fee = (map.fee ? read(map.fee, "fee") : null) ?? 0;
      const swap = (map.swap ? read(map.swap, "swap") : null) ?? 0;
      // No `?? 0`: an unmapped profit column means "compute from prices", while
      // a zero would mean "the trade finished flat". That difference is the
      // whole point of the field.
      const profit = map.profit ? read(map.profit, "profit") : null;
      // Written only onto a trade that has no target yet — see `commitImport`.
      const target = map.target ? read(map.target, "target") : null;

      // A quantity of zero is the same as an unread cell, and has to be seen as
      // one. `read` flagged only a cell the parser COULD NOT read; a literal
      // "0" passed as a real value, and then `tj_save_trade` (like
      // `tj_replace_executions` before it) drops a fill with `qty <= 0` through
      // its WHERE. The row would import as an empty position, with no fills and
      // not a word about why.
      if (qty <= 0 && !unreadable.includes("qty")) unreadable.push("qty");

      const execs: ImportExec[] = [];
      const plan = plans?.[index] ?? null;
      if (plan) {
        // Fills known one by one: the entry, then each exit with its own time,
        // size and commission.
        if (entryPrice != null && entryTime && qty > 0) {
          execs.push({
            side: "entry",
            price: entryPrice,
            qty,
            executed_at: entryTime,
            fee: plan.entryFee,
            swap_funding: 0,
          });
        }
        for (const leg of plan.exits) {
          const at = parseImportTime(leg.time, timeZone);
          if (!at) {
            unreadable.push("exit time");
            continue;
          }
          execs.push({ side: "exit", price: leg.price, qty: leg.qty, executed_at: at, fee: leg.fee, swap_funding: 0 });
        }
      }
      const hasExit = exitPrice != null && (exitTime ?? entryTime) != null;
      // A fill of zero size is not built: the server refuses it, and one such
      // fill used to fail the whole row with an `executions.0.qty` error.
      if (!plan && entryPrice != null && entryTime && qty > 0) {
        execs.push({
          side: "entry",
          price: entryPrice,
          qty,
          executed_at: entryTime,
          // Costs go on the EXIT when there is an exit, otherwise on the entry.
          //
          // They used to sit on the exit unconditionally, so an open position —
          // a statement row with no exit price — lost its commission and swap
          // entirely. It was not a visible error: the trade imports, its net
          // result is simply too high by the amount actually paid.
          fee: hasExit ? 0 : fee,
          swap_funding: hasExit ? 0 : swap,
        });
      }
      // `?? new Date()` used to close this branch, and it was the worst line in
      // the import: a row whose timestamps could not be read got stamped with
      // the MOMENT OF IMPORT. A trade from three months ago then closed today —
      // landing in today's P&L, today's calendar cell and today's week, with
      // nothing on screen to say the date was invented rather than read.
      //
      // Falling back to the entry time is kept: a same-row entry timestamp is a
      // real observation about this trade, just a less precise one. Inventing
      // "now" is not an observation about anything.
      const exitAt = exitTime ?? entryTime;
      if (!plan && exitPrice != null && exitAt && qty > 0) {
        execs.push({
          side: "exit",
          price: exitPrice,
          qty,
          executed_at: exitAt,
          fee,
          swap_funding: swap,
        });
      }

      // Matching lives in `import-match.ts` — the decision that determines
      // whether an existing trade gets OVERWRITTEN must not be an untested loop
      // inside a 572-line component.
      const exitQtyTotal = execs
        .filter((e) => e.side === "exit")
        .reduce((sum, e) => sum + e.qty, 0);
      const avgExitPrice = exitQtyTotal > 0
        ? execs
            .filter((e) => e.side === "exit")
            .reduce((sum, e) => sum + e.price * e.qty, 0) / exitQtyTotal
        : null;
      const outcome = matchImportRow(
        {
          instrument,
          direction,
          entryPrice,
          entryTime,
          entryQty: qty > 0 ? qty : null,
          exitPrice: avgExitPrice,
          pnl: row[NET_RESULT] ? num(row[NET_RESULT]) : profit,
          // Which money that is, so it is held to the same figure on the trade:
          // TradingView's result is net, a broker's profit column gross.
          pnlBasis: row[NET_RESULT] ? "net" : profit != null ? "gross" : undefined,
          accountId,
        },
        candidates,
        instrumentsMatch,
      );
      const matched = outcome.matched;

      const diff: string[] = [];
      let status: ImportItem["match_status"] = outcome.status === "ambiguous"
        ? "ambiguous"
        : "new";
      let decision: ImportItem["decision"] = "create";
      if (outcome.status === "ambiguous") {
        // Visible, and created by default. If this row merged into the wrong
        // trade, `tj_replace_executions` would delete the fills of the right
        // one — but the reader can now point it at one of the candidates, and a
        // deliberate choice is not a guess.
        diff.push(
          `${outcome.candidates.length} existing trades match — pick one or create`,
        );
      }
      if (matched) {
        status = outcome.status === "suggested" ? "suggested" : "match";
        decision = "merge";
        if (outcome.status === "suggested") {
          // The whole reason this row is offered rather than created: it is the
          // trade already typed by hand, and the file is about to correct its
          // objective half — starting with the time, which is the thing that
          // kept the two apart.
          diff.push(`same trade as ${labelOf(matched)}`);
        }
        // Time and size on EVERY match, not only a suggested one. An exact match
        // whose size or time the file corrects was otherwise read as a duplicate
        // and skipped — the correction never landed. A minute's slack: files
        // round seconds differently.
        if (
          matched.openedAt &&
          entryTime &&
          Math.abs(Date.parse(matched.openedAt) - Date.parse(entryTime)) > 60_000
        ) {
          diff.push(
            `opened ${fmtInTz(matched.openedAt, tz, DAY_TIME)}→${fmtInTz(entryTime, tz, DAY_TIME)}`,
          );
        }
        if (matched.entryQty != null && qty > 0 && differs(matched.entryQty, qty)) {
          diff.push(`size ${px(matched.entryQty)}→${px(qty)}`);
        }
        if (entryPrice != null && matched.avgEntry != null && differs(matched.avgEntry, entryPrice))
          diff.push(`entry ${px(matched.avgEntry)}→${px(entryPrice)}`);
        if (avgExitPrice != null && matched.avgExit != null && differs(matched.avgExit, avgExitPrice))
          diff.push(`exit ${px(matched.avgExit)}→${px(avgExitPrice)}`);
        // Commission and swap are compared SEPARATELY. They used to be summed
        // into one number, so a statement correcting the swap but not the
        // commission (or the other way round) passed as "fees match" whenever
        // the two differences cancelled out.
        if (matched.totalFees != null && differs(matched.totalFees, fee))
          diff.push(`fee ${fmtNum(matched.totalFees, 2)}→${fmtNum(fee, 2)}`);
        if (matched.totalSwap != null && differs(matched.totalSwap, swap))
          diff.push(`swap ${fmtNum(matched.totalSwap, 2)}→${fmtNum(swap, 2)}`);
        // The statement's result against what the trade currently shows. This is
        // the check that makes an import worth running when the trades were
        // already entered by hand: the broker is authoritative for money, the
        // human for everything else.
        if (profit != null && matched.grossPl != null && differs(matched.grossPl, profit))
          diff.push(`profit ${fmtNum(matched.grossPl, 2)}→${fmtNum(profit, 2)}`);
        else if (profit != null && matched.grossPl == null)
          diff.push(`profit —→${fmtNum(profit, 2)}`);
        if (diff.length === 0) {
          status = "duplicate";
          decision = "skip";
        }
      }

      // A row the source itself marked as not importable as read. Skipped by
      // default and named first, so it is the first thing read on the row;
      // the decision stays the reader's to change.
      const issue = issueCol ? row[issueCol] : "";
      if (issue) {
        diff.unshift(issue);
        decision = "skip";
      }

      // A key cell the parser could not read means the row is not the trade the
      // file describes, and merging it would replace a trade's fills with a
      // guess. Skipped; created by hand only if at least one fill was read.
      const keyUnreadable: string[] = unreadable.filter((u) =>
        u === "qty" || u === "entry price" || u === "entry time",
      );
      let blocked: ReviewItem["_blocked"];
      if (execs.length === 0 || keyUnreadable.length > 0) {
        blocked = execs.length === 0 ? "all" : "merge";
        decision = "skip";
        diff.unshift(
          keyUnreadable.length > 0
            ? `cannot merge: unreadable ${keyUnreadable.join(", ")}`
            : "cannot import: no fill could be read",
        );
      }

      return {
        decision,
        match_status: status,
        matched_position_id: matched?.id ?? null,
        // Offered in the review when there is more than one: an ambiguous row
        // used to be created and nothing else, with no way to say which trade
        // it was. Pointing at one is a deliberate act, and that is the
        // difference from guessing.
        _candidates: outcome.candidates,
        instrument,
        direction,
        executions: execs,
        gross_pnl_override: profit,
        target_price: target != null && target > 0 ? target : null,
        excursion: plan?.excursion
          ? { mae_price: plan.excursion.mae, mfe_price: plan.excursion.mfe }
          : null,
        raw: row,
        _blocked: blocked,
        // After the duplicate check above, so an unreadable cell never changes
        // how a row is MATCHED — it only makes sure the reader is told. The key
        // cells are already named in the "cannot merge" line above.
        _diff: (() => {
          const rest = unreadable.filter((u) => !keyUnreadable.includes(u));
          return rest.length > 0 ? [...diff, `unreadable: ${rest.join(", ")}`] : diff;
        })(),
      };
    });

    // One row per trade. Two rows merging into one trade would each replace
    // its fills, the second erasing the first, and undo could only give one
    // back. The first row in the file keeps the merge; the rest are named and
    // skipped for the reader to decide.
    const firstRowFor = new Map<string, number>();
    built.forEach((it, i) => {
      if (it.decision !== "merge" || !it.matched_position_id) return;
      const first = firstRowFor.get(it.matched_position_id);
      if (first == null) {
        firstRowFor.set(it.matched_position_id, i);
        return;
      }
      it.decision = "skip";
      it.match_status = "ambiguous";
      it._diff = [`same trade as row ${first + 1}`, ...(it._diff ?? [])];
    });

    setItems(built);
    setStep(2);
  }

  const counts = useMemo(() => {
    const c = { create: 0, merge: 0, skip: 0, suggested: 0 };
    for (const it of items) {
      c[it.decision]++;
      if (it.match_status === "suggested") c.suggested++;
    }
    return c;
  }, [items]);

  /** The row, other than `except`, already merging into this trade — or -1. */
  function mergingInto(positionId: string | null, except: number): number {
    if (!positionId) return -1;
    return items.findIndex(
      (it, idx) => idx !== except && it.decision === "merge" && it.matched_position_id === positionId,
    );
  }

  function setDecision(i: number, decision: ImportItem["decision"]) {
    if (decision === "merge") {
      const other = mergingInto(items[i]?.matched_position_id ?? null, i);
      if (other >= 0) {
        toast.error(`Row ${other + 1} already merges into this trade.`);
        return;
      }
    }
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, decision } : it)));
  }

  /**
   * Point a row at one of the trades it could be.
   *
   * Choosing a candidate also switches the row to merge: picking the trade and
   * then being asked again what to do with it is one question too many, and the
   * decision select is still there to take it back.
   */
  function setMergeTarget(i: number, positionId: string) {
    const other = mergingInto(positionId || null, i);
    if (other >= 0) {
      toast.error(`Row ${other + 1} already merges into this trade.`);
      return;
    }
    setItems((prev) =>
      prev.map((it, idx) =>
        idx === i
          ? {
              ...it,
              matched_position_id: positionId || null,
              decision: positionId ? "merge" : "create",
            }
          : it,
      ),
    );
  }

  /** Rows sent so far, while a commit runs in chunks. */
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  function commit() {
    const payload = items.map(({ _diff, _candidates, _blocked, ...it }) => it);
    start(async () => {
      // In chunks, each its own request: one request for a year of trades ran
      // into the platform's time limit and left the batch half-written with no
      // word of where it stopped. Every chunk after the first continues the
      // same batch, so the history shows one import and one undo.
      let batchId: string | undefined;
      const sum = { created: 0, merged: 0, skipped: 0, failed: 0 };
      const errors: { row: number; instrument: string | null; error: string }[] = [];
      setProgress({ done: 0, total: payload.length });
      for (let offset = 0; offset < payload.length; offset += COMMIT_CHUNK) {
        let res: Awaited<ReturnType<typeof commitImport>>;
        try {
          res = await commitImport({
            account_id: accountId || null,
            filename,
            items: payload.slice(offset, offset + COMMIT_CHUNK),
            ...(batchId ? { batch_id: batchId, row_offset: offset } : {}),
          });
        } catch (e) {
          res = { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
        if (!res.ok) {
          setProgress(null);
          toast.error(
            offset === 0
              ? res.error
              : `Imported ${offset} of ${payload.length} rows — the rest were not sent. Undo from history if needed.`,
            offset === 0 ? undefined : { description: res.error, duration: 15_000 },
          );
          if (offset > 0) router.refresh();
          return;
        }
        batchId = res.batch_id;
        sum.created += res.created;
        sum.merged += res.merged;
        sum.skipped += res.skipped;
        sum.failed += res.failed;
        errors.push(...res.errors);
        setProgress({ done: Math.min(offset + COMMIT_CHUNK, payload.length), total: payload.length });
      }
      setProgress(null);
      toast.success(
        `Imported: ${sum.created} created, ${sum.merged} merged, ${sum.skipped} skipped`,
      );
      // A silent "N failed" is not actionable. Name the rows and the reason.
      if (sum.failed > 0) {
        const detail = errors
          .slice(0, 3)
          .map((e) => `row ${e.row}${e.instrument ? ` (${e.instrument})` : ""}: ${e.error}`)
          .join("\n");
        const more = errors.length > 3 ? `\n…and ${errors.length - 3} more` : "";
        toast.error(`${sum.failed} row(s) failed`, {
          description: `${detail}${more}`,
          duration: 15_000,
        });
      }
      setStep(3);
      router.refresh();
    });
  }

  if (step === 3) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <CheckCircle2 className="size-10 text-[var(--profit)]" />
          <h2 className="text-lg font-semibold">Import complete</h2>
          <p className="text-muted-foreground">
            Subjective fields (emotions, model, grade…) on merged trades were
            preserved.
          </p>
          <div className="flex gap-2">
            <Button onClick={() => router.push("/journal")}>Go to Journal</Button>
            <Button
              variant="outline"
              onClick={() => {
                setStep(1);
                setRows([]);
                setItems([]);
                setFilename("");
                setTv(null);
              }}
            >
              Import another
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Step 1: upload + map */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">1 — Upload & map columns</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Account</label>
                <Select value={accountId} onValueChange={setAccountId}>
                  <SelectTrigger className="w-48">
                    <SelectValue placeholder="Account" />
                  </SelectTrigger>
                  <SelectContent>
                    {pickableAccounts(accounts, accountId).map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name} ({a.timezone.replace("_", " ")})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={onFile}
              />
              <Button variant="outline" onClick={() => fileRef.current?.click()}>
                <Upload className="size-4" /> Choose CSV / Excel
              </Button>
              {filename && (
                <span className="text-sm text-muted-foreground">
                  {filename} — {tv ? `${tv.data.trades.length} trades` : `${rows.length} rows`}
                </span>
              )}
            </div>

            {tv && (
              <>
                <div className="space-y-1 text-sm text-muted-foreground">
                  <p>
                    TradingView export — <b>{tv.symbol}</b>, {tv.data.trades.length} trades,
                    money in {tv.data.currency}. Entry and exit rows are joined into one
                    trade, and the size is converted to lots and checked against each
                    trade&apos;s own P&amp;L.
                  </p>
                </div>
                <div className="max-w-xs space-y-1">
                  <label className="text-xs text-muted-foreground">
                    Timezone of the TradingView chart
                  </label>
                  <Select value={fileTz} onValueChange={setFileTz}>
                    <SelectTrigger aria-label="Timezone of the TradingView chart">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from(
                        new Set(["America/New_York", "UTC", "Europe/London", tz]),
                      ).map((zone) => (
                        <SelectItem key={zone} value={zone}>
                          {zone.replace("_", " ")}
                          {zone === tz ? " (account)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    The export has no timezone in it — pick the one set at the
                    bottom-right of the chart. Times are shown back in the
                    account&apos;s zone.
                  </p>
                </div>
                <div className="flex justify-end">
                  <Button onClick={buildItems}>
                    Reconcile <ArrowRight className="size-4" />
                  </Button>
                </div>
              </>
            )}

            {headers.length > 0 && (
              <>
                <p className="text-sm text-muted-foreground">
                  Times are read as <b>{tz.replace("_", " ")}</b> wall-clock
                  unless the value has an offset.
                </p>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {CANONICAL.map(({ key, label, required }) => (
                    <div key={key} className="space-y-1">
                      <label className="text-xs text-muted-foreground">
                        {label}
                        {required && <span className="text-destructive"> *</span>}
                      </label>
                      <Select
                        value={map[key] || "__none"}
                        onValueChange={(v) =>
                          setMap((m) => ({ ...m, [key]: v === "__none" ? "" : v }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="—" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none">— none —</SelectItem>
                          {headers.map((h) => (
                            <SelectItem key={h} value={h}>
                              {h}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
                <div className="flex justify-end">
                  <Button onClick={buildItems}>
                    Reconcile <ArrowRight className="size-4" />
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Step 2: review */}
      {step === 2 && (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-base">2 — Review & reconcile</CardTitle>
            <div className="flex gap-2 text-xs">
              <Badge variant="secondary">{counts.create} create</Badge>
              <Badge variant="secondary">{counts.merge} merge</Badge>
              <Badge variant="secondary">{counts.skip} skip</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-muted-foreground">
                  <tr>
                    <th className="p-2 font-medium">Instrument</th>
                    <th className="p-2 font-medium">Dir</th>
                    <th className="p-2 font-medium">Entry</th>
                    <th className="p-2 font-medium">Exit</th>
                    <th className="p-2 font-medium">Time ({tz})</th>
                    <th className="p-2 font-medium">Status</th>
                    <th className="p-2 font-medium">Differences</th>
                    <th className="p-2 font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, i) => {
                    const entry = it.executions.find((e) => e.side === "entry");
                    const exits = it.executions.filter((e) => e.side === "exit");
                    const exitQty = exits.reduce((sum, e) => sum + e.qty, 0);
                    // Size-weighted over every exit: a position closed in parts
                    // shows where it was closed on average, not its first part.
                    const exitAvg = exitQty > 0
                      ? exits.reduce((sum, e) => sum + e.price * e.qty, 0) / exitQty
                      : null;
                    return (
                      <tr key={i} className="border-t">
                        <td className="p-2 font-mono">{it.instrument ?? "—"}</td>
                        <td className="p-2">{it.direction ?? "—"}</td>
                        <td className="p-2">{px(entry?.price)}</td>
                        <td className="p-2">
                          {px(exitAvg)}
                          {exits.length > 1 && (
                            <span className="text-xs text-muted-foreground"> ({exits.length} exits)</span>
                          )}
                        </td>
                        <td className="p-2 whitespace-nowrap">
                          {entry ? fmtInTz(entry.executed_at, tz, DAY_TIME) : "—"}
                        </td>
                        <td className="p-2">
                          <StatusBadge status={it.match_status} />
                        </td>
                        <td className="p-2 text-xs text-[var(--chart-4)]">
                          {it._diff && it._diff.length > 0 ? (
                            <span className="inline-flex items-center gap-1">
                              <AlertTriangle className="size-3" />
                              {it._diff.join(", ")}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="p-2 space-y-1">
                          {/* More than one trade this row could be. Naming them
                              and letting the reader choose is the only honest
                              way out: the matcher refuses to guess, and until
                              now that left the row with no way to be merged at
                              all. */}
                          {(it._candidates?.length ?? 0) > 1 && (
                            <Select
                              value={it.matched_position_id ?? "__none"}
                              onValueChange={(v) =>
                                setMergeTarget(i, v === "__none" ? "" : v)
                              }
                            >
                              <SelectTrigger className="h-8 w-56">
                                <SelectValue placeholder="Merge into…" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none">— none —</SelectItem>
                                {it._candidates!.map((cand) => {
                                  const taken = mergingInto(cand.id, i);
                                  return (
                                    <SelectItem key={cand.id} value={cand.id} disabled={taken >= 0}>
                                      {labelOf(cand)}
                                      {taken >= 0 ? ` (row ${taken + 1})` : ""}
                                    </SelectItem>
                                  );
                                })}
                              </SelectContent>
                            </Select>
                          )}
                          <Select
                            value={it.decision}
                            onValueChange={(v) =>
                              setDecision(i, v as ImportItem["decision"])
                            }
                          >
                            <SelectTrigger className="h-8 w-28">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="create" disabled={it._blocked === "all"}>
                                Create new
                              </SelectItem>
                              <SelectItem
                                value="merge"
                                disabled={!it.matched_position_id || it._blocked != null}
                              >
                                Merge
                              </SelectItem>
                              <SelectItem value="skip">Skip</SelectItem>
                            </SelectContent>
                          </Select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">
              Merge updates only objective numbers (prices, times, qty, fees) —
              your emotions, ICT model, grade and notes are kept.
              {counts.suggested > 0 && (
                <>
                  {" "}
                  <b>{counts.suggested}</b>{" "}
                  {counts.suggested === 1 ? "row was" : "rows were"} recognised as a
                  trade already in the journal, matched on prices and size rather
                  than on the time — check the trade named on each before
                  committing.
                </>
              )}
            </p>
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button onClick={commit} disabled={pending}>
                {pending
                  ? progress
                    ? `Importing ${progress.done} / ${progress.total}…`
                    : "Importing…"
                  : `Commit — create ${counts.create} · merge ${counts.merge} · skip ${counts.skip}`}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: ImportItem["match_status"] }) {
  const map: Record<string, string> = {
    new: "bg-[var(--chart-3)]/20 text-[var(--chart-3)]",
    match: "bg-[var(--chart-4)]/20 text-[var(--chart-4)]",
    suggested: "bg-[var(--chart-4)]/20 text-[var(--chart-4)]",
    duplicate: "bg-muted text-muted-foreground",
    ambiguous: "bg-[var(--loss)]/20 text-[var(--loss)]",
  };
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs ${map[status] ?? ""}`}>
      {status}
    </span>
  );
}
