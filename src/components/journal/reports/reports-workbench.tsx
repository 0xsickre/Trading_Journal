"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toRealized, type PnlMode } from "@/lib/journal/analytics";
import { enrichTrades, type DailyReportLite, type FillCounts } from "@/lib/journal/enriched-trade";
import {
  EXACT_ZERO_RANGE,
  resolveBreakevenRange,
} from "@/lib/journal/breakeven";
import { buildInsightContext } from "@/lib/journal/insights/context";
import { runInsights } from "@/lib/journal/insights/registry";
import {
  DIMENSION_GROUP_LABELS,
  DIMENSION_GROUP_ORDER,
  allDimensions,
  customFieldDimensions,
  type DimensionContext,
} from "@/lib/journal/reports/dimensions";
import {
  DEFAULT_MIN_SAMPLE,
  runReport,
  summarizeReport,
} from "@/lib/journal/reports/engine";
import { runPivot } from "@/lib/journal/reports/pivot";
import { METRICS, getMetric } from "@/lib/journal/reports/metrics";
import {
  fromSearchParams,
  toSearchParams,
  type FilterSet,
} from "@/lib/journal/reports/filters";
import { VIEW_MODES, type ViewMode } from "@/lib/journal/units";
import { FilterBar } from "@/components/journal/reports/filter-bar";
import { PerformanceSummaryPanel } from "@/components/journal/reports/performance-summary";
import { ReportChart, MAX_CHART_METRICS } from "@/components/journal/reports/report-chart";
import { ReportTable } from "@/components/journal/reports/report-table";
import { CrossAnalysis } from "@/components/journal/reports/cross-analysis";
import { CompareView } from "@/components/journal/reports/compare-view";
import type { Account, TradeRow } from "@/lib/journal/types";
import type { FieldDef } from "@/lib/journal/field-def-types";
import type { CashEvent } from "@/lib/journal/balance";

const DEFAULT_COLUMNS = [
  "net_pnl",
  "trade_count",
  "win_rate",
  "profit_factor",
  "expectancy",
  "avg_r",
];

export function ReportsWorkbench({
  trades,
  accounts,
  dailyReports = [],
  fillCounts,
  cashEvents = [],
  fieldDefs = [],
}: {
  trades: TradeRow[];
  accounts: Account[];
  dailyReports?: DailyReportLite[];
  fillCounts?: FillCounts;
  cashEvents?: CashEvent[];
  /** User-defined fields — each becomes a groupable dimension on its own. */
  fieldDefs?: FieldDef[];
}) {
  const router = useRouter();
  const params = useSearchParams();

  // A custom field is a dimension like any other: built here, carried on the
  // dimension context, and resolvable by key. The engine knows nothing about it.
  const customDimensions = useMemo(
    () => customFieldDimensions(fieldDefs),
    [fieldDefs],
  );
  const dimensions = useMemo(
    () => allDimensions(customDimensions),
    [customDimensions],
  );

  // Report state lives in the URL: a report you cannot bookmark or send to
  // yourself is a report you re-derive by hand every time.
  const filters = useMemo<FilterSet>(
    () => fromSearchParams(params),
    [params],
  );
  const dimensionKey = params.get("dim") ?? "setup_grade";
  const crossKey = params.get("cross") ?? "";
  const metricKey = params.get("metric") ?? "net_pnl";
  const viewMode = (params.get("view") as ViewMode) ?? "dollars";
  const pnlBasis = (params.get("basis") as PnlMode) ?? "net";
  const chartType = (params.get("chart") as "bar" | "line") ?? "bar";
  const sortBy = params.get("sort") ?? undefined;
  const minSample = Number(params.get("min") ?? DEFAULT_MIN_SAMPLE);
  const mode = params.get("mode") ?? "single";

  const setParam = useCallback(
    (patch: Record<string, string | undefined>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v == null || v === "") next.delete(k);
        else next.set(k, v);
      }
      router.replace(`/reports?${next.toString()}`, { scroll: false });
    },
    [params, router],
  );

  const setFilters = useCallback(
    (next: FilterSet) => {
      const preserved = new URLSearchParams();
      for (const k of ["dim", "cross", "metric", "view", "basis", "chart", "sort", "min", "mode", "cols"]) {
        const v = params.get(k);
        if (v) preserved.set(k, v);
      }
      const fp = toSearchParams(next);
      for (const [k, v] of fp.entries()) preserved.append(k, v);
      router.replace(`/reports?${preserved.toString()}`, { scroll: false });
    },
    [params, router],
  );

  const columnKeys = useMemo(
    () => params.get("cols")?.split(",").filter(Boolean) ?? DEFAULT_COLUMNS,
    [params],
  );

  const tzOf = useCallback(
    (t: { row: TradeRow }) =>
      accounts.find((a) => a.id === t.row.account_id)?.timezone ??
      "America/New_York",
    [accounts],
  );

  // A single band only when every account in scope agrees; otherwise the same
  // P&L would be classified differently depending on where it came from.
  const range = useMemo(() => {
    const scoped = filters.accountIds?.length
      ? accounts.filter((a) => filters.accountIds!.includes(a.id))
      : accounts;
    if (scoped.length === 0) return EXACT_ZERO_RANGE;
    const ranges = scoped.map((a) => resolveBreakevenRange(a));
    const first = ranges[0];
    return ranges.every((r) => r.from === first.from && r.to === first.to)
      ? first
      : EXACT_ZERO_RANGE;
  }, [accounts, filters.accountIds]);

  const pnlOf = useCallback(
    (t: { net: number; gross: number }) =>
      pnlBasis === "net" ? t.net : t.gross,
    [pnlBasis],
  );

  const enriched = useMemo(
    () =>
      enrichTrades(toRealized(trades), {
        tzOf,
        range,
        pnlOf,
        fillCounts,
      }),
    [trades, tzOf, range, pnlOf, fillCounts],
  );

  const currency = useMemo(() => {
    const set = new Set(accounts.map((a) => a.currency));
    return set.size === 1 ? [...set][0] : "USD";
  }, [accounts]);

  const equityBase = useMemo(() => {
    const scoped = filters.accountIds?.length
      ? accounts.filter((a) => filters.accountIds!.includes(a.id))
      : accounts;
    const start = scoped.reduce((s, a) => s + (a.starting_balance ?? 0), 0);
    const flow = cashEvents
      .filter((c) => !filters.accountIds?.length || filters.accountIds.includes(c.account_id))
      .reduce((s, c) => s + c.amount, 0);
    const base = start + flow;
    return base > 0 ? base : null;
  }, [accounts, cashEvents, filters.accountIds]);

  // Insights double as a dimension and as a filter, so they are evaluated once
  // and indexed by trade.
  const insightsByTrade = useMemo(() => {
    const ctx = buildInsightContext({
      trades: toRealized(trades),
      allRows: trades,
      reports: dailyReports,
      tzOf,
      range,
      pnlOf,
      currency,
      fillCounts,
    });
    const map = new Map<string, string[]>();
    for (const i of runInsights(ctx).insights) {
      if (i.level !== "trade") continue;
      map.set(i.subjectId, [...(map.get(i.subjectId) ?? []), i.ruleId]);
    }
    return map;
  }, [trades, dailyReports, tzOf, range, pnlOf, currency, fillCounts]);

  const dimensionContext = useMemo<DimensionContext>(
    () => ({
      reportByDate: new Map(dailyReports.map((r) => [r.report_date, r])),
      insightsByTrade,
      accountNames: new Map(accounts.map((a) => [a.id, a.name])),
      customDimensions,
    }),
    [dailyReports, insightsByTrade, accounts, customDimensions],
  );

  const metricContext = useMemo(
    () => ({ pnlBasis, range, currency }),
    [pnlBasis, range, currency],
  );

  const result = useMemo(
    () =>
      runReport({
        trades: enriched,
        dimension: dimensionKey,
        metricKeys: columnKeys,
        filters,
        dimensionContext,
        metricContext,
        minSample,
        sortBy,
      }),
    [
      enriched,
      dimensionKey,
      columnKeys,
      filters,
      dimensionContext,
      metricContext,
      minSample,
      sortBy,
    ],
  );

  const pivot = useMemo(
    () =>
      crossKey
        ? runPivot({
            trades: enriched,
            rowDimension: dimensionKey,
            colDimension: crossKey,
            metricKey,
            filters,
            dimensionContext,
            metricContext,
            minSample,
          })
        : null,
    [
      enriched,
      dimensionKey,
      crossKey,
      metricKey,
      filters,
      dimensionContext,
      metricContext,
      minSample,
    ],
  );

  const [chartMetrics, setChartMetrics] = useState<string[]>(["net_pnl"]);
  const selectedMetric = getMetric(metricKey) ?? METRICS[0];

  const dimensionPicker = (
    <Select value={dimensionKey} onValueChange={(v) => setParam({ dim: v })}>
      <SelectTrigger className="h-9 w-52">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {DIMENSION_GROUP_ORDER.map((g) => {
          const inGroup = dimensions.filter((d) => d.group === g);
          if (inGroup.length === 0) return null;
          return (
            <div key={g}>
              <div className="px-2 py-1 text-xs text-muted-foreground">
                {DIMENSION_GROUP_LABELS[g]}
              </div>
              {inGroup.map((d) => (
                <SelectItem key={d.key} value={d.key}>
                  {d.label}
                </SelectItem>
              ))}
            </div>
          );
        })}
      </SelectContent>
    </Select>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">Grupiši po</span>
        {dimensionPicker}

        <span className="text-sm text-muted-foreground">×</span>
        <Select
          value={crossKey || "none"}
          onValueChange={(v) => setParam({ cross: v === "none" ? undefined : v })}
        >
          <SelectTrigger className="h-9 w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Bez cross-analize</SelectItem>
            {dimensions.filter((d) => d.key !== dimensionKey).map((d) => (
              <SelectItem key={d.key} value={d.key}>
                {d.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {/* Gross/net is an aggregation parameter, not a display toggle: it
              changes what every metric measures, so it sits with the data
              controls rather than with the formatting ones. */}
          <div className="flex rounded-md border p-0.5">
            {(["net", "gross"] as const).map((b) => (
              <button
                key={b}
                onClick={() => setParam({ basis: b })}
                className={`rounded px-2 py-1 text-xs ${
                  pnlBasis === b
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground"
                }`}
              >
                {b === "net" ? "Net" : "Gross"}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap rounded-md border p-0.5">
            {VIEW_MODES.map((m) => (
              <button
                key={m.value}
                onClick={() => setParam({ view: m.value })}
                className={`rounded px-2 py-1 text-xs ${
                  viewMode === m.value
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground"
                }`}
                title={
                  m.value === "privacy"
                    ? "Sakrij novčane iznose"
                    : `Prikaži u ${m.label}`
                }
              >
                {m.label}
              </button>
            ))}
          </div>

          <Select value={String(minSample)} onValueChange={(v) => setParam({ min: v })}>
            <SelectTrigger className="h-9 w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[1, 3, 5, 10, 20].map((n) => (
                <SelectItem key={n} value={String(n)}>
                  prag n≥{n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex rounded-md border p-0.5">
            {(["single", "compare"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setParam({ mode: m === "single" ? undefined : m })}
                className={`rounded px-2 py-1 text-xs ${
                  mode === m
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground"
                }`}
              >
                {m === "single" ? "Jedan" : "Poređenje"}
              </button>
            ))}
          </div>
        </div>
      </div>

      <FilterBar
        filters={filters}
        onChange={setFilters}
        trades={enriched}
        dimensionContext={dimensionContext}
        dimensions={dimensions}
        accounts={accounts}
      />

      {mode === "compare" ? (
        <CompareView
          trades={enriched}
          dimensions={dimensions}
          baseFilters={filters}
          dimensionContext={dimensionContext}
          metricContext={metricContext}
          dimensionKey={dimensionKey}
          columnKeys={columnKeys}
          minSample={minSample}
          viewMode={viewMode}
          currency={currency}
          equityBase={equityBase}
        />
      ) : (
        result && (
          <>
            <PerformanceSummaryPanel
              summary={summarizeReport(result, metricKey)}
              metric={selectedMetric}
              viewMode={viewMode}
              currency={currency}
              equityBase={equityBase}
              minSample={minSample}
            />

            <ReportChart
              result={result}
              metricKeys={chartMetrics}
              chartType={chartType}
              viewMode={viewMode}
              currency={currency}
              equityBase={equityBase}
              action={
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex rounded-md border p-0.5">
                    {(["bar", "line"] as const).map((t) => (
                      <button
                        key={t}
                        onClick={() => setParam({ chart: t })}
                        className={`rounded px-2 py-0.5 text-xs ${
                          chartType === t
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground"
                        }`}
                      >
                        {t === "bar" ? "Stubići" : "Linija"}
                      </button>
                    ))}
                  </div>
                  <Select
                    value={chartMetrics[chartMetrics.length - 1] ?? "net_pnl"}
                    onValueChange={(v) =>
                      setChartMetrics((prev) =>
                        prev.includes(v)
                          ? prev.filter((x) => x !== v)
                          : [...prev, v].slice(-MAX_CHART_METRICS),
                      )
                    }
                  >
                    <SelectTrigger className="h-8 w-44">
                      <SelectValue placeholder="Metrike" />
                    </SelectTrigger>
                    <SelectContent>
                      {columnKeys.map((k) => {
                        const m = getMetric(k);
                        if (!m) return null;
                        return (
                          <SelectItem key={k} value={k}>
                            {chartMetrics.includes(k) ? "✓ " : ""}
                            {m.label}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>
              }
            />

            <ReportTable
              result={result}
              viewMode={viewMode}
              currency={currency}
              equityBase={equityBase}
              sortBy={sortBy}
              onSort={(k) => setParam({ sort: k })}
            />

            {pivot && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-muted-foreground">
                    Metrika u ćelijama
                  </span>
                  <Select
                    value={metricKey}
                    onValueChange={(v) => setParam({ metric: v })}
                  >
                    <SelectTrigger className="h-8 w-52">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {METRICS.map((m) => (
                        <SelectItem key={m.key} value={m.key}>
                          {m.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <CrossAnalysis
                  result={pivot}
                  viewMode={viewMode}
                  currency={currency}
                  equityBase={equityBase}
                />
              </div>
            )}
          </>
        )
      )}

      <div className="flex justify-end">
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => router.replace("/reports", { scroll: false })}
        >
          Resetuj report
        </Button>
      </div>
    </div>
  );
}
