"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
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
  Instrument,
  OptionsMap,
} from "@/lib/journal/types";
import {
  ANALYSIS_FACTORS,
  ANALYSIS_FACTOR_NAMES,
  ANALYSIS_GROUPS,
  factorsByGroup,
  type AnalysisGroup,
} from "@/lib/journal/analysis-config";
import { bestCombos } from "@/lib/journal/combos";
import {
  createBiasAnalysis,
  updateBiasAnalysis,
  closeBiasAnalysis,
  reopenBiasAnalysis,
  deleteBiasAnalysis,
} from "@/app/(app)/analysis/actions";

const BIAS_OPTIONS: { value: BiasValue; label: string }[] = [
  { value: "bullish", label: "Bullish" },
  { value: "bearish", label: "Bearish" },
  { value: "neutral", label: "Neutral" },
];

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

function emptyFactors(): Record<string, string> {
  return Object.fromEntries(ANALYSIS_FACTOR_NAMES.map((n) => [n, ""]));
}

type Draft = {
  instrument: string;
  bias: BiasValue;
  startDate: string;
  weeks: string;
  conviction: string;
  notes: string;
  chartUrl: string;
  factors: Record<string, string>;
};

function emptyDraft(): Draft {
  return {
    instrument: "",
    bias: "bullish",
    startDate: today(),
    weeks: "1",
    conviction: "",
    notes: "",
    chartUrl: "",
    factors: emptyFactors(),
  };
}

/** Filled (non-empty) data factors on a saved analysis, for display. */
function filledFactors(a: BiasAnalysis) {
  return ANALYSIS_FACTORS.map((f) => ({
    label: f.label,
    value: (a[f.name as keyof BiasAnalysis] as string | null) ?? null,
  })).filter((x) => x.value && x.value.trim() !== "");
}

export function BiasAnalysisBoard({
  analyses,
  instruments,
  optionsMap,
}: {
  analyses: BiasAnalysis[];
  instruments: Instrument[];
  optionsMap: OptionsMap;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "open" | "win" | "loss">("all");
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

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
      filter === "all"
        ? analyses
        : analyses.filter((a) => a.status === filter),
    [analyses, filter],
  );

  const endPreview = computeEndDate(draft.startDate, Number(draft.weeks));

  function patch(p: Partial<Draft>) {
    setDraft((d) => ({ ...d, ...p }));
  }

  function patchFactor(name: string, value: string) {
    setDraft((d) => ({ ...d, factors: { ...d.factors, [name]: value } }));
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
    const factors: Record<string, string | null> = {};
    for (const name of ANALYSIS_FACTOR_NAMES)
      factors[name] = draft.factors[name] || null;

    const payload = {
      instrument: draft.instrument,
      bias: draft.bias,
      start_date: draft.startDate,
      period_weeks: Math.floor(weeks),
      conviction: draft.conviction,
      notes: draft.notes,
      chart_url: draft.chartUrl,
      factors,
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
    const factors = emptyFactors();
    for (const name of ANALYSIS_FACTOR_NAMES)
      factors[name] = (a[name as keyof BiasAnalysis] as string | null) ?? "";
    setDraft({
      instrument: a.instrument ?? "",
      bias: a.bias,
      startDate: a.start_date,
      weeks: String(a.period_weeks),
      conviction: a.conviction ?? "",
      notes: a.notes ?? "",
      chartUrl: a.chart_url ?? "",
      factors,
    });
    // Open groups that have values so the user sees them.
    const toOpen: Record<string, boolean> = {};
    for (const g of ANALYSIS_GROUPS) {
      toOpen[g] = factorsByGroup(g).some((f) => factors[f.name]);
    }
    setOpenGroups(toOpen);
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

  const filledInDraft = ANALYSIS_FACTOR_NAMES.filter(
    (n) => draft.factors[n],
  ).length;

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
          tone={stats.winRate >= 50 ? "win" : stats.wins + stats.losses ? "loss" : undefined}
          hint={`${stats.wins}/${stats.wins + stats.losses} closed`}
        />
      </div>

      {/* Form */}
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
              <Label className="text-xs">Conviction (optional)</Label>
              <Input
                value={draft.conviction}
                onChange={(e) => patch({ conviction: e.target.value })}
                placeholder="e.g. High / Medium / Low"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Chart URL (optional)</Label>
              <Input
                type="url"
                value={draft.chartUrl}
                onChange={(e) => patch({ chartUrl: e.target.value })}
                placeholder="https://www.tradingview.com/…"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs">Analysis / notes (optional)</Label>
              <Textarea
                rows={3}
                value={draft.notes}
                onChange={(e) => patch({ notes: e.target.value })}
                placeholder="Why this bias? Key levels, draw on liquidity, narrative…"
              />
            </div>
          </div>

          {/* Data factor groups */}
          <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold">Data podaci (opciono)</h4>
              {filledInDraft > 0 && (
                <Badge variant="secondary">{filledInDraft} popunjeno</Badge>
              )}
            </div>
            {ANALYSIS_GROUPS.map((group) => (
              <FactorGroup
                key={group}
                group={group}
                open={!!openGroups[group]}
                onToggle={() =>
                  setOpenGroups((g) => ({ ...g, [group]: !g[group] }))
                }
                draftFactors={draft.factors}
                optionsMap={optionsMap}
                onFactor={patchFactor}
              />
            ))}
          </div>

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
      <CombosCard analyses={analyses} />

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
                    const factors = filledFactors(a);
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
                              disabled={factors.length === 0}
                              title={
                                factors.length
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
                              {factors.length > 0 && (
                                <Badge
                                  variant="outline"
                                  className="text-[10px] text-muted-foreground"
                                >
                                  {factors.length} data
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
                            {a.conviction && (
                              <span className="ml-1 text-xs text-muted-foreground">
                                {a.conviction}
                              </span>
                            )}
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
                        {isOpen && factors.length > 0 && (
                          <TableRow className="bg-muted/30">
                            <TableCell />
                            <TableCell colSpan={5}>
                              <div className="flex flex-wrap gap-1.5 py-1">
                                {factors.map((f) => (
                                  <Badge
                                    key={f.label}
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

function FactorGroup({
  group,
  open,
  onToggle,
  draftFactors,
  optionsMap,
  onFactor,
}: {
  group: AnalysisGroup;
  open: boolean;
  onToggle: () => void;
  draftFactors: Record<string, string>;
  optionsMap: OptionsMap;
  onFactor: (name: string, value: string) => void;
}) {
  const fields = factorsByGroup(group);
  const filled = fields.filter((f) => draftFactors[f.name]).length;
  return (
    <div className="rounded-md border bg-background">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-medium"
      >
        <span className="flex items-center gap-2">
          {open ? (
            <ChevronDown className="size-4" />
          ) : (
            <ChevronRight className="size-4" />
          )}
          {group}
        </span>
        {filled > 0 && (
          <Badge variant="secondary" className="text-[10px]">
            {filled}
          </Badge>
        )}
      </button>
      {open && (
        <div className="grid gap-3 border-t p-3 sm:grid-cols-2 lg:grid-cols-3">
          {fields.map((f) => (
            <div key={f.name} className="space-y-1.5">
              <Label className="text-xs">{f.label}</Label>
              <EditableSelect
                listKey={f.listKey}
                options={optionsMap[f.listKey] ?? []}
                value={draftFactors[f.name] ?? ""}
                onChange={(v) => onFactor(f.name, v)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CombosCard({ analyses }: { analyses: BiasAnalysis[] }) {
  const [instrument, setInstrument] = useState<string>("all");
  const [size, setSize] = useState<"all" | "1" | "2" | "3">("all");
  const [minSample, setMinSample] = useState<string>("3");

  // Instruments that actually have closed analyses.
  const closedInstruments = useMemo(() => {
    const s = new Set<string>();
    for (const a of analyses) {
      if ((a.status === "win" || a.status === "loss") && a.instrument)
        s.add(a.instrument);
    }
    return Array.from(s).sort();
  }, [analyses]);

  const combos = useMemo(
    () =>
      bestCombos(analyses, {
        instrument: instrument === "all" ? null : instrument,
        size: size === "all" ? "all" : Number(size),
        minSample: Math.max(1, Number(minSample) || 1),
        maxSize: 3,
        limit: 25,
      }),
    [analyses, instrument, size, minSample],
  );

  const hasClosed = closedInstruments.length > 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="size-4" /> Što najbolje radi (kombinacije)
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Kombinacije faktora (bias + data podaci) rangirane po winrate-u, samo
          iz zatvorenih analiza. Mali uzorak nije pouzdan — gledaj i W/L brojač.
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
            <Select
              value={size}
              onValueChange={(v) => setSize(v as typeof size)}
            >
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
