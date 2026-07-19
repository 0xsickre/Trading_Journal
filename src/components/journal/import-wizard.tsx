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
import { parseImportTime, fmtInTz } from "@/lib/journal/time";
import { fmtMoney, fmtNum } from "@/lib/journal/format";
import {
  instrumentsMatch,
  normalizeInstrumentSymbol,
} from "@/lib/journal/instrument-aliases";
import {
  commitImport,
  type ImportExec,
  type ImportItem,
} from "@/app/(app)/import/actions";

export type MatchCandidate = {
  id: string;
  instrument: string | null;
  direction: string | null;
  avgEntry: number | null;
  avgExit: number | null;
  openedAt: string | null;
  totalFees: number | null;
  netPl: number | null;
};

type Canonical =
  | "instrument"
  | "direction"
  | "qty"
  | "entry_price"
  | "entry_time"
  | "exit_price"
  | "exit_time"
  | "fee"
  | "swap";

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

function num(v: string | undefined): number | null {
  if (v == null) return null;
  const cleaned = String(v).replace(/[^0-9.\-]/g, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

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
}: {
  accounts: Account[];
  candidates: MatchCandidate[];
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [accountId, setAccountId] = useState<string>(
    accounts.find((a) => a.is_active)?.id ?? accounts[0]?.id ?? "",
  );
  const account = accounts.find((a) => a.id === accountId) ?? null;
  const tz = account?.timezone ?? "America/New_York";
  const currency = account?.currency ?? "USD";

  const [filename, setFilename] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [map, setMap] = useState<Record<Canonical, string>>(
    {} as Record<Canonical, string>,
  );
  const [items, setItems] = useState<(ImportItem & { _diff?: string[] })[]>([]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFilename(file.name);
    try {
      let parsed: Record<string, string>[] = [];
      if (file.name.toLowerCase().endsWith(".csv")) {
        const text = await file.text();
        const Papa = (await import("papaparse")).default;
        const res = Papa.parse<Record<string, string>>(text, {
          header: true,
          skipEmptyLines: true,
        });
        parsed = res.data;
      } else {
        const buf = await file.arrayBuffer();
        const XLSX = await import("xlsx");
        const wb = XLSX.read(buf, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        parsed = XLSX.utils.sheet_to_json(ws, { defval: "", raw: false });
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

  function buildItems() {
    for (const req of ["instrument", "direction", "qty", "entry_price", "entry_time"] as Canonical[]) {
      if (!map[req]) {
        toast.error(`Map a column for "${req}"`);
        return;
      }
    }
    const built: (ImportItem & { _diff?: string[] })[] = rows.map((row) => {
      const instrument =
        normalizeInstrumentSymbol(row[map.instrument] ?? "") ?? null;
      const direction = normDirection(row[map.direction]);
      const qty = num(row[map.qty]) ?? 0;
      const entryPrice = num(row[map.entry_price]);
      const entryTime = parseImportTime(row[map.entry_time], tz);
      const exitPrice = map.exit_price ? num(row[map.exit_price]) : null;
      const exitTime = map.exit_time ? parseImportTime(row[map.exit_time], tz) : null;
      const fee = map.fee ? num(row[map.fee]) ?? 0 : 0;
      const swap = map.swap ? num(row[map.swap]) ?? 0 : 0;

      const execs: ImportExec[] = [];
      if (entryPrice != null && entryTime) {
        execs.push({ side: "entry", price: entryPrice, qty, executed_at: entryTime, fee: 0, swap_funding: 0 });
      }
      if (exitPrice != null) {
        execs.push({
          side: "exit",
          price: exitPrice,
          qty,
          executed_at: exitTime ?? entryTime ?? new Date().toISOString(),
          fee,
          swap_funding: swap,
        });
      }

      // matching
      let matched: MatchCandidate | null = null;
      const entryMs = entryTime ? new Date(entryTime).getTime() : null;
      for (const c of candidates) {
        if (!c.instrument || !instrument) continue;
        if (!instrumentsMatch(c.instrument, instrument)) continue;
        if ((c.direction ?? "").toLowerCase() !== (direction ?? "").toLowerCase())
          continue;
        const timeOk =
          entryMs != null && c.openedAt
            ? Math.abs(new Date(c.openedAt).getTime() - entryMs) < 10 * 60 * 1000
            : false;
        const priceOk =
          entryPrice != null && c.avgEntry != null
            ? Math.abs(c.avgEntry - entryPrice) <=
              Math.max(0.0005 * Math.abs(entryPrice), 0.01)
            : false;
        if (timeOk && priceOk) {
          matched = c;
          break;
        }
      }

      const diff: string[] = [];
      let status: ImportItem["match_status"] = "new";
      let decision: ImportItem["decision"] = "create";
      if (matched) {
        status = "match";
        decision = "merge";
        if (entryPrice != null && matched.avgEntry != null && Math.abs(matched.avgEntry - entryPrice) > 1e-9)
          diff.push(`entry ${fmtNum(matched.avgEntry, 2)}→${fmtNum(entryPrice, 2)}`);
        if (exitPrice != null && matched.avgExit != null && Math.abs(matched.avgExit - exitPrice) > 1e-9)
          diff.push(`exit ${fmtNum(matched.avgExit, 2)}→${fmtNum(exitPrice, 2)}`);
        if (matched.totalFees != null && Math.abs((matched.totalFees ?? 0) - (fee + swap)) > 1e-9)
          diff.push(`fees ${fmtNum(matched.totalFees, 2)}→${fmtNum(fee + swap, 2)}`);
        if (diff.length === 0) {
          status = "duplicate";
          decision = "skip";
        }
      }

      return {
        decision,
        match_status: status,
        matched_position_id: matched?.id ?? null,
        instrument,
        direction,
        executions: execs,
        raw: row,
        _diff: diff,
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
                  {filename} — {rows.length} rows
                </span>
              )}
            </div>

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
          <CardHeader className="flex-row items-center justify-between space-y-0">
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
