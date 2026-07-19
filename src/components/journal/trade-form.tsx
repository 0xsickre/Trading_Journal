"use client";

import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Trash2,
  ArrowDownToLine,
  ArrowUpFromLine,
  ExternalLink,
  ChevronDown,
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EditableSelect } from "@/components/journal/editable-select";
import { TagMultiSelect } from "@/components/journal/tag-multi-select";
import { TradeImages } from "@/components/journal/trade-images";
import {
  FORM_TABS,
  type FieldConfig,
  type FormGroup,
} from "@/lib/journal/form-config";
import type { Account, Instrument, OptionsMap } from "@/lib/journal/types";
import {
  computeEntrySlippage,
  fmtSlippagePts,
  fmtSlippageR,
} from "@/lib/journal/entry-slippage";
import { fmtExitEfficiencyPct, parsePlannedRewardR } from "@/lib/journal/exit-efficiency";
import { fmtMoney, fmtR, pnlClass } from "@/lib/journal/format";
import {
  computePlannedRewardR,
  computePositionSize,
  formatPlannedRewardR,
  inferDirectionFromPrices,
  parseRiskPct,
  riskPlanFieldVisible,
} from "@/lib/journal/plan-calculations";
import { computePositionStats } from "@/lib/journal/position-stats";
import { utcToZonedInput, zonedInputToUtc } from "@/lib/journal/time";
import {
  createTrade,
  updateTrade,
  type ExecutionInput,
} from "@/app/(app)/trades/actions";
import {
  getTradeFormPrefs,
  setTradeFormPrefs,
  defaultRiskPctOption,
} from "@/lib/journal/trade-form-prefs";
import { cn } from "@/lib/utils";

type TradePhase = "planned" | "active";

type ExecRow = {
  side: "entry" | "exit";
  price: string;
  qty: string;
  executedLocal: string;
  fee: string;
  swap: string;
};

export type FieldValue = string | number | string[] | null;

export type TradeFormInitial = {
  id: string;
  account_id: string | null;
  trade_no: number | null;
  status?: string;
  fields: Record<string, FieldValue>;
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

function initialTradePhase(initial?: TradeFormInitial): TradePhase {
  if (!initial) return "planned";
  if (initial.executions.length > 0 || (initial.status && initial.status !== "open")) {
    return "active";
  }
  return "planned";
}

function defaultTab(initial?: TradeFormInitial): "plan" | "execution" {
  if (!initial) return "plan";
  const hasExit = initial.executions.some((e) => e.side === "exit");
  if (hasExit || (initial.status && initial.status !== "open")) return "execution";
  return "plan";
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
  const [activeTab, setActiveTab] = useState<"plan" | "execution">(() =>
    defaultTab(initial),
  );
  const [tradePhase, setTradePhase] = useState<TradePhase>(() =>
    initialTradePhase(initial),
  );

  const [accountId, setAccountId] = useState<string | null>(
    initial?.account_id ?? accounts.find((a) => a.is_active)?.id ?? accounts[0]?.id ?? null,
  );
  const account = accounts.find((a) => a.id === accountId) ?? null;
  const tz = account?.timezone ?? "America/New_York";
  const currency = account?.currency ?? "USD";

  const [tradeNo, setTradeNo] = useState<string>(
    initial?.trade_no != null ? String(initial.trade_no) : "",
  );
  const [fields, setFields] = useState<Record<string, FieldValue>>(
    initial?.fields ?? {},
  );

  const [execs, setExecs] = useState<ExecRow[]>(() => {
    if (initial && initial.executions.length > 0) {
      return initial.executions.map((e) => ({
        side: e.side,
        price: String(e.price),
        qty: String(e.qty),
        executedLocal: utcToZonedInput(e.executed_at, tz),
        fee: String(e.fee ?? 0),
        swap: String(e.swap_funding ?? 0),
      }));
    }
    return [];
  });

  function setField(name: string, value: FieldValue) {
    setFields((prev) => {
      const next: Record<string, FieldValue> = { ...prev, [name]: value };
      if (name === "entry_price") {
        const entry = n(String(value ?? ""));
        if (entry == null) {
          next.stop_price = "";
          next.target_price = "";
        }
      }
      if (name === "stop_price") {
        const stop = n(String(value ?? ""));
        if (stop == null) {
          next.target_price = "";
        }
      }
      return next;
    });
  }

  useEffect(() => {
    if (initial) return;
    const prefs = getTradeFormPrefs();
    if (prefs.accountId && accounts.some((a) => a.id === prefs.accountId)) {
      setAccountId(prefs.accountId);
    }
    setFields((prev) => {
      if (prev.risk_pct != null && prev.risk_pct !== "") return prev;
      const riskOptions = optionsMap.risk_pct ?? [];
      const fromPrefs =
        prefs.riskPct && riskOptions.some((o) => o.value === prefs.riskPct)
          ? prefs.riskPct
          : defaultRiskPctOption(riskOptions);
      if (!fromPrefs) return prev;
      return { ...prev, risk_pct: fromPrefs };
    });
  }, [initial, accounts, optionsMap.risk_pct]);

  useEffect(() => {
    const entry = n(String(fields.entry_price ?? ""));
    const stop = n(String(fields.stop_price ?? ""));
    const inferred = inferDirectionFromPrices(entry, stop);
    if (inferred == null) return;
    setFields((prev) =>
      prev.direction === inferred ? prev : { ...prev, direction: inferred },
    );
  }, [fields.entry_price, fields.stop_price]);

  const inferredDirection = useMemo(
    () =>
      inferDirectionFromPrices(
        n(String(fields.entry_price ?? "")),
        n(String(fields.stop_price ?? "")),
      ),
    [fields.entry_price, fields.stop_price],
  );

  const executionUnlocked = tradePhase === "active" || execs.length > 0;

  const instrument = instruments.find((i) => i.symbol === fields.instrument);
  const pointValue = instrument?.point_value ?? 1;

  const metrics = useMemo(() => {
    const executionFills = execs
      .map((e) => ({
        side: e.side,
        price: n(e.price) ?? NaN,
        qty: n(e.qty) ?? 0,
        fee: n(e.fee) ?? 0,
        swap_funding: n(e.swap) ?? 0,
      }))
      .filter((e) => Number.isFinite(e.price) && e.qty > 0);

    const pe = n(String(fields.entry_price ?? ""));
    const stop = n(String(fields.stop_price ?? ""));
    const dir = String(fields.direction ?? "");

    const posStats = computePositionStats({
      direction: dir,
      entry_price: pe,
      stop_price: stop,
      point_value: pointValue,
      executions: executionFills,
    });

    const {
      avg_entry: avgEntry,
      avg_exit: avgExit,
      entry_qty: entryQty,
      exit_qty: exitQty,
      gross_pl: grossPl,
      net_pl: netPl,
      total_fees: totalFees,
      total_swap: totalSwap,
      realized_r: r,
    } = posStats;
    const fees = totalFees + totalSwap;

    const pt = n(String(fields.target_price ?? ""));
    const maePrice = n(String(fields.max_drawdown_price ?? ""));
    const mfePrice = n(String(fields.max_profit_price ?? ""));
    const plannedRR = computePlannedRewardR({
      direction: dir || null,
      entry: pe,
      stop,
      target: pt,
    });

    const dirMult = dir.toLowerCase().startsWith("short") ? -1 : 1;
    const riskPtsForMaeMfe =
      posStats.planned_risk_pts ??
      (avgEntry != null && stop != null && Math.abs(avgEntry - stop) > 0
        ? Math.abs(avgEntry - stop)
        : null);

    let maeR: number | null = null;
    let mfeR: number | null = null;
    let capturePct: number | null = null;
    if (avgEntry != null && riskPtsForMaeMfe != null && riskPtsForMaeMfe > 0) {
      if (maePrice != null) {
        const maePts = dirMult === 1 ? avgEntry - maePrice : maePrice - avgEntry;
        if (maePts > 0) maeR = maePts / riskPtsForMaeMfe;
      }
      if (mfePrice != null) {
        const mfePts = dirMult === 1 ? mfePrice - avgEntry : avgEntry - mfePrice;
        if (mfePts > 0) mfeR = mfePts / riskPtsForMaeMfe;
      }
      if (r != null && mfeR != null && mfeR > 0) {
        capturePct = (r / mfeR) * 100;
      }
    }

    const riskPct = parseRiskPct(fields.risk_pct as string | number | null);
    const balance = account?.starting_balance ?? 0;
    const sizeSuggestion = computePositionSize({
      balance,
      riskPct,
      entry: pe,
      stop,
      pointValue,
    });

    const slippage = computeEntrySlippage({
      direction: String(fields.direction ?? ""),
      plannedEntry: pe,
      avgEntry,
      stopPrice: stop,
      entryQty: entryQty > 0 ? entryQty : null,
      pointValue,
    });

    let targetAttainment: {
      plannedRewardR: number;
      realizedR: number;
      pct: number;
    } | null = null;
    const plannedReward =
      plannedRR ?? parsePlannedRewardR(String(fields.planned_rr ?? ""));
    if (r != null && plannedReward != null && plannedReward > 0) {
      targetAttainment = {
        plannedRewardR: plannedReward,
        realizedR: r,
        pct: (r / plannedReward) * 100,
      };
    }

    return {
      avgEntry,
      avgExit,
      entryQty,
      exitQty,
      grossPl,
      netPl,
      r,
      plannedRR,
      sizeSuggestion,
      totalFees,
      totalSwap,
      fees,
      maeR,
      mfeR,
      capturePct,
      slippage,
      plannedEntry: pe,
      targetAttainment,
    };
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

  function handleAddEntryFromPlan() {
    setTradePhase("active");
    if (execs.length === 0) addExec("entry");
    setActiveTab("execution");
  }

  function handleTabChange(v: string) {
    if (v === "execution" && !executionUnlocked) return;
    setActiveTab(v as "plan" | "execution");
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
      setActiveTab("plan");
      return;
    }

    const fieldsToSave = { ...fields };
    if (metrics.plannedRR != null) {
      fieldsToSave.planned_rr = formatPlannedRewardR(metrics.plannedRR);
    }
    if (metrics.sizeSuggestion != null) {
      fieldsToSave.position_size = Number(metrics.sizeSuggestion.toFixed(4));
    }

    const payload = {
      account_id: accountId,
      trade_no: tradeNo ? Number(tradeNo) : null,
      fields: fieldsToSave,
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
      setTradeFormPrefs({
        accountId: accountId ?? undefined,
        riskPct: String(fieldsToSave.risk_pct ?? ""),
      });
      toast.success(initial ? "Trade updated" : "Trade saved");
      router.push("/journal");
      router.refresh();
    });
  }

  return (
    <div className="space-y-6 pb-24">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">
            {initial ? "Edit Trade" : "New Trade"}
          </h1>
          <p className="text-sm text-muted-foreground">
            Times shown in {tz.replace("_", " ")} ({currency}).
          </p>
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

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList className="w-full sm:w-auto">
          {FORM_TABS.map((tab) => (
            <TabsTrigger
              key={tab.id}
              value={tab.id}
              className="flex-1 sm:flex-none"
              disabled={tab.id === "execution" && !executionUnlocked}
              title={
                tab.id === "execution" && !executionUnlocked
                  ? "Complete your plan or mark trade as Active to log fills."
                  : undefined
              }
            >
              {tab.title}
            </TabsTrigger>
          ))}
        </TabsList>

        {FORM_TABS.map((tab) => (
          <TabsContent key={tab.id} value={tab.id} className="mt-4">
            {tab.id === "execution" && !executionUnlocked ? (
              <Card>
                <CardContent className="py-10 text-center text-sm text-muted-foreground">
                  Mark the trade as <b>Active</b> or use <b>Add Entry Fill</b> on the
                  Plan tab to log executions and review.
                </CardContent>
              </Card>
            ) : (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{tab.title}</CardTitle>
                {tab.description && (
                  <CardDescription>{tab.description}</CardDescription>
                )}
              </CardHeader>
              <CardContent className="space-y-6">
                {tab.id === "execution" && (
                  <ExecutionsEditor
                    execs={execs}
                    tz={tz}
                    onAdd={addExec}
                    onSet={setExec}
                    onRemove={removeExec}
                    metrics={metrics}
                    currency={currency}
                  />
                )}

                {tab.groups
                  .filter((g) => !g.advanced)
                  .map((group) => (
                    <FormGroupSection
                      key={group.id}
                      group={group}
                      fields={fields}
                      setField={setField}
                      optionsMap={optionsMap}
                      instruments={instruments}
                      accountId={accountId}
                      accounts={accounts}
                      onAccountChange={setAccountId}
                      showAccount={tab.id === "plan" && group.id === "meta"}
                      tradePhase={tab.id === "plan" && group.id === "meta" ? tradePhase : undefined}
                      onTradePhaseChange={
                        tab.id === "plan" && group.id === "meta"
                          ? setTradePhase
                          : undefined
                      }
                      computedDisplay={
                        tab.id === "plan" && group.id === "risk_plan"
                          ? {
                              planned_rr:
                                metrics.plannedRR != null
                                  ? formatPlannedRewardR(metrics.plannedRR)
                                  : "—",
                              position_size:
                                metrics.sizeSuggestion != null
                                  ? `${metrics.sizeSuggestion.toFixed(2)}${instrument?.symbol ? ` ${instrument.symbol}` : ""}`
                                  : "—",
                            }
                          : undefined
                      }
                      fieldHints={
                        tab.id === "plan" && group.id === "meta" && inferredDirection != null
                          ? { direction: "Auto from entry vs stop" }
                          : undefined
                      }
                      onAddEntryFill={
                        tab.id === "plan" && group.id === "risk_plan"
                          ? handleAddEntryFromPlan
                          : undefined
                      }
                    />
                  ))}

                {tab.groups.some((g) => g.advanced) && (
                  <AdvancedSection>
                    {tab.groups
                      .filter((g) => g.advanced)
                      .map((group) => (
                        <FormGroupSection
                          key={group.id}
                          group={group}
                          fields={fields}
                          setField={setField}
                          optionsMap={optionsMap}
                          instruments={instruments}
                          nested
                        />
                      ))}
                  </AdvancedSection>
                )}
              </CardContent>
            </Card>
            )}
          </TabsContent>
        ))}
      </Tabs>

      {initial && <TradeImages positionId={initial.id} />}

      <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 p-3 backdrop-blur md:left-60">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            {activeTab === "plan" ? (
              <>
                <Metric
                  label="Planned R:R"
                  value={
                    metrics.plannedRR != null
                      ? formatPlannedRewardR(metrics.plannedRR)
                      : "—"
                  }
                />
                <Metric
                  label="Position Size"
                  value={
                    metrics.sizeSuggestion != null
                      ? `${metrics.sizeSuggestion.toFixed(2)}${instrument?.symbol ? ` ${instrument.symbol}` : ""}`
                      : "—"
                  }
                />
                {metrics.slippage != null && (
                  <Metric
                    label="Slippage"
                    value={fmtSlippageR(metrics.slippage.slippageR)}
                    title={`${fmtSlippagePts(metrics.slippage.adversePts)} vs planned`}
                  />
                )}
              </>
            ) : (
              <>
                <Metric
                  label="Net P/L"
                  value={fmtMoney(metrics.netPl, currency, { sign: true })}
                  cls={pnlClass(metrics.netPl)}
                />
                <Metric label="R" value={fmtR(metrics.r)} cls={pnlClass(metrics.r)} />
                <Metric
                  label="MAE"
                  value={metrics.maeR != null ? `−${metrics.maeR.toFixed(2)}R` : "—"}
                />
                <Metric
                  label="MFE"
                  value={metrics.mfeR != null ? `+${metrics.mfeR.toFixed(2)}R` : "—"}
                />
                <Metric
                  label="Capture"
                  value={metrics.capturePct != null ? `${metrics.capturePct.toFixed(0)}%` : "—"}
                  title="MFE capture — realized R / max favorable excursion"
                />
                {metrics.targetAttainment != null && (
                  <Metric
                    label="Target attainment"
                    value={fmtExitEfficiencyPct(metrics.targetAttainment.pct)}
                    title={`${metrics.targetAttainment.realizedR.toFixed(2)}R realized / ${metrics.targetAttainment.plannedRewardR.toFixed(2)}R planned target`}
                  />
                )}
                {metrics.slippage != null && (
                  <Metric
                    label="Slippage"
                    value={fmtSlippageR(metrics.slippage.slippageR)}
                    title={`${fmtSlippagePts(metrics.slippage.adversePts)} vs planned`}
                  />
                )}
                <Metric
                  label="Fees + Swap"
                  value={fmtMoney(metrics.fees, currency)}
                />
                {metrics.fees > 0 && metrics.grossPl != null && metrics.netPl != null && (
                  <Metric
                    label="Gross → Net"
                    value={fmtMoney(metrics.grossPl - metrics.netPl, currency)}
                  />
                )}
              </>
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

function Metric({
  label,
  value,
  cls,
  title,
}: {
  label: string;
  value: string;
  cls?: string;
  title?: string;
}) {
  return (
    <div className="flex items-baseline gap-1.5" title={title}>
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`font-semibold ${cls ?? ""}`}>{value}</span>
    </div>
  );
}

function AdvancedSection({ children }: { children: ReactNode }) {
  return (
    <details className="group rounded-lg border bg-muted/20">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
        <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
        Advanced
      </summary>
      <div className="space-y-6 border-t px-4 py-4">{children}</div>
    </details>
  );
}

function FormGroupSection({
  group,
  fields,
  setField,
  optionsMap,
  instruments,
  accountId,
  accounts,
  onAccountChange,
  showAccount,
  tradePhase,
  onTradePhaseChange,
  onAddEntryFill,
  computedDisplay,
  fieldHints,
  nested,
}: {
  group: FormGroup;
  fields: Record<string, FieldValue>;
  setField: (name: string, value: FieldValue) => void;
  optionsMap: OptionsMap;
  instruments: Instrument[];
  accountId?: string | null;
  accounts?: Account[];
  onAccountChange?: (id: string) => void;
  showAccount?: boolean;
  tradePhase?: TradePhase;
  onTradePhaseChange?: (phase: TradePhase) => void;
  onAddEntryFill?: () => void;
  computedDisplay?: Record<string, string>;
  fieldHints?: Record<string, string>;
  nested?: boolean;
}) {
  const entry = n(String(fields.entry_price ?? ""));
  const stop = n(String(fields.stop_price ?? ""));
  const target = n(String(fields.target_price ?? ""));
  const riskPct = parseRiskPct(fields.risk_pct as string | number | null);

  const fieldsToRender =
    group.id === "risk_plan"
      ? group.fields.filter((field) =>
          riskPlanFieldVisible(field.name, entry, stop, target, riskPct),
        )
      : group.fields;

  return (
    <div className={nested ? "space-y-4" : "space-y-4"}>
      {!nested && (
        <div>
          <h3 className="text-sm font-semibold">{group.title}</h3>
          {group.description && (
            <p className="text-sm text-muted-foreground">{group.description}</p>
          )}
          {group.id === "risk_plan" && (
            <p className="mt-1 text-xs text-muted-foreground">
              Unesi entry, pa stop, pa target.
            </p>
          )}
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {showAccount && accounts && onAccountChange && (
          <div className="space-y-1.5">
            <Label className="text-xs">Account</Label>
            <Select
              value={accountId ?? undefined}
              onValueChange={(v) => onAccountChange(v)}
            >
              <SelectTrigger>
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
        )}
        {tradePhase != null && onTradePhaseChange && (
          <div className="space-y-1.5">
            <Label className="text-xs">Trade phase</Label>
            <Select
              value={tradePhase}
              onValueChange={(v) => onTradePhaseChange(v as TradePhase)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="planned">Planned</SelectItem>
                <SelectItem value="active">Active</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
        {fieldsToRender.map((field) => (
          <FieldRenderer
            key={field.name}
            field={field}
            value={fields[field.name]}
            onChange={(v) => setField(field.name, v)}
            optionsMap={optionsMap}
            instruments={instruments}
            computedDisplay={computedDisplay?.[field.name]}
            fieldHint={fieldHints?.[field.name]}
          />
        ))}
      </div>
      {onAddEntryFill && group.id === "risk_plan" && (
        <Button type="button" variant="outline" size="sm" onClick={onAddEntryFill}>
          <ArrowDownToLine className="size-4" /> Add Entry Fill
        </Button>
      )}
    </div>
  );
}

function FieldRenderer({
  field,
  value,
  onChange,
  optionsMap,
  instruments,
  computedDisplay,
  fieldHint,
}: {
  field: FieldConfig;
  value: FieldValue | undefined;
  onChange: (v: FieldValue) => void;
  optionsMap: OptionsMap;
  instruments: Instrument[];
  computedDisplay?: string;
  fieldHint?: string;
}) {
  const colSpan = field.colSpan === 2 ? "sm:col-span-2" : "";

  if (field.type === "computed") {
    return (
      <div className={`space-y-1.5 ${colSpan}`}>
        <Label className="text-xs">{field.label}</Label>
        <Input
          readOnly
          disabled
          className="bg-muted/40 font-medium"
          value={computedDisplay ?? "—"}
          placeholder={field.placeholder ?? "Auto"}
        />
      </div>
    );
  }

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
        <Label className="text-xs" title={fieldHint}>
          {field.label}
        </Label>
        {fieldHint && (
          <p className="text-xs text-muted-foreground">{fieldHint}</p>
        )}
        <EditableSelect
          listKey={field.listKey!}
          options={optionsMap[field.listKey!] ?? []}
          value={(value as string) ?? ""}
          onChange={(v) => onChange(v)}
        />
      </div>
    );
  }

  if (field.type === "tags") {
    return (
      <div className={`space-y-1.5 ${colSpan}`}>
        <Label className="text-xs">{field.label}</Label>
        <TagMultiSelect
          value={Array.isArray(value) ? value : []}
          onChange={(v) => onChange(v)}
          optionsMap={optionsMap}
          listKey={field.listKey}
          listKeys={field.listKeys}
          placeholder={field.placeholder}
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
    totalFees: number;
    totalSwap: number;
    fees: number;
    plannedEntry: number | null;
    slippage: ReturnType<typeof computeEntrySlippage>;
  };
  currency: string;
}) {
  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="text-sm font-semibold">
            Fills (Executions){" "}
            <span className="font-normal text-muted-foreground">
              ({tz.replace("_", " ")})
            </span>
          </h4>
          <p className="mt-1 text-xs text-muted-foreground">
            Swap and fees significantly affect Net P/L for swing positions held over
            weekends.
          </p>
        </div>
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
            <div
              className={cn(
                "col-span-6 rounded-md border-l-2 border-amber-500/40 bg-amber-500/5 p-1 sm:col-span-2",
              )}
            >
              <Label className="text-[11px] font-medium text-amber-800 dark:text-amber-200">
                Fee
              </Label>
              <Input
                className="h-8 border-amber-500/20"
                inputMode="decimal"
                value={e.fee}
                onChange={(ev) => onSet(i, { fee: ev.target.value })}
                placeholder="0"
              />
            </div>
            <div
              className={cn(
                "col-span-6 rounded-md border-l-2 border-amber-500/40 bg-amber-500/5 p-1 sm:col-span-2",
              )}
            >
              <Label className="text-[11px] font-medium text-amber-800 dark:text-amber-200">
                Swap / Funding
              </Label>
              <Input
                className="h-8 border-amber-500/20"
                inputMode="decimal"
                value={e.swap}
                onChange={(ev) => onSet(i, { swap: ev.target.value })}
                placeholder="0"
              />
            </div>
            <div className="col-span-12 flex justify-end sm:col-span-1 sm:justify-start">
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
            No fills yet — add an entry when you enter, and exits when you close.
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-1 border-t pt-2 text-sm">
        <span className="text-muted-foreground">
          Planned entry:{" "}
          <b className="text-foreground">
            {metrics.plannedEntry?.toFixed(2) ?? "—"}
          </b>
        </span>
        <span className="text-muted-foreground">
          Avg entry: <b className="text-foreground">{metrics.avgEntry?.toFixed(2) ?? "—"}</b>
        </span>
        {metrics.slippage != null && (
          <span className="text-muted-foreground">
            Slippage:{" "}
            <b className="text-foreground">
              {fmtSlippagePts(metrics.slippage.adversePts)}
              {metrics.slippage.slippageR != null
                ? ` (${fmtSlippageR(metrics.slippage.slippageR)})`
                : ""}
            </b>
          </span>
        )}
        <span className="text-muted-foreground">
          Avg exit: <b className="text-foreground">{metrics.avgExit?.toFixed(2) ?? "—"}</b>
        </span>
        <span className="text-muted-foreground">
          Size: <b className="text-foreground">{metrics.entryQty || "—"}</b>
        </span>
        <span className="text-muted-foreground">
          Gross:{" "}
          <b className={pnlClass(metrics.grossPl)}>
            {fmtMoney(metrics.grossPl, currency, { sign: true })}
          </b>
        </span>
        <span className="text-muted-foreground">
          Net:{" "}
          <b className={pnlClass(metrics.netPl)}>
            {fmtMoney(metrics.netPl, currency, { sign: true })}
          </b>
        </span>
        <span className="text-muted-foreground">
          Total fees: <b className="text-foreground">{fmtMoney(metrics.totalFees, currency)}</b>
        </span>
        <span className="text-muted-foreground">
          Total swap: <b className="text-foreground">{fmtMoney(metrics.totalSwap, currency)}</b>
        </span>
        <span className="text-muted-foreground">
          Combined costs: <b className="text-foreground">{fmtMoney(metrics.fees, currency)}</b>
        </span>
      </div>
    </div>
  );
}
