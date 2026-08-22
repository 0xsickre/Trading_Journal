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
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { MAX_CHART_METRICS } from "@/components/journal/chart-shell";
import { toRealized } from "@/lib/journal/analytics";
import { enrichTrades, type DailyReportLite, type FillCounts } from "@/lib/journal/enriched-trade";
import { sharedCurrency } from "@/lib/journal/format";
import {
  sharedBreakevenRange,
} from "@/lib/journal/breakeven";
import { buildInsightContext } from "@/lib/journal/insights/context";
import type { PositionCheckin } from "@/lib/journal/position-checkin";
import { runInsights } from "@/lib/journal/insights/registry";
import {
  DIMENSION_GROUP_LABELS,
  DIMENSION_GROUP_ORDER,
  allDimensions,
  customFieldDimensions,
  tagSplitDimensions,
  type DimensionContext,
} from "@/lib/journal/reports/dimensions";
import { runReport, summarizeReport } from "@/lib/journal/reports/engine";
import {
  asChartType,
  asMinSample,
  asPnlBasis,
  asViewMode,
} from "@/lib/journal/reports/url-params";
import { runPivot } from "@/lib/journal/reports/pivot";
import { METRICS, getMetric } from "@/lib/journal/reports/metrics";
import {
  applyFilters,
  fromSearchParams,
  toSearchParams,
  type FilterSet,
} from "@/lib/journal/reports/filters";
import {
  VIEW_MODES,
  canRender,
  metric as mkMetric,
  type ViewMode,
} from "@/lib/journal/units";
import { BookOverviewPanel } from "@/components/journal/reports/book-overview";
import { FilterBar } from "@/components/journal/reports/filter-bar";
import { PerformanceSummaryPanel } from "@/components/journal/reports/performance-summary";
import dynamic from "next/dynamic";

/**
 * Lazy for the same reason the dashboard's plots are: recharts is ~840 KB and
 * this workbench renders a table by default — the chart is one of several view
 * modes, and the ones that are not charts should not pay for the library.
 */
const ReportChart = dynamic(
  () =>
    import("@/components/journal/reports/report-chart").then(
      (m) => m.ReportChart,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="h-64 w-full animate-pulse rounded-md bg-muted/40" />
    ),
  },
);
import { ReportTable } from "@/components/journal/reports/report-table";
import { CrossAnalysis } from "@/components/journal/reports/cross-analysis";
import { CompareView } from "@/components/journal/reports/compare-view";
import type { Account, OptionsMap, TradeRow } from "@/lib/journal/types";
import type { FieldDef } from "@/lib/journal/field-def-types";
import {
  buildPlaybookLookup,
  playbookDimensions,
  type PlaybookLookup,
} from "@/lib/journal/reports/playbook-dimensions";
import type { Playbook, PositionRule } from "@/lib/journal/playbook-types";
import {
  buildBalanceTimeline,
  currentEquity,
  type CashEvent,
} from "@/lib/journal/balance";
import { accountTimezoneResolver } from "@/lib/journal/time";

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
  positionCheckins = [],
  weekGrades,
  fillCounts,
  cashEvents = [],
  fieldDefs = [],
  playbooks = [],
  positionRules,
  optionsMap = {},
}: {
  trades: TradeRow[];
  accounts: Account[];
  dailyReports?: DailyReportLite[];
  /** Per-position daily check-ins — what `touched` and `thesis_state` group on. */
  positionCheckins?: PositionCheckin[];
  /** Week start → that week's review grade, for the `week_grade` dimension. */
  weekGrades?: Map<string, number>;
  fillCounts?: FillCounts;
  cashEvents?: CashEvent[];
  /** User-defined fields — each becomes a groupable dimension on its own. */
  fieldDefs?: FieldDef[];
  /** Playbooks including retired rules, so history keeps its buckets. */
  playbooks?: Playbook[];
  /** Trade id → recorded rule answers. */
  positionRules?: Map<string, PositionRule[]>;
  /** Option lists, used to cut `psychology_tags` back into emotion vs discipline. */
  optionsMap?: OptionsMap;
}) {
  const router = useRouter();
  const params = useSearchParams();

  // A custom field is a dimension like any other: built here, carried on the
  // dimension context, and resolvable by key. The engine knows nothing about it.
  const customDimensions = useMemo(
    () => customFieldDimensions(fieldDefs),
    [fieldDefs],
  );

  /**
   * Emocija and Disciplina, cut out of the single `psychology_tags` column.
   *
   * Built here rather than registered in DIMENSIONS because the split is
   * decided by the user's own option lists — the same reason the custom field
   * dimensions live on the context. They carry `group: "trade"`, so the picker
   * files them beside the column they come from.
   */
  const tagDimensions = useMemo(
    () => tagSplitDimensions(optionsMap),
    [optionsMap],
  );
  const playbookLookup = useMemo<PlaybookLookup>(
    () => buildPlaybookLookup(playbooks, positionRules),
    [playbooks, positionRules],
  );

  const dimensions = useMemo(
    () =>
      allDimensions([
        ...tagDimensions,
        ...customDimensions,
        ...playbookDimensions(playbookLookup),
      ]),
    [tagDimensions, customDimensions, playbookLookup],
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
  const sortBy = params.get("sort") ?? undefined;
  const mode = params.get("mode") ?? "single";

  // Everything below is READ FROM THE URL AND VALIDATED, never cast.
  //
  // `dim` and `metric` above are safe because they are resolved through the
  // registries, which answer undefined for a name they do not know. These four
  // were `as`-cast straight into typed variables, and TypeScript cannot check a
  // string that arrives at runtime — so a typo in a bookmarked URL became a
  // silently different report.
  //
  // The worst was `min`: `?min=abc` gives NaN, `trades.length < NaN` is false,
  // so NO row was ever flagged `belowSample` and the whole small-sample guard —
  // the mechanism that stops a three-trade bucket being crowned "best" — turned
  // itself off with no visible sign.
  const viewMode = asViewMode(params.get("view"));
  const pnlBasis = asPnlBasis(params.get("basis"));
  const chartType = asChartType(params.get("chart"));
  const minSample = asMinSample(params.get("min"));

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
    (t: { row: TradeRow }) => {
      const primary = accounts.find((a) => a.is_active) ?? accounts[0];
      return accountTimezoneResolver(accounts, primary?.timezone)(
        t.row.account_id,
      );
    },
    [accounts],
  );

  const scopedAccounts = useMemo(
    () =>
      filters.accountIds?.length
        ? accounts.filter((a) => filters.accountIds!.includes(a.id))
        : accounts,
    [accounts, filters.accountIds],
  );

  // A single band only when every account in scope agrees; otherwise the same
  // P&L would be classified differently depending on where it came from.
  const range = useMemo(
    () => sharedBreakevenRange(scopedAccounts),
    [scopedAccounts],
  );

  /**
   * Whether the accounts in scope disagree on currency. €500 and $300 summed
   * as "$800" was silently wrong here — `currency` below used to resolve over
   * EVERY account regardless of `filters.accountIds`, and `equityBase` pools
   * `net_pl` across accounts with no currency check at all. There is no safe
   * fallback number for money (unlike `range` above, which falls back to a
   * conservative exact-zero band when accounts disagree) so the render gate
   * near the bottom of this component replaces the report body with an
   * explanation instead.
   */
  const mixedCurrency =
    scopedAccounts.length > 1 && sharedCurrency(scopedAccounts) == null;

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

  // Scoped to the SAME `filters.accountIds` as `range` above — this used to
  // read every account regardless of the filter, so narrowing to one EUR
  // account while a USD account existed elsewhere still reported "USD".
  const currency = useMemo(
    () => sharedCurrency(scopedAccounts) ?? "USD",
    [scopedAccounts],
  );

  /**
   * Denominator for percentage mode.
   *
   * Equity, per `balance.ts`, is `starting balance + realized P&L + cash flow`.
   * This used to be starting balance plus cash flow only — the realized term was
   * missing, so on a book that had doubled every "% of equity" figure came out
   * roughly twice what it should be, and the error grew with the account.
   *
   * Two scoping rules that look inconsistent and are not:
   *
   *   - the ACCOUNT filter applies, because equity belongs to an account;
   *   - every other report filter does NOT. Equity is what the account holds
   *     today, not what the trades currently on screen add up to. Narrowing it
   *     to "trades tagged FVG" would make the same net P&L show a different
   *     percentage depending on an unrelated filter.
   *
   * Built through `buildBalanceTimeline` / `currentEquity` rather than a fourth
   * hand-rolled sum, so it cannot drift from the dashboard's equity curve.
   */
  const equityBase = useMemo(() => {
    // Mixed currencies: no seed and no sum is safe here — see `mixedCurrency`.
    if (mixedCurrency) return null;
    const ids = filters.accountIds;
    const inScope = (accountId: string | null) =>
      !ids?.length || (accountId != null && ids.includes(accountId));

    const start = accounts
      .filter((a) => inScope(a.id))
      .reduce((s, a) => s + (a.starting_balance ?? 0), 0);

    const realized = toRealized(trades.filter((t) => inScope(t.account_id)));
    const base = currentEquity(
      buildBalanceTimeline(
        start,
        realized.map((t) => ({ at: t.closedAt ?? "", pnl: t.net })),
        cashEvents.filter((c) => inScope(c.account_id)),
      ),
    );
    return base > 0 ? base : null;
  }, [accounts, trades, cashEvents, filters.accountIds, mixedCurrency]);

  // Indexed once and shared by the insight context and the dimension context —
  // both join check-ins on the position id, and building the map twice per
  // render would walk the same rows twice for the same answer.
  const checkinsByPosition = useMemo(() => {
    const out = new Map<string, PositionCheckin[]>();
    for (const c of [...positionCheckins].sort((a, b) =>
      a.report_date.localeCompare(b.report_date),
    )) {
      const list = out.get(c.position_id);
      if (list) list.push(c);
      else out.set(c.position_id, [c]);
    }
    return out;
  }, [positionCheckins]);

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
      checkins: positionCheckins,
      rules: playbookLookup.rules,
    });
    const map = new Map<string, string[]>();
    for (const i of runInsights(ctx).insights) {
      if (i.level !== "trade") continue;
      map.set(i.subjectId, [...(map.get(i.subjectId) ?? []), i.ruleId]);
    }
    return map;
  }, [
    trades,
    dailyReports,
    positionCheckins,
    playbookLookup.rules,
    tzOf,
    range,
    pnlOf,
    currency,
    fillCounts,
  ]);

  const dimensionContext = useMemo<DimensionContext>(
    () => ({
      reportByDate: new Map(dailyReports.map((r) => [r.report_date, r])),
      checkinsByPosition,
      weekGradeByWeek: weekGrades,
      // Feeds the DERIVED setup grade. Without it that dimension silently falls
      // back to the hand-typed column, which is the value this change exists to
      // stop trusting.
      rules: playbookLookup.rules,
      insightsByTrade,
      accountNames: new Map(accounts.map((a) => [a.id, a.name])),
      // Tag splits, custom fields and playbook rules all resolve by key
      // through here.
      customDimensions: [
        ...tagDimensions,
        ...customDimensions,
        ...playbookDimensions(playbookLookup),
      ],
    }),
    [
      dailyReports,
      checkinsByPosition,
      weekGrades,
      insightsByTrade,
      accounts,
      tagDimensions,
      customDimensions,
      playbookLookup,
    ],
  );

  const metricContext = useMemo(
    () => ({ pnlBasis, range, rules: playbookLookup.rules }),
    [pnlBasis, range, playbookLookup],
  );

  /**
   * Which of the seven view modes this report can actually render.
   *
   * `units.ts` has computed this since it was written — "so a UI can grey out a
   * mode instead of silently showing something else" — and nothing called it.
   * All seven buttons rendered, and four of them did nothing: a report groups
   * trades across many instruments, so the format context here carries a
   * currency and an equity base and no instrument and no per-trade risk. Pick
   * "Pips" and `formatMetric` falls through to money; the button lights up and
   * the numbers do not move.
   *
   * Probed with a money-unit value because those are the only ones a view mode
   * changes — counts, ratios and durations render the same in every mode.
   */
  const modeRenderable = useMemo(() => {
    const probe = mkMetric(1, "money", { currency, equityBase });
    return new Map(VIEW_MODES.map((m) => [m.value, canRender(probe, m.value)]));
  }, [currency, equityBase]);

  // A mode can also arrive from the URL, where no button guards it. Falling back
  // for display closes the same lie from the other side; the URL is left alone so
  // the choice returns by itself once an equity base exists.
  const effectiveViewMode: ViewMode = modeRenderable.get(viewMode)
    ? viewMode
    : "dollars";

  /**
   * The filter-scoped book, undivided.
   *
   * The same call `runReport` makes before it buckets anything, so the overview
   * and the report below it can never disagree about which trades are in scope.
   * Recomputing it here rather than having the engine hand it back keeps
   * `ReportResult` about the report.
   */
  const scopedBook = useMemo(
    () => applyFilters(enriched, filters, dimensionContext),
    [enriched, filters, dimensionContext],
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
        <span className="text-sm text-muted-foreground">Group by</span>
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
            <SelectItem value="none">No cross-analysis</SelectItem>
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
            {VIEW_MODES.map((m) => {
              const usable = modeRenderable.get(m.value) ?? true;
              return (
                <button
                  key={m.value}
                  disabled={!usable}
                  onClick={() => setParam({ view: m.value })}
                  className={`rounded px-2 py-1 text-xs ${
                    viewMode === m.value && usable
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground"
                  } ${!usable ? "cursor-not-allowed opacity-40" : ""}`}
                  title={
                    !usable
                      ? `${m.label} does not work here — the report groups trades across several instruments, so there is neither a single point value nor a per-trade risk. This used to be shown silently in dollars.`
                      : m.value === "privacy"
                        ? "Hide money amounts"
                        : `Show in ${m.label} — ${m.note}`
                  }
                >
                  {m.label}
                </button>
              );
            })}
          </div>

          <Select value={String(minSample)} onValueChange={(v) => setParam({ min: v })}>
            <SelectTrigger className="h-9 w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[1, 3, 5, 10, 20].map((n) => (
                <SelectItem key={n} value={String(n)}>
                  min n≥{n}
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
                {m === "single" ? "Single" : "Compare"}
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

      {mixedCurrency ? (
        /* Same refusal as `dashboard.tsx`'s own gate, same reason: no safe
           pooled number exists once accounts in the account filter disagree
           on currency, and every panel below (`BookOverviewPanel`,
           `PerformanceSummaryPanel`, `ReportChart`, `ReportTable`,
           `CrossAnalysis`, `CompareView`) reads `currency`/`equityBase`
           somewhere. `FilterBar` stays visible above so narrowing to one
           account is one click away. */
        <Alert variant="destructive">
          <AlertTitle>Accounts in scope use different currencies</AlertTitle>
          <AlertDescription>
            {scopedAccounts
              .map((a) => a.currency)
              .filter((c, i, arr) => arr.indexOf(c) === i)
              .join(", ")}{" "}
            — adding money across them would mean summing unlike units, so the
            report is not shown while the account filter spans more than one
            currency. Narrow the Accounts filter above to a single account.
          </AlertDescription>
        </Alert>
      ) : (
      <>
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
          viewMode={effectiveViewMode}
          currency={currency}
          equityBase={equityBase}
        />
      ) : (
        result && (
          <>
            <BookOverviewPanel
              trades={scopedBook}
              metricContext={metricContext}
              viewMode={effectiveViewMode}
              currency={currency}
              equityBase={equityBase}
            />

            <PerformanceSummaryPanel
              summary={summarizeReport(result, metricKey)}
              metric={selectedMetric}
              viewMode={effectiveViewMode}
              currency={currency}
              equityBase={equityBase}
              minSample={minSample}
            />

            <ReportChart
              result={result}
              metricKeys={chartMetrics}
              chartType={chartType}
              viewMode={effectiveViewMode}
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
                        {t === "bar" ? "Bars" : "Line"}
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
                      <SelectValue placeholder="Metrics" />
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
              viewMode={effectiveViewMode}
              currency={currency}
              equityBase={equityBase}
              sortBy={sortBy}
              onSort={(k) => setParam({ sort: k })}
            />

            {pivot && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-muted-foreground">
                    Metric in cells
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
                  viewMode={effectiveViewMode}
                  currency={currency}
                  equityBase={equityBase}
                />
              </div>
            )}
          </>
        )
      )}
      </>
      )}

      <div className="flex justify-end">
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => router.replace("/reports", { scroll: false })}
        >
          Reset report
        </Button>
      </div>
    </div>
  );
}
