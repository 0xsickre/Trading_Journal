"use client";

import { primaryAccount } from "@/lib/journal/account-rules";
import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { Columns3, Eye, EyeOff, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { toRealized } from "@/lib/journal/analytics";
import { enrichTrades, type DailyReportLite, type FillCounts } from "@/lib/journal/enriched-trade";
import { sharedCurrency } from "@/lib/journal/format";
import { sharedBreakevenRange } from "@/lib/journal/breakeven";
import { buildInsightContext } from "@/lib/journal/insights/context";
import type { PositionCheckin } from "@/lib/journal/position-checkin";
import { runInsights } from "@/lib/journal/insights/registry";
import { unpricedClosedCount } from "@/lib/journal/money-provenance";
import {
  DIMENSION_GROUP_LABELS,
  DIMENSION_GROUP_ORDER,
  allDimensions,
  customFieldDimensions,
  resolveDimension,
  tagSplitDimensions,
  type DimensionContext,
} from "@/lib/journal/reports/dimensions";
import { parseSort, runReport, sortRows, summarizeReport } from "@/lib/journal/reports/engine";
import {
  MIN_SAMPLE_OPTIONS,
  asMinSample,
  asPnlBasis,
  asReportView,
} from "@/lib/journal/reports/url-params";
import { METRICS, getMetric } from "@/lib/journal/reports/metrics";
import {
  applyFilters,
  fromSearchParams,
  type FilterClause,
  type FilterSet,
} from "@/lib/journal/reports/filters";
import {
  REPORT_KINDS,
  accountLabels,
  accountsInScope,
  accountsOfKind,
  asReportKind,
  defaultKind,
  type ReportKind,
} from "@/lib/journal/reports/scope";
import { getStoredReportKind, setStoredReportKind } from "@/lib/journal/report-prefs";
import type { ViewMode } from "@/lib/journal/units";
import { BookOverviewPanel } from "@/components/journal/reports/book-overview";
import { FilterBar } from "@/components/journal/reports/filter-bar";
import { PerformanceSummaryPanel } from "@/components/journal/reports/performance-summary";
import { ReportTable } from "@/components/journal/reports/report-table";
import type { Account, OptionsMap, TradeRow } from "@/lib/journal/types";
import type { FieldDef } from "@/lib/journal/field-def-types";
import {
  buildPlaybookLookup,
  playbookDimensions,
  type PlaybookLookup,
} from "@/lib/journal/reports/playbook-dimensions";
import type { Playbook, PositionRule } from "@/lib/journal/playbook-types";
import { buildBalanceTimeline, currentEquity, type CashEvent } from "@/lib/journal/balance";
import { accountTimezoneResolver } from "@/lib/journal/time";

/**
 * Lazy for the same reason the dashboard's plots are: recharts is large, and
 * the page must paint its figures before the chart library arrives.
 */
const ReportChart = dynamic(
  () => import("@/components/journal/reports/report-chart").then((m) => m.ReportChart),
  {
    ssr: false,
    loading: () => <div className="h-[22rem] w-full animate-pulse rounded-xl bg-muted/40" />,
  },
);

const DEFAULT_DIMENSION = "setup_grade";
const DEFAULT_COLUMNS = ["net_pnl", "win_rate", "profit_factor", "expectancy", "max_drawdown"];
/** Every metric but the trade count, which the table always shows on its own. */
const COLUMN_CHOICES = METRICS.filter((m) => m.key !== "trade_count");
const COLUMN_KEYS = new Set(COLUMN_CHOICES.map((m) => m.key));
/** Matches no account: a kind with no accounts reports on nothing, not on all. */
const NO_ACCOUNT = "__none__";

/**
 * The Reports tab: one question at a time — "how did each group do?".
 *
 * Top to bottom: the scope (which book, which dates, which basis and unit),
 * the report (group by, columns, sample threshold, filters), then the book as a
 * whole, the best and worst groups, a chart of one metric, and the table.
 *
 * The state lives in the URL so a report can be bookmarked, and is written with
 * `history.replaceState` — the page never reads the query string on the server,
 * so a change of filter must not re-render it there.
 */
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
  const params = useSearchParams();

  // --- URL state, read and validated ----------------------------------------

  const replaceUrl = useCallback((query: URLSearchParams) => {
    const q = query.toString();
    window.history.replaceState(null, "", q ? `/reports?${q}` : "/reports");
  }, []);

  const setParam = useCallback(
    (patch: Record<string, string | undefined>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v == null || v === "") next.delete(k);
        else next.set(k, v);
      }
      replaceUrl(next);
    },
    [params, replaceUrl],
  );

  // The kind: a link that names one wins, then the one last shown, then the
  // data's own answer (Live when live trades exist).
  const [storedKind, setStoredKind] = useState<ReportKind | null>(null);
  useEffect(() => {
    const k = getStoredReportKind();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- external-store init
    if (k) setStoredKind(k);
  }, []);
  const dataKind = useMemo(
    () =>
      defaultKind(
        accounts,
        trades.filter((t) => t.status === "closed").map((t) => t.account_id),
      ),
    [accounts, trades],
  );
  const kind: ReportKind = asReportKind(params.get("kind")) ?? storedKind ?? dataKind;

  const chooseKind = (next: ReportKind) => {
    setStoredReportKind(next);
    setStoredKind(next);
    setParam({ kind: next, acc: undefined });
  };

  const accountId = params.get("acc");
  const kindAccounts = useMemo(() => accountsOfKind(accounts, kind), [accounts, kind]);
  const scopeAccounts = useMemo(
    () => accountsInScope(accounts, kind, accountId),
    [accounts, kind, accountId],
  );
  const selectedAccount =
    accountId && scopeAccounts.length === 1 && scopeAccounts[0].id === accountId ? accountId : "all";

  const pnlBasis = asPnlBasis(params.get("basis"));
  const minSample = asMinSample(params.get("min"));
  const hideAmounts = params.get("hide") === "1";
  const sortBy = params.get("sort") ?? undefined;

  const urlFilters = useMemo<FilterSet>(() => fromSearchParams(params), [params]);
  const clauses = urlFilters.clauses;

  const columnKeys = useMemo(() => {
    const picked = (params.get("cols") ?? "").split(",").filter((k) => COLUMN_KEYS.has(k));
    return picked.length > 0 ? picked : DEFAULT_COLUMNS;
  }, [params]);

  // --- The book in scope ------------------------------------------------------

  const tzOf = useMemo(() => {
    const primary = primaryAccount(accounts);
    const resolve = accountTimezoneResolver(accounts, primary?.timezone);
    return (t: { row: TradeRow }) => resolve(t.row.account_id);
  }, [accounts]);

  // Pooled over the accounts IN SCOPE, never over all of them: a EUR live
  // account used to block a USD backtest report, and a live account's balance
  // used to sit in a backtest's percentage base.
  const range = useMemo(() => sharedBreakevenRange(scopeAccounts), [scopeAccounts]);
  const mixedCurrency = scopeAccounts.length > 1 && sharedCurrency(scopeAccounts) == null;
  const currency = sharedCurrency(scopeAccounts) ?? scopeAccounts[0]?.currency ?? "USD";

  const pnlOf = useCallback(
    (t: { net: number; gross: number }) => (pnlBasis === "net" ? t.net : t.gross),
    [pnlBasis],
  );

  const enriched = useMemo(
    () => enrichTrades(toRealized(trades), { tzOf, range, pnlOf, fillCounts }),
    [trades, tzOf, range, pnlOf, fillCounts],
  );

  const scopeIds = useMemo(() => new Set(scopeAccounts.map((a) => a.id)), [scopeAccounts]);

  /**
   * Denominator for % mode: what the accounts in scope hold today — starting
   * balance, realized P&L and cash flow, through the same balance timeline the
   * dashboard draws. Not narrowed by the report's filters: equity is what the
   * account holds, not what the trades on screen add up to.
   */
  const equityBase = useMemo(() => {
    if (mixedCurrency) return null;
    const start = scopeAccounts.reduce((s, a) => s + (a.starting_balance ?? 0), 0);
    const realized = toRealized(trades.filter((t) => t.account_id != null && scopeIds.has(t.account_id)));
    const base = currentEquity(
      buildBalanceTimeline(
        start,
        realized.map((t, i) => ({ at: t.closedAt || `#${i}`, pnl: t.net })),
        cashEvents.filter((c) => scopeIds.has(c.account_id)),
      ),
    );
    return base > 0 ? base : null;
  }, [scopeAccounts, scopeIds, trades, cashEvents, mixedCurrency]);

  const view = asReportView(params.get("view"));
  const viewMode: ViewMode = hideAmounts
    ? "privacy"
    : view === "percentage" && equityBase != null
      ? "percentage"
      : "dollars";

  // Closed trades that could not be priced drop out of every figure; they used
  // to drop out without a word.
  const unpriced = useMemo(
    () => unpricedClosedCount(trades.filter((t) => t.account_id != null && scopeIds.has(t.account_id))),
    [trades, scopeIds],
  );

  // --- Dimensions and context -------------------------------------------------

  const customDimensions = useMemo(() => customFieldDimensions(fieldDefs), [fieldDefs]);
  const tagDimensions = useMemo(() => tagSplitDimensions(optionsMap), [optionsMap]);
  const playbookLookup = useMemo<PlaybookLookup>(
    () => buildPlaybookLookup(playbooks, positionRules),
    [playbooks, positionRules],
  );
  const extraDimensions = useMemo(
    () => [...tagDimensions, ...customDimensions, ...playbookDimensions(playbookLookup)],
    [tagDimensions, customDimensions, playbookLookup],
  );
  const dimensions = useMemo(() => allDimensions(extraDimensions), [extraDimensions]);

  const checkinsByPosition = useMemo(() => {
    const out = new Map<string, PositionCheckin[]>();
    for (const c of [...positionCheckins].sort((a, b) => a.report_date.localeCompare(b.report_date))) {
      const list = out.get(c.position_id);
      if (list) list.push(c);
      else out.set(c.position_id, [c]);
    }
    return out;
  }, [positionCheckins]);

  // Insights are a dimension and a filter, so they are evaluated once and
  // indexed by trade.
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
  }, [trades, dailyReports, positionCheckins, playbookLookup.rules, tzOf, range, pnlOf, currency, fillCounts]);

  const dimensionContext = useMemo<DimensionContext>(
    () => ({
      reportByDate: new Map(dailyReports.map((r) => [r.report_date, r])),
      checkinsByPosition,
      weekGradeByWeek: weekGrades,
      rules: playbookLookup.rules,
      insightsByTrade,
      // Labels that tell same-named accounts apart, so they do not share a row.
      accountNames: accountLabels(accounts),
      customDimensions: extraDimensions,
    }),
    [dailyReports, checkinsByPosition, weekGrades, playbookLookup, insightsByTrade, accounts, extraDimensions],
  );

  const metricContext = useMemo(
    () => ({ pnlBasis, range, rules: playbookLookup.rules }),
    [pnlBasis, range, playbookLookup],
  );

  const dimension =
    resolveDimension(params.get("dim") ?? DEFAULT_DIMENSION, dimensionContext) ??
    resolveDimension(DEFAULT_DIMENSION, dimensionContext)!;

  // --- The report ---------------------------------------------------------------

  const filters = useMemo<FilterSet>(
    () => ({
      clauses,
      dateFrom: urlFilters.dateFrom,
      dateTo: urlFilters.dateTo,
      accountIds: scopeIds.size > 0 ? [...scopeIds] : [NO_ACCOUNT],
    }),
    [clauses, urlFilters.dateFrom, urlFilters.dateTo, scopeIds],
  );
  const filtering = clauses.length > 0 || !!urlFilters.dateFrom || !!urlFilters.dateTo;

  // The book the filter values are offered from: in scope, before any filter.
  const scopeOnlyBook = useMemo(
    () => applyFilters(enriched, { clauses: [], accountIds: filters.accountIds }, dimensionContext),
    [enriched, filters.accountIds, dimensionContext],
  );

  const scopedBook = useMemo(
    () => applyFilters(enriched, filters, dimensionContext),
    [enriched, filters, dimensionContext],
  );

  /**
   * The report itself — WITHOUT the sort.
   *
   * `sortBy` used to sit in these dependencies, so every click on a column
   * header recomputed every metric over every row. That was already wasteful
   * and became unaffordable once three of those metrics resample their group
   * two thousand times: ordering rows is not a reason to recompute them.
   */
  const computed = useMemo(
    () =>
      runReport({
        trades: enriched,
        dimension,
        metricKeys: columnKeys,
        filters,
        dimensionContext,
        metricContext,
        minSample,
      }),
    [enriched, dimension, columnKeys, filters, dimensionContext, metricContext, minSample],
  );

  // Ordering only. The rows are copied rather than sorted in place, so the
  // memo above keeps an array React can compare against next time.
  const result = useMemo(() => {
    if (!computed) return null;
    const rows = [...computed.rows];
    sortRows(rows, computed.dimension, sortBy, computed.metrics);
    return { ...computed, rows };
  }, [computed, sortBy]);

  // The whole table as one group — only when every trade sits in one row, so
  // the Total is the book the rows add up to.
  const totals = useMemo(() => {
    if (!result || result.multiValue) return null;
    const all = result.rows.flatMap((r) => r.trades);
    return Object.fromEntries(result.metrics.map((m) => [m.key, m.compute(all, metricContext)]));
  }, [result, metricContext]);

  const sort = parseSort(sortBy);
  const rankKey = sort && columnKeys.includes(sort.key) ? sort.key : columnKeys[0];
  const rankMetric = getMetric(rankKey) ?? METRICS[0];

  const [chartKey, setChartKey] = useState<string | null>(null);
  const chartMetric = getMetric(chartKey && columnKeys.includes(chartKey) ? chartKey : rankKey) ?? rankMetric;

  const [resetKey, setResetKey] = useState(0);
  function resetReport() {
    setChartKey(null);
    setResetKey((k) => k + 1);
    // The book stays the same; the report questions go back to their defaults.
    replaceUrl(new URLSearchParams(params.get("kind") ? { kind: params.get("kind")! } : {}));
  }

  function setClauses(next: FilterClause[]) {
    const q = new URLSearchParams(params.toString());
    q.delete("f");
    for (const c of next) {
      if (c.op === "between") q.append("f", `${c.field}:between:${c.min ?? ""}~${c.max ?? ""}`);
      else if (c.op === "in" || c.op === "notIn") q.append("f", `${c.field}:${c.op}:${c.values.join("~")}`);
      else q.append("f", `${c.field}:${c.op}:`);
    }
    replaceUrl(q);
  }

  function toggleColumn(key: string, on: boolean) {
    const set = new Set(columnKeys);
    if (on) set.add(key);
    else set.delete(key);
    const ordered = COLUMN_CHOICES.map((m) => m.key).filter((k) => set.has(k));
    if (ordered.length === 0) return;
    setParam({ cols: ordered.join(",") });
  }

  const kindName = kind === "all" ? "" : `${kind} `;

  // --- Render ---------------------------------------------------------------------

  return (
    <div className="space-y-4">
      {/* The book: which accounts, which dates, and how money is shown. */}
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          label="Account type"
          value={kind}
          options={REPORT_KINDS}
          onChange={(v) => chooseKind(v as ReportKind)}
        />
        <Select
          value={selectedAccount}
          onValueChange={(v) => setParam({ acc: v === "all" ? undefined : v })}
        >
          <SelectTrigger className="h-9 w-52" aria-label="Account">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All {kindName}accounts</SelectItem>
            {kindAccounts.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {dimensionContext.accountNames?.get(a.id) ?? a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1.5">
          <Input
            type="date"
            value={urlFilters.dateFrom ?? ""}
            onChange={(e) => setParam({ from: e.target.value })}
            className="h-9 w-[9.5rem]"
            aria-label="From"
          />
          <span className="text-xs text-muted-foreground">→</span>
          <Input
            type="date"
            value={urlFilters.dateTo ?? ""}
            onChange={(e) => setParam({ to: e.target.value })}
            className="h-9 w-[9.5rem]"
            aria-label="To"
          />
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Segmented
            label="P&L basis"
            value={pnlBasis}
            options={[
              { value: "net", label: "Net" },
              { value: "gross", label: "Gross" },
            ]}
            onChange={(v) => setParam({ basis: v === "net" ? undefined : v })}
          />
          <Segmented
            label="Unit"
            value={view === "percentage" && equityBase != null ? "percentage" : "dollars"}
            options={[
              { value: "dollars", label: currency === "USD" ? "$" : currency },
              {
                value: "percentage",
                label: "%",
                disabled: equityBase == null,
                title: equityBase == null ? "Needs a starting balance on the account" : "% of equity",
              },
            ]}
            onChange={(v) => setParam({ view: v === "dollars" ? undefined : v })}
          />
          <Button
            variant={hideAmounts ? "secondary" : "outline"}
            size="icon"
            className="size-9"
            aria-pressed={hideAmounts}
            aria-label={hideAmounts ? "Show amounts" : "Hide amounts"}
            title={hideAmounts ? "Show amounts" : "Hide amounts"}
            onClick={() => setParam({ hide: hideAmounts ? undefined : "1" })}
          >
            {hideAmounts ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </Button>
        </div>
      </div>

      {/* The question: how to split it, what to show, what to leave out. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">Group by</span>
        <Select
          value={dimension.key}
          // A new grouping starts in its own order; a sort chosen for the last
          // one would overrule a grade scale or a weekday sequence.
          onValueChange={(v) => setParam({ dim: v, sort: undefined })}
        >
          <SelectTrigger className="h-9 w-52" aria-label="Group by">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DIMENSION_GROUP_ORDER.map((g) => {
              const inGroup = dimensions.filter((d) => d.group === g);
              if (inGroup.length === 0) return null;
              return (
                <SelectGroup key={g}>
                  <SelectLabel>{DIMENSION_GROUP_LABELS[g]}</SelectLabel>
                  {inGroup.map((d) => (
                    <SelectItem key={d.key} value={d.key}>
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              );
            })}
          </SelectContent>
        </Select>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-9">
              <Columns3 className="size-3.5" />
              Columns
              <span className="text-xs text-muted-foreground">{columnKeys.length}</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="max-h-80 w-64 overflow-y-auto p-2">
            {COLUMN_CHOICES.map((m) => {
              const on = columnKeys.includes(m.key);
              return (
                <label
                  key={m.key}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"
                  title={m.hint}
                >
                  <Checkbox
                    checked={on}
                    disabled={on && columnKeys.length === 1}
                    onCheckedChange={(c) => toggleColumn(m.key, c === true)}
                  />
                  {m.label}
                </label>
              );
            })}
          </PopoverContent>
        </Popover>

        {/* Ranking only. Rows below it are still shown, with their intervals —
            what this number buys is that a three-trade bucket cannot be named
            the best category. */}
        <Select value={String(minSample)} onValueChange={(v) => setParam({ min: v })}>
          <SelectTrigger className="h-9 w-44" aria-label="Minimum trades to rank">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MIN_SAMPLE_OPTIONS.map((n) => (
              <SelectItem key={n} value={String(n)}>
                Rank from {n} {n === 1 ? "trade" : "trades"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-9 text-muted-foreground"
          onClick={resetReport}
        >
          <RotateCcw className="size-3.5" />
          Reset
        </Button>
      </div>

      <FilterBar
        key={resetKey}
        clauses={clauses}
        onChange={setClauses}
        trades={scopeOnlyBook}
        dimensionContext={dimensionContext}
        dimensions={dimensions}
      />

      {unpriced > 0 && (
        <p className="text-xs text-muted-foreground">
          {unpriced} closed {unpriced === 1 ? "trade has" : "trades have"} no price and{" "}
          {unpriced === 1 ? "is" : "are"} not counted.
        </p>
      )}

      {mixedCurrency ? (
        <Alert variant="destructive">
          <AlertTitle>These accounts use different currencies</AlertTitle>
          <AlertDescription>
            Their money cannot be added together. Pick one account above.
          </AlertDescription>
        </Alert>
      ) : scopedBook.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <p className="text-sm text-muted-foreground">
              {filtering
                ? "No trades match these filters."
                : `No closed ${kindName}trades yet.`}
            </p>
            {filtering && (
              <Button variant="outline" size="sm" onClick={() => setParam({ from: undefined, to: undefined, f: undefined })}>
                Clear filters
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        result && (
          <>
            <BookOverviewPanel
              trades={scopedBook}
              metricContext={metricContext}
              viewMode={viewMode}
              currency={currency}
              equityBase={equityBase}
            />
            <PerformanceSummaryPanel
              summary={summarizeReport(result, rankKey)}
              dimension={result.dimension}
              metric={rankMetric}
              viewMode={viewMode}
              currency={currency}
              equityBase={equityBase}
              minSample={minSample}
            />
            <ReportChart
              result={result}
              metric={chartMetric}
              viewMode={viewMode}
              currency={currency}
              equityBase={equityBase}
              action={
                <Select value={chartMetric.key} onValueChange={setChartKey}>
                  <SelectTrigger className="h-8 w-44" aria-label="Chart metric">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {columnKeys.map((k) => (
                      <SelectItem key={k} value={k}>
                        {getMetric(k)?.label ?? k}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              }
            />
            <ReportTable
              result={result}
              totals={totals}
              viewMode={viewMode}
              currency={currency}
              equityBase={equityBase}
              sortBy={sortBy}
              onSort={(s) => setParam({ sort: s })}
            />
          </>
        )
      )}
    </div>
  );
}

/** A small segmented control: one of a few values, the chosen one filled. */
function Segmented({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: string; disabled?: boolean; title?: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex h-9 items-center rounded-md border p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          disabled={o.disabled}
          title={o.title}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`h-full rounded px-2.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
            value === o.value
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
