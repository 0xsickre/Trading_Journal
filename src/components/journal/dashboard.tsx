"use client";

import { useCallback, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
  Cell,
} from "recharts";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CalendarHeatmap } from "@/components/journal/calendar-heatmap";
import {
  buildBalanceTimeline,
  computeDrawdown,
  drawdownSeries,
  type CashEvent,
} from "@/lib/journal/balance";
import { computeHoldTime } from "@/lib/journal/hold-time";
import { computeCostStats } from "@/lib/journal/costs";
import { computeExcursionStats } from "@/lib/journal/excursion";
import { computeDirectionSplit, countLoggedDays, countTradingDays } from "@/lib/journal/activity";
import { bucketByPeriod, summarizePeriods } from "@/lib/journal/period-stats";
import {
  avgWinLossRatio,
  computePlannedRStats,
  consistencyScore,
  recoveryFactor,
} from "@/lib/journal/risk-metrics";
import { computeSickreScore } from "@/lib/journal/sickre-score";
import { DrawdownChart } from "@/components/journal/drawdown-chart";
import { SickreScoreCard } from "@/components/journal/sickre-score-card";
import {
  CostReportCard,
  HoldTimeCard,
  PeriodPerformanceCard,
  PlanVsRealityCard,
} from "@/components/journal/metrics-panel";
import {
  EXACT_ZERO_RANGE,
  hasBreakevenBand,
  resolveBreakevenRange,
} from "@/lib/journal/breakeven";
import type { Account, TradeRow } from "@/lib/journal/types";
import {
  toRealized,
  computeStats,
  buildEquity,
  rHistogram,
  dailyPnl,
  breakdownByField,
  computeSlippageStats,
  weeklySlippageR,
  computeExitEfficiencyStats,
  weeklyExitEfficiency,
  type PnlMode,
} from "@/lib/journal/analytics";
import { fmtExitEfficiencyPct } from "@/lib/journal/exit-efficiency";
import { evaluateFtmo, ftmoConfigFromAccount } from "@/lib/journal/ftmo";
import { FtmoBanner } from "@/components/journal/ftmo-banner";
import {
  buildMentorPack,
  resolveCalendarRange,
  type Granularity,
} from "@/lib/journal/mentor-export";
import { Input } from "@/components/ui/input";
import {
  format,
  getISOWeek,
  getISOWeekYear,
  setISOWeek,
  startOfISOWeek,
} from "date-fns";
import { fmtMoney, fmtR, fmtPct, fmtNum, pnlClass } from "@/lib/journal/format";
import { formatDuration } from "@/lib/journal/units";

const PERIODS = [
  { value: "30", label: "30d" },
  { value: "90", label: "90d" },
  { value: "365", label: "1y" },
  { value: "all", label: "All" },
];

// Calendar granularities for the "Export for Claude" mentor pack.
const GRANULARITIES: { value: Granularity; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "quarter", label: "Quarter" },
  { value: "year", label: "Year" },
  { value: "custom", label: "Custom" },
  { value: "all", label: "All" },
];

const todayYMD = () => new Date().toISOString().slice(0, 10);
const pad2 = (n: number) => String(n).padStart(2, "0");

/** anchor "YYYY-MM-DD" → `<input type="week">` value "YYYY-Www" (ISO week). */
function anchorToWeekInput(anchor: string): string {
  const d = new Date(`${anchor}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  return `${getISOWeekYear(d)}-W${pad2(getISOWeek(d))}`;
}

/** `<input type="week">` value "YYYY-Www" → anchor of that week's Monday. */
function weekInputToAnchor(value: string): string {
  const m = value.match(/^(\d{4})-W(\d{2})$/);
  if (!m) return value;
  // Jan 4 is always in ISO week 1; move to the target week, then to its Monday.
  const jan4 = new Date(Number(m[1]), 0, 4);
  const monday = startOfISOWeek(setISOWeek(jan4, Number(m[2])));
  return format(monday, "yyyy-MM-dd");
}

const BREAKDOWN_FIELDS = [
  { value: "macro_align", label: "Macro Align" },
  { value: "cot_filter", label: "COT Filter" },
  { value: "setup_grade", label: "Setup Grade" },
  { value: "technical_tags", label: "Technical Tags" },
  { value: "ict_entry_model", label: "Entry Model" },
  { value: "direction", label: "Direction" },
  { value: "instrument", label: "Instrument" },
  { value: "psychology_tags", label: "Psychology Tags" },
  { value: "mistake", label: "Mistake" },
];

export function Dashboard({
  trades,
  accounts,
  cashEvents = [],
  loggedDates = [],
}: {
  trades: TradeRow[];
  accounts: Account[];
  cashEvents?: CashEvent[];
  loggedDates?: string[];
}) {
  const [accountFilter, setAccountFilter] = useState("all");
  const [period, setPeriod] = useState("90");
  const [mode, setMode] = useState<PnlMode>("net");
  const [equityMetric, setEquityMetric] = useState<"money" | "r">("money");
  const [breakdownField, setBreakdownField] = useState("setup_grade");
  const [granularity, setGranularity] = useState<Granularity>("week");
  const [anchor, setAnchor] = useState(todayYMD);
  const [customFrom, setCustomFrom] = useState(todayYMD);
  const [customTo, setCustomTo] = useState(todayYMD);

  // Years present in the data (newest first) for the Year/Quarter pickers.
  const yearOptions = useMemo(() => {
    const cur = new Date().getUTCFullYear();
    let min = cur;
    for (const t of trades) {
      const ref = t.stats?.closed_at ?? t.created_at;
      const y = ref ? Number(String(ref).slice(0, 4)) : NaN;
      if (Number.isFinite(y) && y < min) min = y;
    }
    return Array.from({ length: cur - min + 1 }, (_, i) => cur - i);
  }, [trades]);

  const anchorYear = Number(anchor.slice(0, 4));
  const anchorQuarter = Math.floor((Number(anchor.slice(5, 7)) - 1) / 3) + 1;

  // FTMO challenge status per account with the mode enabled.
  const ftmoStatuses = useMemo(
    () =>
      accounts
        .filter((a) => a.ftmo_mode)
        .map((account) => {
          const rows = toRealized(
            trades.filter((t) => t.account_id === account.id),
          ).map((r) => ({ closedAt: r.closedAt, net: r.net }));
          return {
            account,
            result: evaluateFtmo(ftmoConfigFromAccount(account), rows),
          };
        }),
    [accounts, trades],
  );

  // Resolved export period, for a live preview of exactly what will be exported.
  const exportRange = useMemo(
    () => resolveCalendarRange(granularity, anchor, customFrom, customTo),
    [granularity, anchor, customFrom, customTo],
  );

  const tzOf = useCallback(
    (t: { row: TradeRow }) => {
      const a = accounts.find((x) => x.id === t.row.account_id);
      return a?.timezone ?? "America/New_York";
    },
    [accounts],
  );

  const currency = useMemo(() => {
    if (accountFilter !== "all")
      return accounts.find((a) => a.id === accountFilter)?.currency ?? "USD";
    const set = new Set(accounts.map((a) => a.currency));
    return set.size === 1 ? [...set][0] : "USD";
  }, [accountFilter, accounts]);

  const startBalance = useMemo(() => {
    if (accountFilter !== "all")
      return accounts.find((a) => a.id === accountFilter)?.starting_balance ?? 0;
    return accounts.reduce((s, a) => s + (a.starting_balance ?? 0), 0);
  }, [accountFilter, accounts]);

  const realized = useMemo(() => {
    let rows = trades;
    if (accountFilter !== "all")
      rows = rows.filter((t) => t.account_id === accountFilter);
    let r = toRealized(rows);
    if (period !== "all") {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - Number(period));
      const iso = cutoff.toISOString();
      r = r.filter((t) => (t.closedAt ?? "") >= iso);
    }
    return r;
  }, [trades, accountFilter, period]);

  /**
   * Breakeven band for the current scope. With "all accounts" selected the band
   * is only meaningful when every account agrees — mixing bands would classify
   * the same P&L differently depending on which account produced it, so we fall
   * back to exact zero rather than pick a winner.
   */
  const breakevenRange = useMemo(() => {
    const scoped =
      accountFilter === "all"
        ? accounts
        : accounts.filter((a) => a.id === accountFilter);
    if (scoped.length === 0) return EXACT_ZERO_RANGE;
    const ranges = scoped.map((a) => resolveBreakevenRange(a));
    const first = ranges[0];
    const uniform = ranges.every(
      (r) => r.from === first.from && r.to === first.to,
    );
    return uniform ? first : EXACT_ZERO_RANGE;
  }, [accountFilter, accounts]);

  const scopedCashEvents = useMemo(
    () =>
      accountFilter === "all"
        ? cashEvents
        : cashEvents.filter((c) => c.account_id === accountFilter),
    [cashEvents, accountFilter],
  );

  /**
   * Drawdown is measured on two different bases on purpose: money comes from
   * cumulative P&L (a withdrawal is not a loss), percentage comes from equity
   * including cash flow (a deposit really does change what a dollar loss means).
   */
  const drawdown = useMemo(
    () =>
      computeDrawdown(
        buildBalanceTimeline(
          startBalance,
          realized.map((t) => ({
            at: t.closedAt ?? "",
            pnl: mode === "net" ? t.net : t.gross,
          })),
          scopedCashEvents,
        ),
      ),
    [realized, mode, startBalance, scopedCashEvents],
  );

  const stats = useMemo(
    () => computeStats(realized, mode, breakevenRange),
    [realized, mode, breakevenRange],
  );

  const balanceTimeline = useMemo(
    () =>
      buildBalanceTimeline(
        startBalance,
        realized.map((t) => ({
          at: t.closedAt ?? "",
          pnl: mode === "net" ? t.net : t.gross,
        })),
        scopedCashEvents,
      ),
    [realized, mode, startBalance, scopedCashEvents],
  );
  const ddSeries = useMemo(
    () => drawdownSeries(balanceTimeline),
    [balanceTimeline],
  );

  const pnlOf = useCallback(
    (t: { net: number; gross: number }) => (mode === "net" ? t.net : t.gross),
    [mode],
  );

  const holdTime = useMemo(
    () => computeHoldTime(realized, breakevenRange, pnlOf),
    [realized, breakevenRange, pnlOf],
  );
  const costs = useMemo(() => computeCostStats(realized), [realized]);
  const plannedR = useMemo(() => computePlannedRStats(realized), [realized]);
  const excursion = useMemo(() => computeExcursionStats(realized), [realized]);
  const directionSplit = useMemo(
    () => computeDirectionSplit(realized, breakevenRange, pnlOf),
    [realized, breakevenRange, pnlOf],
  );

  const weekly = useMemo(
    () =>
      summarizePeriods(
        bucketByPeriod(realized, "week", tzOf, breakevenRange, pnlOf),
      ),
    [realized, tzOf, breakevenRange, pnlOf],
  );
  const monthly = useMemo(
    () =>
      summarizePeriods(
        bucketByPeriod(realized, "month", tzOf, breakevenRange, pnlOf),
      ),
    [realized, tzOf, breakevenRange, pnlOf],
  );

  const tradingDays = useMemo(
    () => countTradingDays(realized, tzOf),
    [realized, tzOf],
  );
  const loggedDays = useMemo(
    () => countLoggedDays(loggedDates),
    [loggedDates],
  );

  const winLossRatio = useMemo(
    () => avgWinLossRatio(stats.avgWin, stats.avgLoss),
    [stats.avgWin, stats.avgLoss],
  );
  const recovery = useMemo(
    () => recoveryFactor(stats.netSum, drawdown.maxMoney),
    [stats.netSum, drawdown.maxMoney],
  );
  const consistency = useMemo(
    () => consistencyScore(realized.map(pnlOf)),
    [realized, pnlOf],
  );

  const sickreScore = useMemo(
    () =>
      computeSickreScore({
        profitFactor: stats.profitFactor,
        avgWinLossRatio: winLossRatio,
        // Peak-P&L base, not the equity percentage shown in the KPI row — the
        // two have different denominators and only this one matches how
        // TradeZella computes it, which is what keeps the score comparable.
        maxDrawdownPctOfPeakPnl: drawdown.maxPctOfPeakPnl,
        winPct: stats.winRate,
        recoveryFactor: recovery,
        consistencyScore: consistency.score,
      }),
    [stats.profitFactor, stats.winRate, winLossRatio, drawdown.maxPctOfPeakPnl, recovery, consistency.score],
  );
  const equity = useMemo(
    () => buildEquity(realized, mode, equityMetric, startBalance),
    [realized, mode, equityMetric, startBalance],
  );
  const hist = useMemo(() => rHistogram(realized), [realized]);
  const daily = useMemo(
    () => dailyPnl(realized, mode, tzOf),
    [realized, mode, tzOf],
  );
  const breakdown = useMemo(
    () => breakdownByField(realized, breakdownField, breakevenRange),
    [realized, breakdownField, breakevenRange],
  );
  const slippageStats = useMemo(
    () => computeSlippageStats(realized),
    [realized],
  );
  const weeklySlip = useMemo(
    () => weeklySlippageR(realized, tzOf),
    [realized, tzOf],
  );
  const exitEffStats = useMemo(
    () => computeExitEfficiencyStats(realized),
    [realized],
  );
  const weeklyExitEff = useMemo(
    () => weeklyExitEfficiency(realized, tzOf),
    [realized, tzOf],
  );

  function handleExportMentorPack() {
    let scoped =
      accountFilter === "all"
        ? trades
        : trades.filter((t) => t.account_id === accountFilter);
    const scopedAccount =
      accountFilter === "all"
        ? null
        : accounts.find((a) => a.id === accountFilter) ?? null;
    const scopeLabel =
      accountFilter === "all" ? "All accounts" : scopedAccount?.name ?? "Account";

    const { fromISO, toISO, label, rangeText } = resolveCalendarRange(
      granularity,
      anchor,
      customFrom,
      customTo,
    );
    // Reference date: when it closed, or when it was created if still open.
    scoped = scoped.filter((t) => {
      const ref = t.stats?.closed_at ?? t.created_at ?? "";
      if (fromISO && ref < fromISO) return false;
      if (toISO && ref > toISO) return false;
      return true;
    });

    const md = buildMentorPack(scoped, {
      currency,
      scopeLabel,
      periodLabel: label,
      rangeText,
      startingBalance: scopedAccount?.starting_balance ?? null,
    });
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const stamp = granularity === "all" ? todayYMD() : (fromISO ?? "").slice(0, 10);
    a.download = `mentor-pack-${label.toLowerCase()}-${stamp}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5">
      {ftmoStatuses.length > 0 && (
        <div className="space-y-2">
          {ftmoStatuses.map(({ account, result }) => (
            <FtmoBanner key={account.id} account={account} result={result} />
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        {accounts.length > 1 && (
          <Select value={accountFilter} onValueChange={setAccountFilter}>
            <SelectTrigger className="h-9 w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All accounts</SelectItem>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <div className="flex rounded-md border p-0.5">
          {PERIODS.map((p) => (
            <Button
              key={p.value}
              variant={period === p.value ? "secondary" : "ghost"}
              size="sm"
              className="h-7"
              onClick={() => setPeriod(p.value)}
            >
              {p.label}
            </Button>
          ))}
        </div>
        <div className="flex rounded-md border p-0.5">
          {(["net", "gross"] as PnlMode[]).map((m) => (
            <Button
              key={m}
              variant={mode === m ? "secondary" : "ghost"}
              size="sm"
              className="h-7 capitalize"
              onClick={() => setMode(m)}
            >
              {m}
            </Button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">
          {mode === "net" ? "Net = after fees & swap" : "Gross = price move only"}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Select
            value={granularity}
            onValueChange={(v) => setGranularity(v as Granularity)}
          >
            <SelectTrigger className="h-8 w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {GRANULARITIES.map((g) => (
                <SelectItem key={g.value} value={g.value}>
                  {g.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {granularity === "custom" ? (
            <>
              <Input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="h-8 w-36"
                aria-label="From date"
              />
              <span className="text-xs text-muted-foreground">→</span>
              <Input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="h-8 w-36"
                aria-label="To date"
              />
            </>
          ) : granularity === "day" ? (
            <Input
              type="date"
              value={anchor}
              onChange={(e) => e.target.value && setAnchor(e.target.value)}
              className="h-8 w-36"
              aria-label="Day"
            />
          ) : granularity === "week" ? (
            <Input
              type="week"
              value={anchorToWeekInput(anchor)}
              onChange={(e) =>
                e.target.value && setAnchor(weekInputToAnchor(e.target.value))
              }
              className="h-8 w-40"
              aria-label="Week (Mon–Sun)"
            />
          ) : granularity === "month" ? (
            <Input
              type="month"
              value={anchor.slice(0, 7)}
              onChange={(e) =>
                e.target.value && setAnchor(`${e.target.value}-01`)
              }
              className="h-8 w-36"
              aria-label="Month"
            />
          ) : granularity === "quarter" ? (
            <>
              <Select
                value={String(anchorQuarter)}
                onValueChange={(v) =>
                  setAnchor(`${anchorYear}-${pad2((Number(v) - 1) * 3 + 1)}-01`)
                }
              >
                <SelectTrigger className="h-8 w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4].map((q) => (
                    <SelectItem key={q} value={String(q)}>{`Q${q}`}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={String(anchorYear)}
                onValueChange={(v) =>
                  setAnchor(`${v}-${pad2((anchorQuarter - 1) * 3 + 1)}-01`)
                }
              >
                <SelectTrigger className="h-8 w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {yearOptions.map((y) => (
                    <SelectItem key={y} value={String(y)}>
                      {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          ) : granularity === "year" ? (
            <Select
              value={String(anchorYear)}
              onValueChange={(v) => setAnchor(`${v}-01-01`)}
            >
              <SelectTrigger className="h-8 w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {yearOptions.map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={handleExportMentorPack}
            title="Download a Markdown pack for the selected period to upload into Claude for mentor feedback"
          >
            Export for Claude
          </Button>
        </div>
      </div>
      {granularity !== "all" && (
        <p className="-mt-2 text-right text-xs text-muted-foreground">
          Izvoz: {exportRange.rangeText}
        </p>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Trades" value={String(stats.count)} />
        <Stat label="Win rate" value={fmtPct(stats.winRate)} />
        <Stat
          label="Net P/L"
          value={fmtMoney(stats.netSum, currency, { sign: true })}
          cls={pnlClass(stats.netSum)}
        />
        <Stat
          label="Gross P/L"
          value={fmtMoney(stats.grossSum, currency, { sign: true })}
          cls={pnlClass(stats.grossSum)}
        />
        <Stat label="Total R" value={fmtR(stats.totalR)} cls={pnlClass(stats.totalR)} />
        <Stat label="Avg R" value={fmtR(stats.avgR)} cls={pnlClass(stats.avgR)} />
        <Stat
          label="Profit factor"
          value={stats.profitFactor == null ? "∞" : fmtNum(stats.profitFactor, 2)}
        />
        <Stat label="Expectancy" value={fmtR(stats.expectancy)} cls={pnlClass(stats.expectancy)} />
        <Stat label="Best" value={fmtMoney(stats.best, currency, { sign: true })} cls={pnlClass(stats.best)} />
        <Stat label="Worst" value={fmtMoney(stats.worst, currency, { sign: true })} cls={pnlClass(stats.worst)} />
        <Stat
          label="Streak W/L"
          value={`${stats.maxWinStreak} / ${stats.maxLossStreak}`}
        />
        <Stat
          label="Max drawdown"
          value={fmtMoney(stats.maxDrawdown, currency)}
          cls="text-[var(--loss)]"
          title="Worst peak-to-trough drop in cumulative P&L. Deposits and withdrawals are not losses, so they do not move this number."
        />
        <Stat
          label="Max drawdown %"
          value={fmtPct(drawdown.maxPctOfEquity)}
          cls="text-[var(--loss)]"
          title={
            drawdown.maxAt
              ? `Share of peak account equity, including deposits and withdrawals. Trough on ${drawdown.maxAt.slice(0, 10)}.`
              : "Share of peak account equity, including deposits and withdrawals."
          }
        />
        <Stat
          label="Breakeven"
          value={String(stats.breakeven)}
          title={
            hasBreakevenBand(breakevenRange)
              ? `Trades landing in ${fmtMoney(breakevenRange.from, currency)} … ${fmtMoney(breakevenRange.to, currency)}.`
              : "No breakeven band configured — only an exact 0.00 counts, which almost never happens once fees are included. Set a range per account in Settings."
          }
        />
        <Stat
          label="Avg win/loss"
          value={winLossRatio != null ? fmtNum(winLossRatio, 2) : "—"}
          title="Average winning R divided by average losing R."
        />
        <Stat
          label="Recovery factor"
          value={recovery != null ? fmtNum(recovery, 2) : "—"}
          title="Net profit divided by max drawdown. Undefined — not infinite — while the curve has never fallen."
        />
        <Stat
          label="Consistency"
          value={fmtNum(consistency.score, 0)}
          title="100 − (stdev of trade P&L / total profit). Zero while the book is losing."
        />
        <Stat
          label="Avg hold"
          value={formatDuration(holdTime.avgSeconds)}
          title={`Across ${holdTime.count} trades with a known duration.`}
        />
        <Stat
          label="Total swap"
          value={fmtMoney(costs.totalSwap, currency)}
          cls={costs.totalSwap !== 0 ? "text-[var(--loss)]" : undefined}
          title={
            costs.withCostData === 0
              ? "No trade in scope carries a cost — this zero means 'no data', not 'free'."
              : `${costs.withCostData} of ${costs.count} trades carry cost data.`
          }
        />
        <Stat
          label="Week win %"
          value={fmtPct(weekly.winPct)}
          title={`${weekly.winning} winning of ${weekly.periods} weeks. The swing replacement for Day Win %.`}
        />
        <Stat
          label="Trading days"
          value={String(tradingDays)}
          title="Days a position was OPENED. Money is dated by close; activity by open."
        />
        <Stat
          label="Logged days"
          value={String(loggedDays)}
          title="Days with a journal entry — including days you deliberately did not trade."
        />
        <Stat
          label="Avg entry slip"
          value={
            slippageStats.count > 0
              ? fmtR(-slippageStats.avgAdverseR)
              : "—"
          }
          cls={
            slippageStats.count > 0
              ? pnlClass(-slippageStats.avgAdverseR)
              : undefined
          }
        />
        <Stat
          label="Total slip R"
          value={
            slippageStats.count > 0
              ? fmtR(-slippageStats.totalAdverseR)
              : "—"
          }
          cls={
            slippageStats.count > 0
              ? pnlClass(-slippageStats.totalAdverseR)
              : undefined
          }
        />
        <Stat
          label="Target attainment"
          value={
            exitEffStats.count > 0
              ? fmtExitEfficiencyPct(exitEffStats.avgPct)
              : "—"
          }
          cls={
            exitEffStats.count > 0
              ? pnlClass(exitEffStats.avgPct - 50)
              : undefined
          }
          title={
            exitEffStats.count > 0
              ? `Realized R / planned target R · ${exitEffStats.count} closed trades`
              : undefined
          }
        />
        <Stat
          label="Winner target attainment"
          value={
            exitEffStats.winnerCount > 0
              ? fmtExitEfficiencyPct(exitEffStats.avgWinnerPct)
              : "—"
          }
          cls={
            exitEffStats.winnerCount > 0
              ? pnlClass(exitEffStats.avgWinnerPct - 50)
              : undefined
          }
          title="Winning trades only — early exit vs plan"
        />
      </div>

      {/* Equity curve */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-base">
            Equity curve ({mode}, {equityMetric === "money" ? currency : "R"})
          </CardTitle>
          <div className="flex rounded-md border p-0.5">
            {(["money", "r"] as const).map((mt) => (
              <Button
                key={mt}
                variant={equityMetric === mt ? "secondary" : "ghost"}
                size="sm"
                className="h-7"
                onClick={() => setEquityMetric(mt)}
              >
                {mt === "money" ? "$" : "R"}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={equity} margin={{ left: 4, right: 8, top: 8 }}>
              <defs>
                <linearGradient id="eq" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="i" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
              <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" width={56} />
              <Tooltip
                contentStyle={{
                  background: "var(--popover)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                formatter={(v) =>
                  equityMetric === "money"
                    ? fmtMoney(Number(v), currency)
                    : `${Number(v)}R`
                }
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke="var(--chart-1)"
                strokeWidth={2}
                fill="url(#eq)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <DrawdownChart
          series={ddSeries}
          stats={drawdown}
          currency={currency}
        />
        <SickreScoreCard score={sickreScore} />
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <HoldTimeCard stats={holdTime} />
        <CostReportCard costs={costs} currency={currency} />
        <PlanVsRealityCard
          plannedR={plannedR}
          excursion={excursion}
          direction={directionSplit}
        />
        <PeriodPerformanceCard
          summary={weekly}
          label="Nedeljni učinak"
          currency={currency}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <PeriodPerformanceCard
          summary={monthly}
          label="Mesečni učinak"
          currency={currency}
        />
        {/* R distribution */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">R-multiple distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={hist} margin={{ left: 4, right: 8, top: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="bucket" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" width={28} />
                <ReferenceLine x="-1..0" stroke="var(--border)" />
                <Tooltip
                  contentStyle={{
                    background: "var(--popover)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                  {hist.map((b, i) => (
                    <Cell
                      key={i}
                      fill={
                        b.bucket.startsWith("-") || b.bucket === "<-3"
                          ? "var(--loss)"
                          : "var(--profit)"
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Calendar heatmap */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Daily P/L ({mode})</CardTitle>
          </CardHeader>
          <CardContent>
            <CalendarHeatmap daily={daily} currency={currency} />
            <p className="mt-2 text-xs text-muted-foreground">
              Last 26 weeks — green = profit, red = loss (NY days).
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Entry slippage by week */}
      {weeklySlip.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Entry slippage by week</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart
                data={weeklySlip.map((w) => ({
                  week: w.week.slice(5),
                  avgDisplayR: -w.avgSlipR,
                  tradeCount: w.tradeCount,
                }))}
                margin={{ left: 4, right: 8, top: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis
                  dataKey="week"
                  tick={{ fontSize: 10 }}
                  stroke="var(--muted-foreground)"
                />
                <YAxis
                  tick={{ fontSize: 11 }}
                  stroke="var(--muted-foreground)"
                  width={40}
                  tickFormatter={(v) => `${Number(v).toFixed(2)}R`}
                />
                <ReferenceLine y={0} stroke="var(--border)" />
                <Tooltip
                  contentStyle={{
                    background: "var(--popover)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  formatter={(v, _name, item) => {
                    const payload = item.payload as {
                      avgDisplayR: number;
                      tradeCount: number;
                    };
                    return [
                      `${Number(v).toFixed(2)}R avg (${payload.tradeCount} trades)`,
                      "Slippage",
                    ];
                  }}
                  labelFormatter={(label) => `Week ${label}`}
                />
                <Bar dataKey="avgDisplayR" radius={[3, 3, 0, 0]}>
                  {weeklySlip.map((w, i) => (
                    <Cell
                      key={i}
                      fill={
                        w.avgSlipR > 0
                          ? "var(--loss)"
                          : w.avgSlipR < 0
                            ? "var(--profit)"
                            : "var(--muted-foreground)"
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <p className="mt-2 text-xs text-muted-foreground">
              Planned entry vs avg fill, in R (vs planned stop). Includes spread
              when planned was mid and fill was ask/bid.
            </p>
          </CardContent>
        </Card>
      )}

      {weeklyExitEff.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Target attainment by week</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart
                data={weeklyExitEff.map((w) => ({
                  week: w.week.slice(5),
                  avgPct: w.avgPct,
                  tradeCount: w.tradeCount,
                }))}
                margin={{ left: 4, right: 8, top: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis
                  dataKey="week"
                  tick={{ fontSize: 10 }}
                  stroke="var(--muted-foreground)"
                />
                <YAxis
                  tick={{ fontSize: 11 }}
                  stroke="var(--muted-foreground)"
                  width={44}
                  tickFormatter={(v) => `${Number(v).toFixed(0)}%`}
                />
                <ReferenceLine y={50} stroke="var(--border)" strokeDasharray="4 4" />
                <Tooltip
                  contentStyle={{
                    background: "var(--popover)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  formatter={(v, _name, item) => {
                    const payload = item.payload as {
                      avgPct: number;
                      tradeCount: number;
                    };
                    return [
                      `${Number(v).toFixed(0)}% avg (${payload.tradeCount} trades)`,
                      "Target attainment",
                    ];
                  }}
                  labelFormatter={(label) => `Week ${label}`}
                />
                <Bar dataKey="avgPct" radius={[3, 3, 0, 0]}>
                  {weeklyExitEff.map((w, i) => (
                    <Cell
                      key={i}
                      fill={
                        w.avgPct >= 50
                          ? "var(--profit)"
                          : w.avgPct >= 0
                            ? "var(--chart-4)"
                            : "var(--loss)"
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <p className="mt-2 text-xs text-muted-foreground">
              Realized R vs planned target R. Not the same as Capture % (realized /
              MFE).
            </p>
          </CardContent>
        </Card>
      )}

      {/* Breakdown by tag */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-base">Performance by tag</CardTitle>
          <Select value={breakdownField} onValueChange={setBreakdownField}>
            <SelectTrigger className="h-8 w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BREAKDOWN_FIELDS.map((f) => (
                <SelectItem key={f.value} value={f.value}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Value</th>
                  <th className="py-2 pr-4 font-medium">Trades</th>
                  <th className="py-2 pr-4 font-medium">Win %</th>
                  <th className="py-2 pr-4 font-medium">Avg R</th>
                  <th className="py-2 pr-4 font-medium">Total R</th>
                  <th className="py-2 pr-4 font-medium text-right">Net P/L</th>
                </tr>
              </thead>
              <tbody>
                {breakdown.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-muted-foreground">
                      No closed trades in range.
                    </td>
                  </tr>
                )}
                {breakdown.map((r) => (
                  <tr key={r.key} className="border-b last:border-0">
                    <td className="py-2 pr-4 font-medium">{r.key}</td>
                    <td className="py-2 pr-4">{r.count}</td>
                    <td className="py-2 pr-4">{fmtPct(r.winRate)}</td>
                    <td className={`py-2 pr-4 ${pnlClass(r.avgR)}`}>{fmtR(r.avgR)}</td>
                    <td className={`py-2 pr-4 ${pnlClass(r.totalR)}`}>{fmtR(r.totalR)}</td>
                    <td className={`py-2 pr-4 text-right ${pnlClass(r.netSum)}`}>
                      {fmtMoney(r.netSum, currency, { sign: true })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({
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
    <Card title={title}>
      <CardContent className="p-3">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`mt-1 text-lg font-semibold ${cls ?? ""}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
