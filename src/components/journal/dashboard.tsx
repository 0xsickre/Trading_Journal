"use client";

import { useMemo, useState } from "react";
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
import type { Account, TradeRow } from "@/lib/journal/types";
import {
  toRealized,
  computeStats,
  buildEquity,
  rHistogram,
  dailyPnl,
  breakdownByField,
  type PnlMode,
} from "@/lib/journal/analytics";
import {
  buildMentorPack,
  resolveCalendarRange,
  type Granularity,
} from "@/lib/journal/mentor-export";
import { Input } from "@/components/ui/input";
import { fmtMoney, fmtR, fmtPct, fmtNum, pnlClass } from "@/lib/journal/format";

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

const BREAKDOWN_FIELDS = [
  { value: "setup_grade", label: "Setup Grade" },
  { value: "technical_tags", label: "Technical Tags" },
  { value: "ict_entry_model", label: "Entry Model" },
  { value: "direction", label: "Direction" },
  { value: "instrument", label: "Instrument" },
  { value: "psychology_tags", label: "Psychology Tags" },
  { value: "discipline", label: "Discipline" },
  { value: "mistake", label: "Mistake" },
  { value: "trade_type", label: "Trade Type" },
];

export function Dashboard({
  trades,
  accounts,
}: {
  trades: TradeRow[];
  accounts: Account[];
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

  const tzOf = (t: { row: TradeRow }) => {
    const a = accounts.find((x) => x.id === t.row.account_id);
    return a?.timezone ?? "America/New_York";
  };

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

  const stats = useMemo(() => computeStats(realized, mode), [realized, mode]);
  const equity = useMemo(
    () => buildEquity(realized, mode, equityMetric, startBalance),
    [realized, mode, equityMetric, startBalance],
  );
  const hist = useMemo(() => rHistogram(realized), [realized]);
  const daily = useMemo(
    () => dailyPnl(realized, mode, tzOf),
    [realized, mode, accounts],
  );
  const breakdown = useMemo(
    () => breakdownByField(realized, breakdownField),
    [realized, breakdownField],
  );

  function handleExportMentorPack() {
    let scoped =
      accountFilter === "all"
        ? trades
        : trades.filter((t) => t.account_id === accountFilter);
    const scopeLabel =
      accountFilter === "all"
        ? "All accounts"
        : accounts.find((a) => a.id === accountFilter)?.name ?? "Account";

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
          ) : granularity !== "all" ? (
            <Input
              type="date"
              value={anchor}
              onChange={(e) => setAnchor(e.target.value)}
              className="h-8 w-36"
              aria-label="Anchor date"
              title="Any date inside the period you want (e.g. a day in last month)"
            />
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
}: {
  label: string;
  value: string;
  cls?: string;
}) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`mt-1 text-lg font-semibold ${cls ?? ""}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
