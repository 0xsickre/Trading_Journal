"use client";

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
import { parseImportTime, fmtInTz, DEFAULT_TZ } from "@/lib/journal/time";
import { parseImportNumber as num } from "@/lib/journal/import-number";
import { fmtNum } from "@/lib/journal/format";
import {
  instrumentsMatch,
  normalizeInstrumentSymbol,
} from "@/lib/journal/instrument-aliases";
import { matchImportRow, type MatchCandidate } from "@/lib/journal/import-match";
import {
  TRADINGVIEW_SHEET,
  isTradingViewTrades,
  readTradingViewExport,
  resolveTradingViewScale,
  symbolFromTradingViewFilename,
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
  | "profit";

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
};
const TV_ISSUE = "Issue";

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
    accounts.find((a) => a.is_active)?.id ?? accounts[0]?.id ?? "",
  );
  const account = accounts.find((a) => a.id === accountId) ?? null;
  const tz = account?.timezone ?? DEFAULT_TZ;

  const [filename, setFilename] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [map, setMap] = useState<Record<Canonical, string>>(
    {} as Record<Canonical, string>,
  );
  const [items, setItems] = useState<(ImportItem & { _diff?: string[] })[]>([]);
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
        const ws = wb.Sheets[wb.SheetNames[0]];
        parsed = XLSX.utils.sheet_to_json(ws, { defval: "", raw: false });
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
  function tradingViewRows(): Record<string, string>[] | null {
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
    const cell = (n: number | null) => (n == null ? "" : String(n));
    return tv.data.trades.map((t) => ({
      Symbol: tv.symbol,
      Side: t.direction,
      Qty: String(Number((t.size / scale.divisor).toFixed(8))),
      "Entry price": String(t.entryPrice),
      "Entry time": t.entryTime,
      "Exit price": cell(t.exitPrice),
      "Exit time": t.exitTime ?? "",
      Commission: String(t.commission),
      "TradingView trade": t.number,
      "TradingView size": String(t.size),
      "TradingView net P&L": cell(t.netPnl),
      "TradingView favorable excursion": cell(t.favorable),
      "TradingView adverse excursion": cell(t.adverse),
      [TV_ISSUE]: t.problem ?? tradingViewPnlMismatch(t, scale, pointValue) ?? "",
    }));
  }

  function buildItems() {
    if (tv) {
      const flat = tradingViewRows();
      if (flat) buildFrom(flat, TV_MAP, TV_ISSUE);
      return;
    }
    for (const req of ["instrument", "direction", "qty", "entry_price", "entry_time"] as Canonical[]) {
      if (!map[req]) {
        toast.error(`Map a column for "${req}"`);
        return;
      }
    }
    buildFrom(rows, map, null);
  }

  function buildFrom(
    rows: Record<string, string>[],
    map: Record<Canonical, string>,
    issueCol: string | null,
  ) {
    const built: (ImportItem & { _diff?: string[] })[] = rows.map((row) => {
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
      const entryTime = parseImportTime(row[map.entry_time], tz);
      if (!entryTime && row[map.entry_time]?.trim()) unreadable.push("entry time");
      const exitPrice = map.exit_price ? read(map.exit_price, "exit price") : null;
      const exitTime = map.exit_time ? parseImportTime(row[map.exit_time], tz) : null;
      if (map.exit_time && !exitTime && row[map.exit_time]?.trim())
        unreadable.push("exit time");
      const fee = (map.fee ? read(map.fee, "fee") : null) ?? 0;
      const swap = (map.swap ? read(map.swap, "swap") : null) ?? 0;
      // No `?? 0`: an unmapped profit column means "compute from prices", while
      // a zero would mean "the trade finished flat". That difference is the
      // whole point of the field.
      const profit = map.profit ? read(map.profit, "profit") : null;

      // A quantity of zero is the same as an unread cell, and has to be seen as
      // one. `read` flagged only a cell the parser COULD NOT read; a literal
      // "0" passed as a real value, and then `tj_save_trade` (like
      // `tj_replace_executions` before it) drops a fill with `qty <= 0` through
      // its WHERE. The row would import as an empty position, with no fills and
      // not a word about why.
      if (qty <= 0) unreadable.push("qty");

      const execs: ImportExec[] = [];
      const hasExit = exitPrice != null && (exitTime ?? entryTime) != null;
      if (entryPrice != null && entryTime) {
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
      if (exitPrice != null && exitAt) {
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
      const outcome = matchImportRow(
        { instrument, direction, entryPrice, entryTime },
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
        // Visible, and created. If this row merged into the wrong trade,
        // `tj_replace_executions` would delete the fills of the right one.
        diff.push(
          `${outcome.candidates.length} existing trades match — a new one is created`,
        );
      }
      if (matched) {
        status = "match";
        decision = "merge";
        if (entryPrice != null && matched.avgEntry != null && Math.abs(matched.avgEntry - entryPrice) > 1e-9)
          diff.push(`entry ${fmtNum(matched.avgEntry, 2)}→${fmtNum(entryPrice, 2)}`);
        if (exitPrice != null && matched.avgExit != null && Math.abs(matched.avgExit - exitPrice) > 1e-9)
          diff.push(`exit ${fmtNum(matched.avgExit, 2)}→${fmtNum(exitPrice, 2)}`);
        // Commission and swap are compared SEPARATELY. They used to be summed
        // into one number, so a statement correcting the swap but not the
        // commission (or the other way round) passed as "fees match" whenever
        // the two differences cancelled out.
        if (matched.totalFees != null && Math.abs(matched.totalFees - fee) > 1e-9)
          diff.push(`fee ${fmtNum(matched.totalFees, 2)}→${fmtNum(fee, 2)}`);
        if (matched.totalSwap != null && Math.abs(matched.totalSwap - swap) > 1e-9)
          diff.push(`swap ${fmtNum(matched.totalSwap, 2)}→${fmtNum(swap, 2)}`);
        // The statement's result against what the trade currently shows. This is
        // the check that makes an import worth running when the trades were
        // already entered by hand: the broker is authoritative for money, the
        // human for everything else.
        if (profit != null && matched.grossPl != null && Math.abs(matched.grossPl - profit) > 1e-9)
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

      return {
        decision,
        match_status: status,
        matched_position_id: matched?.id ?? null,
        instrument,
        direction,
        executions: execs,
        gross_pnl_override: profit,
        raw: row,
        // After the duplicate check above, so an unreadable cell never changes
        // how a row is MATCHED — it only makes sure the reader is told.
        _diff: unreadable.length > 0
          ? [...diff, `unreadable: ${unreadable.join(", ")}`]
          : diff,
      };
    });
    setItems(built);
    setStep(2);
  }

  const counts = useMemo(() => {
    const c = { create: 0, merge: 0, skip: 0 };
    for (const it of items) c[it.decision]++;
    return c;
  }, [items]);

  function setDecision(i: number, decision: ImportItem["decision"]) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, decision } : it)));
  }

  function commit() {
    start(async () => {
      const res = await commitImport({
        account_id: accountId || null,
        filename,
        items: items.map(({ _diff, ...it }) => it),
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(
        `Imported: ${res.created} created, ${res.merged} merged, ${res.skipped} skipped`,
      );
      // A silent "N failed" is not actionable. Name the rows and the reason.
      if (res.failed > 0) {
        const detail = res.errors
          .slice(0, 3)
          .map((e) => `row ${e.row}${e.instrument ? ` (${e.instrument})` : ""}: ${e.error}`)
          .join("\n");
        const more =
          res.errors.length > 3 ? `\n…and ${res.errors.length - 3} more` : "";
        toast.error(`${res.failed} row(s) failed`, {
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
                    {accounts.map((a) => (
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
                  <p>
                    Times are read as <b>{tz.replace("_", " ")}</b> wall-clock — the
                    chart&apos;s timezone in TradingView must be the same.
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
                    <th className="p-2 font-medium">Time (NY)</th>
                    <th className="p-2 font-medium">Status</th>
                    <th className="p-2 font-medium">Differences</th>
                    <th className="p-2 font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, i) => {
                    const entry = it.executions.find((e) => e.side === "entry");
                    const exit = it.executions.find((e) => e.side === "exit");
                    return (
                      <tr key={i} className="border-t">
                        <td className="p-2 font-mono">{it.instrument ?? "—"}</td>
                        <td className="p-2">{it.direction ?? "—"}</td>
                        <td className="p-2">{fmtNum(entry?.price, 2)}</td>
                        <td className="p-2">{exit ? fmtNum(exit.price, 2) : "—"}</td>
                        <td className="p-2 whitespace-nowrap">
                          {entry ? fmtInTz(entry.executed_at, tz, "MM/dd HH:mm") : "—"}
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
                        <td className="p-2">
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
                              <SelectItem value="create">Create new</SelectItem>
                              <SelectItem
                                value="merge"
                                disabled={!it.matched_position_id}
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
            </p>
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button onClick={commit} disabled={pending}>
                {pending ? "Importing…" : "Commit import"}
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
    duplicate: "bg-muted text-muted-foreground",
    ambiguous: "bg-[var(--loss)]/20 text-[var(--loss)]",
  };
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs ${map[status] ?? ""}`}>
      {status}
    </span>
  );
}
