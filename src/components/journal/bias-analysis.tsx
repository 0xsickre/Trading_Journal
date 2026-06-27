"use client";

import { Fragment, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Plus,
  Trash2,
  Check,
  X,
  RotateCcw,
  Pencil,
  ExternalLink,
  TrendingUp,
  TrendingDown,
  Minus,
  ChevronDown,
  ChevronRight,
  Sparkles,
  CalendarDays,
  Loader2,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EditableSelect } from "@/components/journal/editable-select";
import { cn } from "@/lib/utils";
import type {
  BiasAnalysis,
  BiasValue,
  CotLeg,
  Instrument,
  MarketContext,
  OptionsMap,
  PairCot,
  ResolvedAnalysis,
} from "@/lib/journal/types";
import {
  GLOBAL_FACTORS,
  LEG_FACTORS,
  PAIR_FACTORS,
  SINGLE_LEG_FACTORS,
  FX_CURRENCY_LEGS,
  SINGLE_UNDERLYINGS,
  factorsForLeg,
  legLabel,
  legsForSymbol,
  isSingleSymbol,
  isPairSymbol,
} from "@/lib/journal/analysis-config";
import { bestCombos } from "@/lib/journal/combos";
import {
  contextByWeek,
  legByKey,
  resolveAnalysisFactors,
} from "@/lib/journal/resolve";
import { weekStart, currentWeekStart } from "@/lib/journal/week";
import {
  createBiasAnalysis,
  updateBiasAnalysis,
  closeBiasAnalysis,
  reopenBiasAnalysis,
  deleteBiasAnalysis,
  upsertMarketContext,
  upsertCotLeg,
} from "@/app/(app)/analysis/actions";

const BIAS_OPTIONS: { value: BiasValue; label: string }[] = [
  { value: "bullish", label: "Bullish" },
  { value: "bearish", label: "Bearish" },
  { value: "neutral", label: "Neutral" },
];

const GLOBAL_NAMES = GLOBAL_FACTORS.map((f) => f.name);
const LEG_FIELD_NAMES = Array.from(
  new Set([...LEG_FACTORS, ...SINGLE_LEG_FACTORS].map((f) => f.name)),
);

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function computeEndDate(startDate: string, weeks: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startDate);
  if (!m || !Number.isFinite(weeks) || weeks < 1) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(ms + Math.floor(weeks) * 7 * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

function fmtDate(d: string | null): string {
  if (!d) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) return d;
  return `${m[3]}.${m[2]}.${m[1]}`;
}

type Draft = {
  instrument: string;
  bias: BiasValue;
  startDate: string;
  weeks: string;
  notes: string;
  chartUrl: string;
  pair: Record<string, string>; // pair-level COT
};

function emptyPair(): Record<string, string> {
  return Object.fromEntries(PAIR_FACTORS.map((f) => [f.name, ""]));
}

function emptyDraft(): Draft {
  return {
    instrument: "",
    bias: "bullish",
    startDate: today(),
    weeks: "1",
    notes: "",
    chartUrl: "",
    pair: emptyPair(),
  };
}

function ctxToValues(c: MarketContext | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of GLOBAL_NAMES)
    out[n] = (c?.[n as keyof MarketContext] as string | null) ?? "";
  return out;
}

function legToValues(l: CotLeg | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of LEG_FIELD_NAMES)
    out[n] = (l?.[n as keyof CotLeg] as string | null) ?? "";
  return out;
}

export function BiasAnalysisBoard({
  analyses,
  contexts,
  legs,
  pairCots,
  instruments,
  optionsMap,
}: {
  analyses: BiasAnalysis[];
  contexts: MarketContext[];
  legs: CotLeg[];
  pairCots: PairCot[];
  instruments: Instrument[];
  optionsMap: OptionsMap;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "open" | "win" | "loss">("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Local copies of weekly data — updated optimistically on autosave so the
  // resolver/combos reflect edits without a server round-trip.
  const [ctxList, setCtxList] = useState<MarketContext[]>(contexts);
  const [legList, setLegList] = useState<CotLeg[]>(legs);

  // Selected week (UTC Monday) for the week workspace.
  const [week, setWeek] = useState<string>(currentWeekStart());

  // Optimistically fold a saved context/leg into the local lists so the
  // resolver + combos + inherited preview update without a server round-trip.
  function persistContext(values: Record<string, string>) {
    setCtxList((prev) => {
      const rest = prev.filter((c) => c.week_start !== week);
      const base =
        prev.find((c) => c.week_start === week) ??
        ({
          id: `local-${week}`,
          week_start: week,
          created_at: "",
          updated_at: "",
        } as MarketContext);
      const merged = { ...base } as MarketContext;
      for (const n of GLOBAL_NAMES)
        (merged as Record<string, unknown>)[n] = values[n] || null;
      return [merged, ...rest];
    });
  }

  function persistLeg(code: string, values: Record<string, string>) {
    setLegList((prev) => {
      const rest = prev.filter(
        (l) => !(l.week_start === week && l.underlying === code),
      );
      const base =
        prev.find((l) => l.week_start === week && l.underlying === code) ??
        ({
          id: `local-${week}-${code}`,
          week_start: week,
          underlying: code,
          created_at: "",
          updated_at: "",
        } as CotLeg);
      const merged = { ...base } as CotLeg;
      for (const n of LEG_FIELD_NAMES)
        (merged as Record<string, unknown>)[n] = values[n] || null;
      return [merged, ...rest];
    });
  }

  // Resolve once for combos / breakdowns / expand rows.
  const ctxMap = useMemo(() => contextByWeek(ctxList), [ctxList]);
  const legMap = useMemo(() => legByKey(legList), [legList]);
  const pairByKey = useMemo(() => {
    const m = new Map<string, PairCot>();
    for (const p of pairCots) m.set(`${p.week_start}|${p.instrument}`, p);
    return m;
  }, [pairCots]);
  const resolved = useMemo(
    () =>
      analyses.map((analysis) => ({
        analysis,
        factors: resolveAnalysisFactors(analysis, ctxMap, legMap),
      })),
    [analyses, ctxMap, legMap],
  );
  const factorsById = useMemo(() => {
    const m = new Map<string, { name: string; label: string; value: string }[]>();
    for (const r of resolved) m.set(r.analysis.id, r.factors);
    return m;
  }, [resolved]);

  const stats = useMemo(() => {
    let open = 0,
      wins = 0,
      losses = 0;
    for (const a of analyses) {
      if (a.status === "win") wins++;
      else if (a.status === "loss") losses++;
      else open++;
    }
    const closed = wins + losses;
    return {
      total: analyses.length,
      open,
      wins,
      losses,
      winRate: closed > 0 ? (wins / closed) * 100 : 0,
    };
  }, [analyses]);

  const byInstrument = useMemo(
    () => breakdown(analyses, "instrument"),
    [analyses],
  );
  const byBias = useMemo(() => breakdown(analyses, "bias"), [analyses]);

  const visible = useMemo(
    () =>
      filter === "all" ? analyses : analyses.filter((a) => a.status === filter),
    [analyses, filter],
  );

  const endPreview = computeEndDate(draft.startDate, Number(draft.weeks));
  const draftWeek = weekStart(draft.startDate);
  const draftIsSingle = isSingleSymbol(draft.instrument);
  const draftIsPair = isPairSymbol(draft.instrument);

  const bridgePair = useMemo(() => {
    if (!draft.instrument || !draftWeek || !draftIsPair) return undefined;
    return pairByKey.get(`${draftWeek}|${draft.instrument}`);
  }, [draft.instrument, draftWeek, draftIsPair, pairByKey]);

  useEffect(() => {
    if (!bridgePair || editingId) return;
    setDraft((d) => ({
      ...d,
      pair: {
        cot_score: bridgePair.cot_score ?? "",
        cot_verdict: bridgePair.cot_verdict ?? "",
        cot_confidence: bridgePair.cot_confidence ?? "",
      },
    }));
  }, [bridgePair, editingId]);

  // Inherited (global + leg) factors that will attach to the drafted analysis.
  const inherited = useMemo(() => {
    if (!draft.instrument) return [];
    const synthetic: BiasAnalysis = {
      id: "draft",
      instrument: draft.instrument,
      bias: draft.bias,
      start_date: draft.startDate,
      period_weeks: Number(draft.weeks) || 1,
      end_date: null,
      status: "open",
      notes: null,
      chart_url: null,
      closed_at: null,
      created_at: "",
      updated_at: "",
      week_start: draftWeek || null,
      cot_score: null,
      cot_verdict: null,
      cot_confidence: null,
    };
    return resolveAnalysisFactors(synthetic, ctxMap, legMap).filter(
      (f) => f.name !== "bias",
    );
  }, [draft, draftWeek, ctxMap, legMap]);

  function patch(p: Partial<Draft>) {
    setDraft((d) => ({ ...d, ...p }));
  }

  function patchPair(name: string, value: string) {
    setDraft((d) => ({ ...d, pair: { ...d.pair, [name]: value } }));
  }

  function resetForm() {
    setDraft(emptyDraft());
    setEditingId(null);
  }

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function submit() {
    if (!draft.instrument) {
      toast.error("Pick an instrument.");
      return;
    }
    const weeks = Number(draft.weeks);
    if (!Number.isFinite(weeks) || weeks < 1) {
      toast.error("Period must be at least 1 week.");
      return;
    }
    const payload = {
      instrument: draft.instrument,
      bias: draft.bias,
      start_date: draft.startDate,
      period_weeks: Math.floor(weeks),
      notes: draft.notes,
      chart_url: draft.chartUrl,
      cot_score: draft.pair.cot_score || null,
      cot_verdict: draft.pair.cot_verdict || null,
      cot_confidence: draft.pair.cot_confidence || null,
    };
    start(async () => {
      const res = editingId
        ? await updateBiasAnalysis(editingId, payload)
        : await createBiasAnalysis(payload);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(editingId ? "Analysis updated" : "Analysis added");
      resetForm();
      router.refresh();
    });
  }

  function edit(a: BiasAnalysis) {
    setEditingId(a.id);
    const pair = emptyPair();
    for (const f of PAIR_FACTORS)
      pair[f.name] = (a[f.name as keyof BiasAnalysis] as string | null) ?? "";
    setDraft({
      instrument: a.instrument ?? "",
      bias: a.bias,
      startDate: a.start_date,
      weeks: String(a.period_weeks),
      notes: a.notes ?? "",
      chartUrl: a.chart_url ?? "",
      pair,
    });
    // Jump the workspace to that analysis's week too.
    if (a.week_start) setWeek(a.week_start);
    else if (a.start_date) setWeek(weekStart(a.start_date));
    if (typeof window !== "undefined")
      window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function close(id: string, outcome: "win" | "loss") {
    start(async () => {
      const res = await closeBiasAnalysis(id, outcome);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(outcome === "win" ? "Marked Win" : "Marked Loss");
      router.refresh();
    });
  }

  function reopen(id: string) {
    start(async () => {
      const res = await reopenBiasAnalysis(id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      router.refresh();
    });
  }

  function remove(id: string) {
    if (!window.confirm("Delete this analysis?")) return;
    start(async () => {
      const res = await deleteBiasAnalysis(id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      if (editingId === id) resetForm();
      toast.success("Deleted");
      router.refresh();
    });
  }

  function shiftWeek(deltaWeeks: number) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(week);
    if (!m) return;
    const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    setWeek(new Date(ms + deltaWeeks * 7 * 86_400_000).toISOString().slice(0, 10));
  }

  return (
    <div className="space-y-5">
      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="Total" value={String(stats.total)} />
        <StatCard label="Open" value={String(stats.open)} />
        <StatCard label="Wins" value={String(stats.wins)} tone="win" />
        <StatCard label="Losses" value={String(stats.losses)} tone="loss" />
        <StatCard
          label="Win rate"
          value={`${stats.winRate.toFixed(1)}%`}
          tone={
            stats.winRate >= 50
              ? "win"
              : stats.wins + stats.losses
                ? "loss"
                : undefined
          }
          hint={`${stats.wins}/${stats.wins + stats.losses} closed`}
        />
      </div>

      {/* Week workspace */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            <CalendarDays className="size-4" /> Week workspace
            <span className="text-sm font-normal text-muted-foreground">
              shared data for the week of {fmtDate(week)} (Mon)
            </span>
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              onClick={() => shiftWeek(-1)}
            >
              ‹ Prev
            </Button>
            <Input
              type="date"
              className="h-8 w-40"
              value={week}
              onChange={(e) => setWeek(weekStart(e.target.value) || week)}
            />
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              onClick={() => shiftWeek(1)}
            >
              Next ›
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8"
              onClick={() => setWeek(currentWeekStart())}
            >
              This week
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <WeekWorkspace
            key={week}
            week={week}
            context={ctxList.find((c) => c.week_start === week)}
            legList={legList}
            optionsMap={optionsMap}
            onPersistContext={persistContext}
            onPersistLeg={persistLeg}
          />
        </CardContent>
      </Card>

      {/* Analysis form */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {editingId ? "Edit analysis" : "New analysis"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Instrument</Label>
              <Select
                value={draft.instrument || undefined}
                onValueChange={(v) => patch({ instrument: v })}
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

            <div className="space-y-1.5">
              <Label className="text-xs">Bias</Label>
              <Select
                value={draft.bias}
                onValueChange={(v) => patch({ bias: v as BiasValue })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BIAS_OPTIONS.map((b) => (
                    <SelectItem key={b.value} value={b.value}>
                      {b.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Start date</Label>
              <Input
                type="date"
                value={draft.startDate}
                onChange={(e) => patch({ startDate: e.target.value })}
              />
              <p className="text-[11px] text-muted-foreground">
                Week: {fmtDate(draftWeek)}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Period (weeks)</Label>
              <Input
                inputMode="numeric"
                value={draft.weeks}
                onChange={(e) => patch({ weeks: e.target.value })}
              />
              <p className="text-[11px] text-muted-foreground">
                Ends: {fmtDate(endPreview)}
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Chart URL (optional)</Label>
              <Input
                type="url"
                value={draft.chartUrl}
                onChange={(e) => patch({ chartUrl: e.target.value })}
                placeholder="https://www.tradingview.com/…"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-1">
              <Label className="text-xs">Analysis / notes (optional)</Label>
              <Textarea
                rows={2}
                value={draft.notes}
                onChange={(e) => patch({ notes: e.target.value })}
                placeholder="Why this bias? Key levels, draw on liquidity, narrative…"
              />
            </div>
          </div>

          {/* Pair-level COT — only for FX pairs */}
          {draftIsPair && (
            <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
              <h4 className="text-sm font-semibold">
                Pair-level COT
                <span className="ml-2 font-normal text-muted-foreground">
                  {bridgePair
                    ? "(auto-filled from quant-bridge)"
                    : "(from the FX Parovi report)"}
                </span>
              </h4>
              <div className="grid gap-3 sm:grid-cols-3">
                {PAIR_FACTORS.map((f) => (
                  <div key={f.name} className="space-y-1.5">
                    <Label className="text-xs">{f.label}</Label>
                    {bridgePair ? (
                      <div className="flex h-9 items-center rounded-md border bg-background px-3 text-sm">
                        {draft.pair[f.name] || "—"}
                      </div>
                    ) : (
                      <EditableSelect
                        listKey={f.listKey}
                        options={optionsMap[f.listKey] ?? []}
                        value={draft.pair[f.name] ?? ""}
                        onChange={(v) => patchPair(f.name, v)}
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {draftIsSingle && (
            <p className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              COT for {draft.instrument} is set directly on its{" "}
              {legsForSymbol(draft.instrument)
                .map((c) => legLabel(c))
                .join(", ")}{" "}
              card in the week workspace above.
            </p>
          )}

          {/* Inherited preview */}
          {draft.instrument && (
            <div className="rounded-lg border border-dashed p-3">
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                Inherited from the week of {fmtDate(draftWeek)} (auto-attached)
              </p>
              {inherited.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No shared data for this week yet — fill the week workspace
                  above.
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {inherited.map((f) => (
                    <Badge
                      key={f.name}
                      variant="secondary"
                      className="font-normal"
                    >
                      <span className="text-muted-foreground">{f.label}:</span>{" "}
                      {f.value}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2">
            {editingId && (
              <Button variant="outline" onClick={resetForm} disabled={pending}>
                Cancel
              </Button>
            )}
            <Button onClick={submit} disabled={pending}>
              <Plus className="size-4" />
              {pending
                ? "Saving…"
                : editingId
                  ? "Update analysis"
                  : "Add analysis"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* What works best — combinations */}
      <CombosCard resolved={resolved} />

      {/* Breakdown */}
      {analyses.length > 0 && (
        <div className="grid gap-3 lg:grid-cols-2">
          <BreakdownCard title="By instrument" rows={byInstrument} />
          <BreakdownCard title="By bias" rows={byBias} />
        </div>
      )}

      {/* List */}
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-2 space-y-0 pb-3">
          <CardTitle className="text-base">Analyses</CardTitle>
          <div className="flex gap-1">
            {(["all", "open", "win", "loss"] as const).map((f) => (
              <Button
                key={f}
                size="sm"
                variant={filter === f ? "default" : "outline"}
                onClick={() => setFilter(f)}
                className="h-7 px-2.5 capitalize"
              >
                {f}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {visible.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No analyses yet. Add your first bias above.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>Instrument</TableHead>
                    <TableHead>Bias</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((a) => {
                    const factors = factorsById.get(a.id) ?? [];
                    const dataFactors = factors.filter((f) => f.name !== "bias");
                    const isOpen = expanded.has(a.id);
                    return (
                      <Fragment key={a.id}>
                        <TableRow>
                          <TableCell className="align-top">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="size-7 text-muted-foreground"
                              onClick={() => toggleExpanded(a.id)}
                              disabled={dataFactors.length === 0}
                              title={
                                dataFactors.length
                                  ? "Show data factors"
                                  : "No data factors"
                              }
                            >
                              {isOpen ? (
                                <ChevronDown className="size-4" />
                              ) : (
                                <ChevronRight className="size-4" />
                              )}
                            </Button>
                          </TableCell>
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-2">
                              {a.instrument ?? "—"}
                              {a.chart_url && (
                                <a
                                  href={a.chart_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-muted-foreground hover:text-foreground"
                                  title="Open chart"
                                >
                                  <ExternalLink className="size-3.5" />
                                </a>
                              )}
                              {dataFactors.length > 0 && (
                                <Badge
                                  variant="outline"
                                  className="text-[10px] text-muted-foreground"
                                >
                                  {dataFactors.length} data
                                </Badge>
                              )}
                            </div>
                            {a.notes && (
                              <p className="mt-0.5 max-w-xs truncate text-xs text-muted-foreground">
                                {a.notes}
                              </p>
                            )}
                          </TableCell>
                          <TableCell>
                            <BiasBadge bias={a.bias} />
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-sm">
                            <div>
                              {fmtDate(a.start_date)} → {fmtDate(a.end_date)}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {a.period_weeks} week
                              {a.period_weeks > 1 ? "s" : ""}
                            </div>
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={a.status} />
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center justify-end gap-1">
                              {a.status === "open" ? (
                                <>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 gap-1 px-2 text-emerald-600 dark:text-emerald-400"
                                    onClick={() => close(a.id, "win")}
                                    disabled={pending}
                                    title="Bias was correct"
                                  >
                                    <Check className="size-3.5" /> Win
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 gap-1 px-2 text-destructive"
                                    onClick={() => close(a.id, "loss")}
                                    disabled={pending}
                                    title="Bias was wrong"
                                  >
                                    <X className="size-3.5" /> Loss
                                  </Button>
                                </>
                              ) : (
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="size-7"
                                  onClick={() => reopen(a.id)}
                                  disabled={pending}
                                  title="Re-open"
                                >
                                  <RotateCcw className="size-3.5" />
                                </Button>
                              )}
                              <Button
                                size="icon"
                                variant="ghost"
                                className="size-7"
                                onClick={() => edit(a)}
                                disabled={pending}
                                title="Edit"
                              >
                                <Pencil className="size-3.5" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="size-7 text-muted-foreground"
                                onClick={() => remove(a.id)}
                                disabled={pending}
                                title="Delete"
                              >
                                <Trash2 className="size-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                        {isOpen && dataFactors.length > 0 && (
                          <TableRow className="bg-muted/30">
                            <TableCell />
                            <TableCell colSpan={5}>
                              <div className="flex flex-wrap gap-1.5 py-1">
                                {dataFactors.map((f) => (
                                  <Badge
                                    key={f.name}
                                    variant="secondary"
                                    className="font-normal"
                                  >
                                    <span className="text-muted-foreground">
                                      {f.label}:
                                    </span>{" "}
                                    {f.value}
                                  </Badge>
                                ))}
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function WeekWorkspace({
  week,
  context,
  legList,
  optionsMap,
  onPersistContext,
  onPersistLeg,
}: {
  week: string;
  context: MarketContext | undefined;
  legList: CotLeg[];
  optionsMap: OptionsMap;
  onPersistContext: (values: Record<string, string>) => void;
  onPersistLeg: (code: string, values: Record<string, string>) => void;
}) {
  // Seeded once on mount; the parent remounts (key={week}) on week change.
  const [ctxValues, setCtxValues] = useState<Record<string, string>>(() =>
    ctxToValues(context),
  );
  const [legValues, setLegValues] = useState<
    Record<string, Record<string, string>>
  >(() => {
    const m: Record<string, Record<string, string>> = {};
    for (const code of [...FX_CURRENCY_LEGS, ...SINGLE_UNDERLYINGS]) {
      m[code] = legToValues(
        legList.find((l) => l.week_start === week && l.underlying === code),
      );
    }
    return m;
  });
  const [saveState, setSaveState] = useState<
    Record<string, "saving" | "saved">
  >({});

  function runSave(
    key: string,
    fn: () => Promise<{ ok: boolean; error?: string }>,
  ) {
    setSaveState((s) => ({ ...s, [key]: "saving" }));
    fn().then((res) => {
      if (!res.ok) {
        toast.error(res.error ?? "Save failed");
        setSaveState((s) => {
          const n = { ...s };
          delete n[key];
          return n;
        });
        return;
      }
      setSaveState((s) => ({ ...s, [key]: "saved" }));
      setTimeout(() => {
        setSaveState((s) => {
          if (s[key] !== "saved") return s;
          const n = { ...s };
          delete n[key];
          return n;
        });
      }, 1500);
    });
  }

  function saveContextField(name: string, value: string) {
    const next = { ...ctxValues, [name]: value };
    setCtxValues(next);
    onPersistContext(next);
    runSave("context", () =>
      upsertMarketContext(
        week,
        Object.fromEntries(GLOBAL_NAMES.map((n) => [n, next[n] || null])),
      ),
    );
  }

  function saveLegField(code: string, name: string, value: string) {
    const next = { ...(legValues[code] ?? {}), [name]: value };
    setLegValues((v) => ({ ...v, [code]: next }));
    onPersistLeg(code, next);
    runSave(`leg:${code}`, () =>
      upsertCotLeg(
        week,
        code,
        Object.fromEntries(LEG_FIELD_NAMES.map((n) => [n, next[n] || null])),
      ),
    );
  }

  return (
    <div className="space-y-4">
      {/* Global context */}
      <div className="rounded-lg border bg-muted/30 p-3">
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-sm font-semibold">
            Global context
            <span className="ml-2 font-normal text-muted-foreground">
              (same for all 9 symbols this week)
            </span>
          </h4>
          <SavedFlag state={saveState["context"]} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {GLOBAL_FACTORS.map((f) => (
            <div key={f.name} className="space-y-1.5">
              <Label className="text-xs">{f.label}</Label>
              <EditableSelect
                listKey={f.listKey}
                options={optionsMap[f.listKey] ?? []}
                value={ctxValues[f.name] ?? ""}
                onChange={(v) => saveContextField(f.name, v)}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Per-currency / per-underlying COT */}
      <div className="rounded-lg border bg-muted/30 p-3">
        <h4 className="mb-2 text-sm font-semibold">
          Currency / underlying COT
          <span className="ml-2 font-normal text-muted-foreground">
            (entered once per leg, reused by every pair)
          </span>
        </h4>
        <div className="grid gap-3 lg:grid-cols-2">
          {[...FX_CURRENCY_LEGS, ...SINGLE_UNDERLYINGS].map((code) => (
            <LegCard
              key={code}
              code={code}
              optionsMap={optionsMap}
              values={legValues[code] ?? {}}
              saveState={saveState[`leg:${code}`]}
              onChange={(name, v) => saveLegField(code, name, v)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function SavedFlag({ state }: { state?: "saving" | "saved" }) {
  if (state === "saving")
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" /> Saving…
      </span>
    );
  if (state === "saved")
    return (
      <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
        <Check className="size-3" /> Saved
      </span>
    );
  return null;
}

function LegCard({
  code,
  optionsMap,
  values,
  saveState,
  onChange,
}: {
  code: string;
  optionsMap: OptionsMap;
  values: Record<string, string>;
  saveState?: "saving" | "saved";
  onChange: (name: string, value: string) => void;
}) {
  const fields = factorsForLeg(code);
  const isSingle = SINGLE_UNDERLYINGS.includes(code);
  const filled = fields.filter((f) => values[f.name]).length;
  return (
    <div className="rounded-md border bg-background p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm font-medium">
          <Badge variant={isSingle ? "outline" : "secondary"}>{code}</Badge>
          {legLabel(code)}
          {filled > 0 && (
            <span className="text-xs text-muted-foreground">{filled}</span>
          )}
        </span>
        <SavedFlag state={saveState} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((f) => (
          <div key={f.name} className="space-y-1.5">
            <Label className="text-xs">{f.label}</Label>
            <EditableSelect
              listKey={f.listKey}
              options={optionsMap[f.listKey] ?? []}
              value={values[f.name] ?? ""}
              onChange={(v) => onChange(f.name, v)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function CombosCard({ resolved }: { resolved: ResolvedAnalysis[] }) {
  const [instrument, setInstrument] = useState<string>("all");
  const [size, setSize] = useState<"all" | "1" | "2" | "3">("all");
  const [minSample, setMinSample] = useState<string>("3");

  const closedInstruments = useMemo(() => {
    const s = new Set<string>();
    for (const r of resolved) {
      const a = r.analysis;
      if ((a.status === "win" || a.status === "loss") && a.instrument)
        s.add(a.instrument);
    }
    return Array.from(s).sort();
  }, [resolved]);

  const combos = useMemo(
    () =>
      bestCombos(resolved, {
        instrument: instrument === "all" ? null : instrument,
        size: size === "all" ? "all" : Number(size),
        minSample: Math.max(1, Number(minSample) || 1),
        maxSize: 3,
        limit: 25,
      }),
    [resolved, instrument, size, minSample],
  );

  const hasClosed = closedInstruments.length > 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="size-4" /> Što najbolje radi (kombinacije)
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Kombinacije faktora (bias + data podaci kroz sve nivoe) rangirane po
          winrate-u, samo iz zatvorenih analiza. Mali uzorak nije pouzdan —
          gledaj i W/L brojač.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Instrument</Label>
            <Select value={instrument} onValueChange={setInstrument}>
              <SelectTrigger className="h-8 w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Svi instrumenti</SelectItem>
                {closedInstruments.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Veličina kombinacije</Label>
            <Select value={size} onValueChange={(v) => setSize(v as typeof size)}>
              <SelectTrigger className="h-8 w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">1–3 faktora</SelectItem>
                <SelectItem value="1">1 faktor</SelectItem>
                <SelectItem value="2">2 faktora</SelectItem>
                <SelectItem value="3">3 faktora</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Min uzorak</Label>
            <Input
              className="h-8 w-24"
              inputMode="numeric"
              value={minSample}
              onChange={(e) => setMinSample(e.target.value)}
            />
          </div>
        </div>

        {!hasClosed ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Još nema zatvorenih (Win/Loss) analiza. Zatvori nekoliko da bi se
            pojavile kombinacije.
          </p>
        ) : combos.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Nema kombinacija sa min uzorkom {minSample}. Smanji prag ili dodaj
            više analiza.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kombinacija</TableHead>
                  <TableHead className="text-right">W/L</TableHead>
                  <TableHead className="text-right">Uzorak</TableHead>
                  <TableHead className="text-right">Win rate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {combos.map((c, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <div className="flex flex-wrap gap-1.5">
                        {c.factors.map((f) => (
                          <Badge
                            key={f.name}
                            variant="secondary"
                            className="font-normal"
                          >
                            <span className="text-muted-foreground">
                              {f.label}:
                            </span>{" "}
                            {f.value}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {c.wins}/{c.losses}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {c.total}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right font-semibold tabular-nums",
                        c.winRate >= 50
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-destructive",
                      )}
                    >
                      {c.winRate.toFixed(0)}%
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

type BreakdownRow = {
  key: string;
  total: number;
  open: number;
  wins: number;
  losses: number;
  winRate: number;
};

function breakdown(
  rows: BiasAnalysis[],
  field: "instrument" | "bias",
): BreakdownRow[] {
  const groups = new Map<string, BiasAnalysis[]>();
  for (const r of rows) {
    const raw = r[field];
    const key = typeof raw === "string" && raw ? raw : "—";
    const arr = groups.get(key) ?? [];
    arr.push(r);
    groups.set(key, arr);
  }
  const out: BreakdownRow[] = [];
  for (const [key, arr] of groups) {
    let open = 0,
      wins = 0,
      losses = 0;
    for (const a of arr) {
      if (a.status === "win") wins++;
      else if (a.status === "loss") losses++;
      else open++;
    }
    const closed = wins + losses;
    out.push({
      key,
      total: arr.length,
      open,
      wins,
      losses,
      winRate: closed > 0 ? (wins / closed) * 100 : 0,
    });
  }
  return out.sort((a, b) => b.winRate - a.winRate || b.total - a.total);
}

function StatCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "win" | "loss";
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p
          className={cn(
            "text-2xl font-semibold tabular-nums",
            tone === "win" && "text-emerald-600 dark:text-emerald-400",
            tone === "loss" && "text-destructive",
          )}
        >
          {value}
        </p>
        {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

function BreakdownCard({
  title,
  rows,
}: {
  title: string;
  rows: BreakdownRow[];
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="h-8">Key</TableHead>
              <TableHead className="h-8 text-right">W/L</TableHead>
              <TableHead className="h-8 text-right">Open</TableHead>
              <TableHead className="h-8 text-right">Win rate</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.key}>
                <TableCell className="py-1.5 capitalize">{r.key}</TableCell>
                <TableCell className="py-1.5 text-right tabular-nums">
                  {r.wins}/{r.losses}
                </TableCell>
                <TableCell className="py-1.5 text-right tabular-nums text-muted-foreground">
                  {r.open}
                </TableCell>
                <TableCell className="py-1.5 text-right font-medium tabular-nums">
                  {r.wins + r.losses > 0 ? `${r.winRate.toFixed(0)}%` : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function BiasBadge({ bias }: { bias: BiasValue }) {
  if (bias === "bullish")
    return (
      <Badge className="bg-emerald-600 text-white dark:bg-emerald-500/80">
        <TrendingUp className="size-3" /> Bullish
      </Badge>
    );
  if (bias === "bearish")
    return (
      <Badge variant="destructive">
        <TrendingDown className="size-3" /> Bearish
      </Badge>
    );
  return (
    <Badge variant="secondary">
      <Minus className="size-3" /> Neutral
    </Badge>
  );
}

function StatusBadge({ status }: { status: BiasAnalysis["status"] }) {
  if (status === "win")
    return (
      <Badge className="bg-emerald-600 text-white dark:bg-emerald-500/80">
        Win
      </Badge>
    );
  if (status === "loss") return <Badge variant="destructive">Loss</Badge>;
  return <Badge variant="outline">Open</Badge>;
}
