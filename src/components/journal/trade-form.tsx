"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Plus,
  Trash2,
  ArrowDownToLine,
  ArrowUpFromLine,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EditableSelect } from "@/components/journal/editable-select";
import { TradeImages } from "@/components/journal/trade-images";
import { FORM_SECTIONS, type FieldConfig } from "@/lib/journal/form-config";
import type { Account, Instrument, OptionsMap } from "@/lib/journal/types";
import { fmtMoney, fmtR, pnlClass } from "@/lib/journal/format";
import { utcToZonedInput, zonedInputToUtc } from "@/lib/journal/time";
import {
  createTrade,
  updateTrade,
  type ExecutionInput,
} from "@/app/(app)/trades/actions";

type ExecRow = {
  side: "entry" | "exit";
  price: string;
  qty: string;
  executedLocal: string;
  fee: string;
  swap: string;
};

export type TradeFormInitial = {
  id: string;
  account_id: string | null;
  trade_no: number | null;
  fields: Record<string, string | number | null>;
  executions: {
    side: "entry" | "exit";
    price: number;
    qty: number;
    executed_at: string;
    fee: number;
    swap_funding: number;
  }[];
};

function n(v: string): number | null {
  if (v == null || v.trim() === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

export function TradeForm({
  optionsMap,
  instruments,
  accounts,
  initial,
}: {
  optionsMap: OptionsMap;
  instruments: Instrument[];
  accounts: Account[];
  initial?: TradeFormInitial;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const [accountId, setAccountId] = useState<string | null>(
    initial?.account_id ?? accounts.find((a) => a.is_active)?.id ?? accounts[0]?.id ?? null,
  );
  const account = accounts.find((a) => a.id === accountId) ?? null;
  const tz = account?.timezone ?? "America/New_York";
  const currency = account?.currency ?? "USD";

  const [tradeNo, setTradeNo] = useState<string>(
    initial?.trade_no != null ? String(initial.trade_no) : "",
  );
  const [fields, setFields] = useState<Record<string, string | number | null>>(
    initial?.fields ?? {},
  );

  const [execs, setExecs] = useState<ExecRow[]>(() => {
    if (initial && initial.executions.length > 0) {
      return initial.executions.map((e) => ({
        side: e.side,
        price: String(e.price),
        qty: String(e.qty),
        executedLocal: utcToZonedInput(e.executed_at, initial.account_id ? tz : tz),
        fee: String(e.fee ?? 0),
        swap: String(e.swap_funding ?? 0),
      }));
    }
    const nowLocal = utcToZonedInput(new Date().toISOString(), tz);
    return [
      { side: "entry", price: "", qty: "1", executedLocal: nowLocal, fee: "", swap: "" },
    ];
  });

  function setField(name: string, value: string | number | null) {
    setFields((prev) => ({ ...prev, [name]: value }));
  }

  const instrument = instruments.find((i) => i.symbol === fields.instrument);
  const pointValue = instrument?.point_value ?? 1;

  // ---- live metrics ----
  const metrics = useMemo(() => {
    const entries = execs.filter((e) => e.side === "entry");
    const exits = execs.filter((e) => e.side === "exit");
    const sum = (rows: ExecRow[], f: (e: ExecRow) => number) =>
      rows.reduce((s, e) => s + f(e), 0);

    const entryQty = sum(entries, (e) => n(e.qty) ?? 0);
    const entryNotional = sum(entries, (e) => (n(e.price) ?? 0) * (n(e.qty) ?? 0));
    const exitQty = sum(exits, (e) => n(e.qty) ?? 0);
    const exitNotional = sum(exits, (e) => (n(e.price) ?? 0) * (n(e.qty) ?? 0));
    const fees = sum(execs, (e) => (n(e.fee) ?? 0) + (n(e.swap) ?? 0));

    const avgEntry = entryQty > 0 ? entryNotional / entryQty : null;
    const avgExit = exitQty > 0 ? exitNotional / exitQty : null;
    const dir = String(fields.direction ?? "")
      .toLowerCase()
      .startsWith("short")
      ? -1
      : 1;
    const stop = n(String(fields.stop_price ?? ""));

    let grossPoints: number | null = null;
    let grossPl: number | null = null;
    let netPl: number | null = null;
    let r: number | null = null;
    if (avgEntry != null && exitQty > 0) {
      grossPoints = (exitNotional - avgEntry * exitQty) * dir;
      grossPl = grossPoints * pointValue;
      netPl = grossPl - fees;
      if (stop != null && Math.abs(avgEntry - stop) > 0) {
        r = grossPoints / (Math.abs(avgEntry - stop) * entryQty);
      }
    }

    // planned R:R
    const pe = n(String(fields.entry_price ?? ""));
    const pt = n(String(fields.target_price ?? ""));
    let plannedRR: number | null = null;
    if (pe != null && stop != null && pt != null && Math.abs(pe - stop) > 0) {
      plannedRR = Math.abs(pt - pe) / Math.abs(pe - stop);
    }

    // position size suggestion
    const riskPctStr = String(fields.risk_pct ?? "");
    const riskPct = riskPctStr ? Number(riskPctStr.replace("%", "")) : null;
    const balance = account?.starting_balance ?? 0;
    let sizeSuggestion: number | null = null;
    if (riskPct != null && pe != null && stop != null && Math.abs(pe - stop) > 0 && balance > 0) {
      const riskAmount = (balance * riskPct) / 100;
      sizeSuggestion = riskAmount / (Math.abs(pe - stop) * pointValue);
    }

    return { avgEntry, avgExit, entryQty, exitQty, grossPl, netPl, r, plannedRR, sizeSuggestion, fees };
  }, [execs, fields, pointValue, account]);

  function addExec(side: "entry" | "exit") {
    setExecs((prev) => [
      ...prev,
      {
        side,
        price: "",
        qty: side === "exit" ? "" : "1",
        executedLocal: utcToZonedInput(new Date().toISOString(), tz),
        fee: "",
        swap: "",
      },
    ]);
  }
  function setExec(i: number, patch: Partial<ExecRow>) {
    setExecs((prev) => prev.map((e, idx) => (idx === i ? { ...e, ...patch } : e)));
  }
  function removeExec(i: number) {
    setExecs((prev) => prev.filter((_, idx) => idx !== i));
  }

  function buildExecInputs(): ExecutionInput[] {
    return execs
      .filter((e) => n(e.price) != null && n(e.qty) != null)
      .map((e) => ({
        side: e.side,
        price: n(e.price)!,
        qty: n(e.qty)!,
        executed_at:
          zonedInputToUtc(e.executedLocal, tz) ?? new Date().toISOString(),
        fee: n(e.fee) ?? 0,
        swap_funding: n(e.swap) ?? 0,
      }));
  }

  function submit() {
    if (!fields.instrument) {
      toast.error("Pick an instrument.");
      return;
    }
    const payload = {
      account_id: accountId,
      trade_no: tradeNo ? Number(tradeNo) : null,
      fields,
      executions: buildExecInputs(),
    };
    start(async () => {
      const res = initial
        ? await updateTrade(initial.id, payload)
        : await createTrade(payload);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(initial ? "Trade updated" : "Trade saved");
      router.push("/journal");
      router.refresh();
    });
  }

  return (
    <div className="space-y-6 pb-24">
      {/* Top bar */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">
            {initial ? "Edit Trade" : "New Trade"}
          </h1>
          <p className="text-sm text-muted-foreground">
            Times shown in {tz.replace("_", " ")} ({currency}).
          </p>
        </div>
        <div className="flex items-end gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Account</Label>
            <Select
              value={accountId ?? undefined}
              onValueChange={(v) => setAccountId(v)}
            >
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Account" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Trade #</Label>
            <Input
              className="w-24"
              inputMode="numeric"
              value={tradeNo}
              onChange={(e) => setTradeNo(e.target.value)}
            />
          </div>
        </div>
      </div>

      {FORM_SECTIONS.map((section) => (
        <Card key={section.id}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{section.title}</CardTitle>
            {section.description && (
              <p className="text-sm text-muted-foreground">
                {section.description}
              </p>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              {section.fields.map((field) => (
                <FieldRenderer
                  key={field.name}
                  field={field}
                  value={fields[field.name]}
                  onChange={(v) => setField(field.name, v)}
                  optionsMap={optionsMap}
                  instruments={instruments}
                />
              ))}
            </div>

            {section.id === "risk" && (
              <ExecutionsEditor
                execs={execs}
                tz={tz}
                onAdd={addExec}
                onSet={setExec}
                onRemove={removeExec}
                metrics={metrics}
                currency={currency}
                pointSymbol={instrument?.symbol}
              />
            )}
          </CardContent>
        </Card>
      ))}

      {initial && <TradeImages positionId={initial.id} />}

      {/* Sticky action bar */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 p-3 backdrop-blur md:left-60">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Metric label="Net P/L" value={fmtMoney(metrics.netPl, currency, { sign: true })} cls={pnlClass(metrics.netPl)} />
            <Metric label="R" value={fmtR(metrics.r)} cls={pnlClass(metrics.r)} />
            {metrics.plannedRR != null && (
              <Metric label="Planned R:R" value={`1:${metrics.plannedRR.toFixed(2)}`} />
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => router.back()}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={pending}>
              {pending ? "Saving…" : initial ? "Update trade" : "Save trade"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`font-semibold ${cls ?? ""}`}>{value}</span>
    </div>
  );
}

function FieldRenderer({
  field,
  value,
  onChange,
  optionsMap,
  instruments,
}: {
  field: FieldConfig;
  value: string | number | null | undefined;
  onChange: (v: string | number | null) => void;
  optionsMap: OptionsMap;
  instruments: Instrument[];
}) {
  const colSpan = field.colSpan === 2 ? "sm:col-span-2" : "";

  if (field.type === "instrument") {
    return (
      <div className={`space-y-1.5 ${colSpan}`}>
        <Label className="text-xs">{field.label}</Label>
        <Select
          value={(value as string) || undefined}
          onValueChange={(v) => onChange(v)}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select instrument…" />
          </SelectTrigger>
          <SelectContent>
            {instruments.map((i) => (
              <SelectItem key={i.id} value={i.symbol}>
                {i.symbol}
                {i.name ? ` — ${i.name}` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  if (field.type === "select") {
    return (
      <div className={`space-y-1.5 ${colSpan}`}>
        <Label className="text-xs">{field.label}</Label>
        <EditableSelect
          listKey={field.listKey!}
          options={optionsMap[field.listKey!] ?? []}
          value={(value as string) ?? ""}
          onChange={(v) => onChange(v)}
        />
      </div>
    );
  }

  if (field.type === "url") {
    const url = ((value as string) ?? "").trim();
    const valid = /^https?:\/\//i.test(url);
    return (
      <div className={`space-y-1.5 ${colSpan}`}>
        <Label className="text-xs">{field.label}</Label>
        <div className="flex gap-2">
          <Input
            type="url"
            value={(value as string) ?? ""}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder}
          />
          {valid ? (
            <Button
              asChild
              variant="outline"
              size="icon"
              className="size-9 shrink-0"
              title="Open chart"
            >
              <a href={url} target="_blank" rel="noreferrer">
                <ExternalLink className="size-4" />
              </a>
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-9 shrink-0"
              disabled
              title="Enter a valid https:// link"
            >
              <ExternalLink className="size-4" />
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (field.type === "textarea") {
    return (
      <div className={`space-y-1.5 ${colSpan}`}>
        <Label className="text-xs">{field.label}</Label>
        <Textarea
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
        />
      </div>
    );
  }

  // number / text
  return (
    <div className={`space-y-1.5 ${colSpan}`}>
      <Label className="text-xs">{field.label}</Label>
      <Input
        inputMode={field.type === "number" ? "decimal" : "text"}
        value={(value as string) ?? ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.placeholder}
      />
    </div>
  );
}

function ExecutionsEditor({
  execs,
  tz,
  onAdd,
  onSet,
  onRemove,
  metrics,
  currency,
  pointSymbol,
}: {
  execs: ExecRow[];
  tz: string;
  onAdd: (side: "entry" | "exit") => void;
  onSet: (i: number, patch: Partial<ExecRow>) => void;
  onRemove: (i: number) => void;
  metrics: {
    avgEntry: number | null;
    avgExit: number | null;
    entryQty: number;
    exitQty: number;
    grossPl: number | null;
    netPl: number | null;
    r: number | null;
    sizeSuggestion: number | null;
    fees: number;
  };
  currency: string;
  pointSymbol?: string;
}) {
  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">
          Executions / Fills{" "}
          <span className="font-normal text-muted-foreground">
            ({tz.replace("_", " ")})
          </span>
        </h4>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => onAdd("entry")}>
            <ArrowDownToLine className="size-4" /> Entry fill
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => onAdd("exit")}>
            <ArrowUpFromLine className="size-4" /> Partial exit
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        {execs.map((e, i) => (
          <div
            key={i}
            className="grid grid-cols-12 items-end gap-2 rounded-md border bg-background p-2"
          >
            <div className="col-span-12 sm:col-span-2">
              <Label className="text-[11px] text-muted-foreground">Side</Label>
              <Select
                value={e.side}
                onValueChange={(v) => onSet(i, { side: v as "entry" | "exit" })}
              >
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="entry">Entry</SelectItem>
                  <SelectItem value="exit">Exit</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-6 sm:col-span-2">
              <Label className="text-[11px] text-muted-foreground">Price</Label>
              <Input
                className="h-8"
                inputMode="decimal"
                value={e.price}
                onChange={(ev) => onSet(i, { price: ev.target.value })}
              />
            </div>
            <div className="col-span-6 sm:col-span-1">
              <Label className="text-[11px] text-muted-foreground">Qty</Label>
              <Input
                className="h-8"
                inputMode="decimal"
                value={e.qty}
                onChange={(ev) => onSet(i, { qty: ev.target.value })}
              />
            </div>
            <div className="col-span-12 sm:col-span-3">
              <Label className="text-[11px] text-muted-foreground">Time</Label>
              <Input
                className="h-8"
                type="datetime-local"
                value={e.executedLocal}
                onChange={(ev) => onSet(i, { executedLocal: ev.target.value })}
              />
            </div>
            <div className="col-span-4 sm:col-span-1">
              <Label className="text-[11px] text-muted-foreground">Fee</Label>
              <Input
                className="h-8"
                inputMode="decimal"
                value={e.fee}
                onChange={(ev) => onSet(i, { fee: ev.target.value })}
              />
            </div>
            <div className="col-span-4 sm:col-span-2">
              <Label className="text-[11px] text-muted-foreground">Swap</Label>
              <Input
                className="h-8"
                inputMode="decimal"
                value={e.swap}
                onChange={(ev) => onSet(i, { swap: ev.target.value })}
              />
            </div>
            <div className="col-span-4 sm:col-span-1">
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-8"
                onClick={() => onRemove(i)}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          </div>
        ))}
        {execs.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No fills yet — add an entry to log this trade.
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-1 border-t pt-2 text-sm">
        <span className="text-muted-foreground">
          Avg entry: <b className="text-foreground">{metrics.avgEntry?.toFixed(2) ?? "—"}</b>
        </span>
        <span className="text-muted-foreground">
          Avg exit: <b className="text-foreground">{metrics.avgExit?.toFixed(2) ?? "—"}</b>
        </span>
        <span className="text-muted-foreground">
          Size: <b className="text-foreground">{metrics.entryQty || "—"}</b>
        </span>
        <span className="text-muted-foreground">
          Gross: <b className={pnlClass(metrics.grossPl)}>{fmtMoney(metrics.grossPl, currency, { sign: true })}</b>
        </span>
        <span className="text-muted-foreground">
          Fees: <b className="text-foreground">{fmtMoney(metrics.fees, currency)}</b>
        </span>
        {metrics.sizeSuggestion != null && (
          <Badge variant="secondary">
            Suggested size ≈ {metrics.sizeSuggestion.toFixed(2)}
            {pointSymbol ? ` ${pointSymbol}` : ""} for your risk %
          </Badge>
        )}
      </div>
    </div>
  );
}
