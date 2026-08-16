"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Download } from "lucide-react";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import {
  AXIS_PROPS,
  ChartShell,
  GRID_PROPS,
  TOOLTIP_STYLE,
} from "@/components/journal/chart-shell";
import { StatGroup } from "@/components/journal/stat-group";
import { CalendarHeatmap } from "@/components/journal/calendar-heatmap";
import { TrackerStreakCard } from "@/components/journal/tracker-streak-card";
import {
  buildTradeDayIndex,
  configsFromRules,
  evaluateAutoRulesForDay,
} from "@/lib/journal/tracker/auto-rules";
import {
  computeComplianceSeries,
  meanCompliance,
  resolveAutoResults,
  rulesLiveOn,
} from "@/lib/journal/tracker/compliance";
import { processAdherence } from "@/lib/journal/tracker/process-adherence";
import type {
  TrackerCheckin,
  TrackerRule,
} from "@/lib/journal/tracker-types";
import {
  accountTimezoneResolver,
  addDaysToDayKey,
  dayKeyStartUtc,
} from "@/lib/journal/time";
import {
  buildPlaybookLookup,
  computeFollowRate,
} from "@/lib/journal/reports/playbook-dimensions";
import { enrichTrades } from "@/lib/journal/enriched-trade";
import type { Playbook, PositionRule } from "@/lib/journal/playbook-types";
import {
  buildBalanceTimeline,
  computeDrawdown,
  drawdownSeries,
  resolvePeriodWindow,
  type CashEvent,
} from "@/lib/journal/balance";
import { computeHoldTime } from "@/lib/journal/hold-time";
import { computeCostStats } from "@/lib/journal/costs";
import { computeExcursionStats } from "@/lib/journal/excursion";
import {
  computeDirectionSplit,
  countLoggedDays,
  tradingDayKeysFromRows,
} from "@/lib/journal/activity";
import { bucketByPeriod, summarizePeriods } from "@/lib/journal/period-stats";
import {
  avgWinLossRatio,
  computePlannedRStats,
  consistencyScore,
  recoveryFactor,
} from "@/lib/journal/risk-metrics";
import { computeSickreScore } from "@/lib/journal/sickre-score";
import { buildInsightContext, type DailyReportLite } from "@/lib/journal/insights/context";
import type { PositionCheckin } from "@/lib/journal/position-checkin";
import { runInsights } from "@/lib/journal/insights/registry";
import { InsightsPanel } from "@/components/journal/insights-panel";
import { DrawdownChart } from "@/components/journal/drawdown-chart";
import { SickreScoreCard } from "@/components/journal/sickre-score-card";
import {
  CostReportCard,
  HoldTimeCard,
  PeriodPerformanceCard,
  PlanVsRealityCard,
} from "@/components/journal/metrics-panel";
import {
  hasBreakevenBand,
  sharedBreakevenRange,
} from "@/lib/journal/breakeven";
import {
  customFieldDimensions,
  dimensionsByGroup,
} from "@/lib/journal/reports/dimensions";
import type { Account, TradeRow } from "@/lib/journal/types";
import type { FieldDef } from "@/lib/journal/field-def-types";
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
import { unpricedClosedCount } from "@/lib/journal/money-provenance";
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
import { toEpoch, zonedDateKey } from "@/lib/journal/time";
import {
  MIN_RATIO_DAYS,
  computeDailyDrawdown,
  computeRiskRatios,
  type DayPnlPoint,
  type RiskRatios,
} from "@/lib/journal/risk-ratios";

/**
 * Shared tooltip tail for the three risk ratios.
 *
 * Every one of them is annualized by the number of days actually traded rather
 * than by a fixed 252, so the scale factor is spelled out. Without it the
 * figure is not comparable to a Sharpe quoted anywhere else, and the reader has
 * no way to know that.
 */
function ratioTitle(base: string, r: RiskRatios): string {
  if (r.days < MIN_RATIO_DAYS) {
    return `${base} Needs at least ${MIN_RATIO_DAYS} days with a closed trade — there are ${r.days}.`;
  }
  const scale = Math.round(r.periodsPerYear ?? 0);
  return `${base} ${r.days} trading days across ${r.spanDays} calendar days, so the annual scale is √${scale}.`;
}

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

/**
 * Breakdown options come from the dimension registry now, so a dimension added
 * there appears here without a second edit. Narrowed to trade columns plus the
 * user's own fields: the derived and process dimensions belong on /reports,
 * where the sample size sits next to every number.
 */
function breakdownFields(custom: readonly { key: string; label: string }[]) {
  return [
    ...dimensionsByGroup("trade").filter((d) => d.key !== "account"),
    ...custom,
  ].map((d) => ({ value: d.key, label: d.label }));
}

/**
 * Days of compliance history held in memory: 28 weeks, matching what the
 * dashboard page fetches, so the 26-week calendar still has data in its leading
 * partial column.
 */
const TRACKER_SPAN_DAYS = 28 * 7;

export function Dashboard({
  trades,
  accounts,
  cashEvents = [],
  loggedDates = [],
  dailyReports = [],
  positionCheckins = [],
  fillCounts,
  fieldDefs = [],
  trackerRules = [],
  checkins = [],
  todayKey,
  timezone,
  playbooks = [],
  positionRules,
}: {
  trades: TradeRow[];
  accounts: Account[];
  cashEvents?: CashEvent[];
  loggedDates?: string[];
  dailyReports?: DailyReportLite[];
  /** Per-position daily check-ins — what the micromanage insight joins on. */
  positionCheckins?: PositionCheckin[];
  fillCounts?: Map<string, { entries: number; exits: number }>;
  /** User-defined fields, so the mentor pack carries them too. */
  fieldDefs?: FieldDef[];
  /** Including retired ones — a rule live on a past day still scored that day. */
  trackerRules?: TrackerRule[];
  checkins?: TrackerCheckin[];
  /**
   * Today in the ACCOUNT's timezone, resolved on the server.
   *
   * Not `new Date()` here: every tracker day key is an account-timezone day, and
   * a browser in another zone would anchor the calendar one column off.
   */
  todayKey: string;
  /**
   * The zone `todayKey` was resolved in. Passed together with it, from the same
   * account on the same server render, so the two cannot disagree — deriving it
   * here from `accounts` would be a second answer to one question.
   */
  timezone: string;
  /** Retired rules included — their recorded answers are real observations. */
  playbooks?: Playbook[];
  positionRules?: Map<string, PositionRule[]>;
}) {
  const [accountFilter, setAccountFilter] = useState("all");
  const [period, setPeriod] = useState("90");
  const [mode, setMode] = useState<PnlMode>("net");
  const [equityMetric, setEquityMetric] = useState<"money" | "r">("money");
  const [breakdownField, setBreakdownField] = useState("setup_grade");
  // The user's own fields are groupable here exactly like a built-in column.
  const breakdownOptions = useMemo(
    () => breakdownFields(customFieldDimensions(fieldDefs)),
    [fieldDefs],
  );
  const [granularity, setGranularity] = useState<Granularity>("week");
  const [anchor, setAnchor] = useState(todayYMD);
  const [customFrom, setCustomFrom] = useState(todayYMD);
  const [customTo, setCustomTo] = useState(todayYMD);

  // Years present in the data (newest first) for the Year/Quarter pickers.
  const yearOptions = useMemo(() => {
    // The ACCOUNT's year, not the browser's and not UTC's. On 31 December in
    // Tokyo, UTC is still in the old year and this picker would not offer the
    // year the trader is actually in; on 1 January in New York the reverse.
    const cur = Number(todayKey.slice(0, 4));
    let min = cur;
    for (const t of trades) {
      const ref = t.stats?.closed_at ?? t.created_at;
      const y = ref ? Number(String(ref).slice(0, 4)) : NaN;
      if (Number.isFinite(y) && y < min) min = y;
    }
    return Array.from({ length: cur - min + 1 }, (_, i) => cur - i);
  }, [trades, todayKey]);

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

  /**
   * Zona po nalogu, sa istim lancem rezervi koji koriste rute.
   *
   * Ovde je stajalo `?? "America/New_York"` bez rezerve na PRIMARNI nalog, dok
   * su `/calendar` i `/playbooks` padale na `primary?.timezone`. Za trejd bez
   * `account_id` — a takav nastaje kad se nalog obriše, jer je strani ključ
   * `ON DELETE SET NULL` — Dashboard bi ga datirao po njujorškom danu a kalendar
   * po zoni primarnog naloga. Na nalogu u `Europe/Berlin` to je isti trejd u dve
   * različite kolone kalendara.
   *
   * Primarni je „prvi aktivan, inače prvi" — isto pravilo koje `getPrimaryAccount`
   * primenjuje na serveru.
   */
  const tzForAccount = useMemo(() => {
    const primary = accounts.find((a) => a.is_active) ?? accounts[0];
    return accountTimezoneResolver(accounts, primary?.timezone);
  }, [accounts]);

  const tzOf = useCallback(
    (t: { row: TradeRow }) => tzForAccount(t.row.account_id),
    [tzForAccount],
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

  /**
   * Start of the selected window as epoch ms, or null for "all time".
   *
   * The day the window OPENS, in the account's zone — not an instant N×24h
   * before now. Two things were wrong with the old `new Date()` version, and
   * this component already argues against both of them eighty lines up, where
   * `todayKey` is documented as being resolved on the server precisely because
   * "a browser in another zone would anchor the calendar one column off":
   *
   *   1. It read the BROWSER's clock. Trading a New York account from Belgrade,
   *      the browser has already rolled into tomorrow while the account has not,
   *      so the money window and the tracker window covered different days.
   *   2. It kept the current time of day, making the window slide continuously.
   *      A trade closed at 10:00 ninety days ago was inside the period at 09:00
   *      and outside it at 11:00 — the same page, the same data, two different
   *      net P&Ls depending on when you opened it.
   *
   * `-(period - 1)` matches `processAdherencePct` below, which has always used
   * `addDaysToDayKey(todayKey, -(period - 1))`. The two halves of the Sickre
   * Score were measuring windows a day apart.
   */
  const cutoffMs = useMemo(() => {
    if (period === "all") return null;
    const from = addDaysToDayKey(todayKey, -(Number(period) - 1));
    return dayKeyStartUtc(from, timezone);
  }, [period, todayKey, timezone]);

  /** Every realized trade in account scope, ignoring the period filter. */
  const realizedAll = useMemo(() => {
    const rows =
      accountFilter === "all"
        ? trades
        : trades.filter((t) => t.account_id === accountFilter);
    return toRealized(rows);
  }, [trades, accountFilter]);

  const realized = useMemo(
    () =>
      cutoffMs == null
        ? realizedAll
        : realizedAll.filter((t) => toEpoch(t.closedAt) >= cutoffMs),
    [realizedAll, cutoffMs],
  );

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
    // Isti izraz koji četiri rute koriste — razlika je samo u tome ŠTA se
    // prosleđuje: Dashboard filtrira po izabranom nalogu, rute uzimaju sve.
    // Ta razlika je namerna i ostaje; ono što je uklonjeno je pet kopija samog
    // pravila „pojas važi samo ako se svi nalozi slažu".
    return sharedBreakevenRange(scoped);
  }, [accountFilter, accounts]);

  const scopedCashEvents = useMemo(
    () =>
      accountFilter === "all"
        ? cashEvents
        : cashEvents.filter((c) => c.account_id === accountFilter),
    [cashEvents, accountFilter],
  );

  /**
   * The window's opening equity, and the cash events inside it.
   *
   * The period filter used to narrow the TRADES but not the cash events, then
   * seed the curve with the full starting balance — producing
   * `starting_balance + 90d of P&L + all-time deposits`, an equity figure that
   * describes no account that ever existed. Since peak equity is the
   * denominator for every drawdown percentage, the headline "Max drawdown %"
   * was wrong for every period except "All".
   *
   * Both sides are now cut at the same instant, and the curve opens at the
   * equity the account actually held on day one of the window.
   */
  const windowed = useMemo(
    () =>
      resolvePeriodWindow(
        startBalance,
        realizedAll.map((t) => ({
          at: t.closedAt ?? "",
          pnl: mode === "net" ? t.net : t.gross,
        })),
        scopedCashEvents,
        cutoffMs,
      ),
    [cutoffMs, startBalance, realizedAll, scopedCashEvents, mode],
  );

  /**
   * Drawdown is measured on two different bases on purpose: money comes from
   * cumulative P&L (a withdrawal is not a loss), percentage comes from equity
   * including cash flow (a deposit really does change what a dollar loss means).
   */
  const stats = useMemo(
    () => computeStats(realized, mode, breakevenRange),
    [realized, mode, breakevenRange],
  );

  // One timeline, three consumers. This was previously built twice from
  // identical arguments — once for the drawdown stats and once for the chart.
  const balanceTimeline = useMemo(
    () =>
      buildBalanceTimeline(
        windowed.openingEquity,
        realized.map((t) => ({
          at: t.closedAt ?? "",
          pnl: mode === "net" ? t.net : t.gross,
        })),
        windowed.events,
      ),
    [realized, mode, windowed],
  );
  const drawdown = useMemo(
    () => computeDrawdown(balanceTimeline),
    [balanceTimeline],
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

  // The period rows carry both bases; the summary must be told which one the
  // dashboard is currently showing, or Week Win % would stay on net while
  // every other number switched to gross.
  const periodPnlOf = useCallback(
    (r: { net: number; gross: number }) => (mode === "net" ? r.net : r.gross),
    [mode],
  );
  const weekly = useMemo(
    () =>
      summarizePeriods(
        bucketByPeriod(realized, "week", tzOf, breakevenRange, pnlOf),
        periodPnlOf,
      ),
    [realized, tzOf, breakevenRange, pnlOf, periodPnlOf],
  );
  const monthly = useMemo(
    () =>
      summarizePeriods(
        bucketByPeriod(realized, "month", tzOf, breakevenRange, pnlOf),
        periodPnlOf,
      ),
    [realized, tzOf, breakevenRange, pnlOf, periodPnlOf],
  );

  // Counted from raw rows, not realized trades: a position opened this week and
  // still running is a day the market was engaged.
  const tradingDays = useMemo(() => {
    const scoped =
      accountFilter === "all"
        ? trades
        : trades.filter((t) => t.account_id === accountFilter);
    return tradingDayKeysFromRows(scoped, (row) => tzForAccount(row.account_id))
      .size;
  }, [trades, accountFilter, tzForAccount]);
  const loggedDays = useMemo(
    () => countLoggedDays(loggedDates),
    [loggedDates],
  );

  /**
   * Zatvoreni trejdovi koje NIJEDAN broj na ovoj stranici ne uključuje.
   *
   * `toRealized` odbacuje svaki red bez `net_pl`, i to je tačno — trejd koji se
   * ne može vrednovati ne sme da uđe u zbir kao nula. Ali odbačen red nestaje i
   * iz broja trejdova, i iz neto rezultata, i iz svake metrike ispod. Dashboard
   * je do sada o tome ćutao, pa je knjiga od deset trejdova sa tri
   * nevrednovana pisala „7" bez ijedne reči.
   */
  const unpriced = useMemo(() => {
    const scoped =
      accountFilter === "all"
        ? trades
        : trades.filter((t) => t.account_id === accountFilter);
    return unpricedClosedCount(scoped);
  }, [trades, accountFilter]);

  const winLossRatio = useMemo(
    () => avgWinLossRatio(stats.avgWinMoney, stats.avgLossMoney),
    [stats.avgWinMoney, stats.avgLossMoney],
  );
  const recovery = useMemo(
    () => recoveryFactor(stats.netSum, drawdown.maxMoney),
    [stats.netSum, drawdown.maxMoney],
  );
  const consistency = useMemo(
    () => consistencyScore(realized.map(pnlOf)),
    [realized, pnlOf],
  );

  /**
   * Daily P&L points behind Sharpe, Sortino, Calmar and the daily drawdown.
   *
   * Dated by CLOSE and in the account's own zone, matching every other money
   * figure on this page. A trade closed at 01:00 UTC belongs to the previous
   * New York day, and reading the calendar in the browser's zone would move it.
   */
  const dayPoints = useMemo<DayPnlPoint[]>(
    () =>
      realized.map((t) => ({
        day: zonedDateKey(t.closedAt, tzOf(t)),
        at: t.closedAt,
        pnl: pnlOf(t),
      })),
    [realized, tzOf, pnlOf],
  );
  const ratios = useMemo(
    // The same drawdown the KPI row shows, so Calmar and Recovery factor cannot
    // disagree about the denominator they share.
    () => computeRiskRatios(dayPoints, drawdown.maxMoney),
    [dayPoints, drawdown.maxMoney],
  );
  const dailyDd = useMemo(() => computeDailyDrawdown(dayPoints), [dayPoints]);

  const insightResult = useMemo(
    () =>
      runInsights(
        buildInsightContext({
          trades: realized,
          allRows: accountFilter === "all"
            ? trades
            : trades.filter((t) => t.account_id === accountFilter),
          reports: dailyReports,
          checkins: positionCheckins,
          tzOf,
          range: breakevenRange,
          pnlOf,
          currency,
          fillCounts,
        }),
      ),
    [
      realized,
      trades,
      accountFilter,
      dailyReports,
      positionCheckins,
      tzOf,
      breakevenRange,
      pnlOf,
      currency,
      fillCounts,
    ],
  );

  /**
   * Daily process compliance over the calendar's full span.
   *
   * Computed once over 26 weeks and then sliced, rather than recomputed per
   * consumer: the heatmap and streak want the whole span, the score wants the
   * period filter, and the two must never disagree about a day.
   */
  const trackerSeries = useMemo(() => {
    if (trackerRules.length === 0) return [];

    const scoped =
      accountFilter === "all"
        ? trades
        : trades.filter((t) => t.account_id === accountFilter);
    const index = buildTradeDayIndex(scoped, (row) =>
      tzForAccount(row.account_id),
    );

    const byDate = new Map<string, Map<string, TrackerCheckin>>();
    for (const c of checkins) {
      const day = byDate.get(c.report_date) ?? new Map<string, TrackerCheckin>();
      day.set(c.rule_id, c);
      byDate.set(c.report_date, day);
    }

    const days: string[] = [];
    for (let i = TRACKER_SPAN_DAYS - 1; i >= 0; i--)
      days.push(addDaysToDayKey(todayKey, -i));

    return computeComplianceSeries(days, trackerRules, byDate, (d) =>
      // Frozen verdicts win on a locked day, so correcting a trade from it moves
      // the money and leaves that day's compliance where it was.
      resolveAutoResults(
        trackerRules,
        // Configs are resolved PER DAY: a retired rule and its replacement share
        // one `auto_key`, so a set built once for the whole span can hand a dead
        // limit to every day in it.
        evaluateAutoRulesForDay(d, index, configsFromRules(rulesLiveOn(trackerRules, d))),
        byDate.get(d) ?? new Map(),
      ),
    todayKey);
  }, [trackerRules, checkins, trades, accountFilter, tzForAccount, todayKey]);

  /**
   * Process adherence for the score, over the SAME window as the other six
   * components — otherwise the score would mix a 90-day profit factor with a
   * six-month discipline figure and call the result one number.
   *
   * "All" is capped at the span actually loaded; the alternative is fetching
   * every check-in ever to move a 15 % component by a fraction.
   */
  const processAdherencePct = useMemo(() => {
    const from =
      period === "all"
        ? ""
        : addDaysToDayKey(todayKey, -(Number(period) - 1));
    const trackerPct = meanCompliance(
      trackerSeries.filter((d) => d.date >= from),
    );

    const lookup = buildPlaybookLookup(playbooks, positionRules);
    const followRatePct = computeFollowRate(
      enrichTrades(realized, { tzOf, range: breakevenRange, pnlOf, fillCounts }),
      lookup.rules,
    );

    return processAdherence({ trackerPct, followRatePct });
  }, [
    trackerSeries,
    period,
    todayKey,
    playbooks,
    positionRules,
    realized,
    tzOf,
    breakevenRange,
    pnlOf,
    fillCounts,
  ]);

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
        processAdherencePct,
        // Drawdown, win % and consistency all answer 0 for an empty book, and a
        // 0 drawdown scores 100. The counts let the score tell "no evidence"
        // from "measured zero" and drop the component instead.
        sample: { trades: stats.count, decided: stats.wins + stats.losses },
      }),
    [
      stats.profitFactor,
      stats.winRate,
      stats.count,
      stats.wins,
      stats.losses,
      winLossRatio,
      drawdown.maxPctOfPeakPnl,
      recovery,
      consistency.score,
      processAdherencePct,
    ],
  );
  const equity = useMemo(
    () => buildEquity(realized, mode, equityMetric, windowed.openingEquity),
    [realized, mode, equityMetric, windowed],
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
    // Compared as instants: the bounds are generated as "...T00:00:00.000Z"
    // while closed_at arrives as "...+00:00", and a text compare of the two
    // inverts exactly at a midnight boundary — the one moment a range edge
    // actually falls on.
    const fromMs = fromISO ? toEpoch(fromISO) : null;
    const toMs = toISO ? toEpoch(toISO) : null;
    scoped = scoped.filter((t) => {
      const ref = toEpoch(t.stats?.closed_at ?? t.created_at ?? null);
      if (fromMs != null && ref < fromMs) return false;
      if (toMs != null && ref > toMs) return false;
      return true;
    });

    // The pack must describe the scope being exported, not whatever the
    // dashboard filter happens to show, so insights are re-evaluated for it.
    const scopedInsights = runInsights(
      buildInsightContext({
        trades: toRealized(scoped),
        allRows: scoped,
        reports: dailyReports,
        checkins: positionCheckins,
        tzOf,
        range: breakevenRange,
        pnlOf,
        currency,
        fillCounts,
      }),
    );

    const md = buildMentorPack(scoped, {
      insights: scopedInsights,
      currency,
      scopeLabel,
      periodLabel: label,
      rangeText,
      // Same band the dashboard classifies with, so the exported win rate
      // matches the one on screen.
      breakevenRange,
      startingBalance: scopedAccount?.starting_balance ?? null,
      fieldDefs,
    });
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const stamp = granularity === "all" ? todayYMD() : (fromISO ?? "").slice(0, 10);
    a.download = `mentor-pack-${label.toLowerCase()}-${stamp}.md`;

    // Firefox only dispatches a click on an anchor that is in the document, and
    // both Firefox and Safari read the blob asynchronously — revoking the URL
    // on the same tick cancelled the download outright. Attach, click, then
    // clean up once the browser has had the chance to start reading.
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 0);
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

      {unpriced > 0 && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-md border border-[var(--loss)]/40 bg-[var(--loss)]/5 p-3 text-sm"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--loss)]" />
          <span>
            <strong className="font-medium">
              {unpriced} closed {unpriced === 1 ? "trade is" : "trades are"} missing from every
              figure on this page.
            </strong>{" "}
            Their P&amp;L could not be calculated — no instrument definition, or
            no exchange rate for a quote currency that differs from the account.
            Open{" "}
            <Link href="/journal" className="underline">
              the journal
            </Link>{" "}
            to see which, and fix them in Settings or on the trade.
          </span>
        </div>
      )}

      {/* Scope. Everything in this bar narrows the page; nothing in it exports.
          That was not true before — the mentor-pack pickers sat here too, and a
          bar where two of the eight controls silently mean something else is a
          bar the reader has to learn instead of read. */}
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

        {/* The export pickers used to sit here, inline: a granularity select,
            up to two date inputs or a quarter+year pair, a button, and a range
            preview line under the whole bar. Six controls that describe a
            DIFFERENT period than the one this bar sets — and, sitting among the
            filters, read as though they narrowed the page. They are one popover
            now; the trigger says what they are for, and the range preview lives
            next to the pickers that produce it instead of under the filters. */}
        <div className="sm:ml-auto">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                title="Download a Markdown pack for the selected period to upload into Claude for mentor feedback"
              >
                <Download className="size-4" /> Export for Claude
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 space-y-3">
              <div>
                <p className="text-sm font-medium">Export for Claude</p>
                <p className="text-xs text-muted-foreground">
                  A Markdown pack for the selected period — upload it to Claude for
                  mentor feedback.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-1">
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
              </div>

              {granularity !== "all" && (
                <p className="text-xs text-muted-foreground">
                  Range: {exportRange.rangeText}
                </p>
              )}

              <Button
                size="sm"
                className="w-full"
                onClick={handleExportMentorPack}
              >
                <Download className="size-4" /> Download .md
              </Button>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* THE HEADLINE SIX.
          Everything below used to sit in this one flat grid — thirty tiles at
          one size, no headings, so `Net P/L` and `Total swap` carried the same
          visual weight and the reader had to know the app to find the number
          they came for. These six are the ones a session actually opens on.

          `Trades` is up here as sample size, not as a metric: README's rule is
          "veličina uzorka putuje uz broj", and a win rate over four trades read
          without its denominator is exactly the kind of confident-wrong figure
          this project is built to refuse. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat
          size="hero"
          label="Net P/L"
          value={fmtMoney(stats.netSum, currency, { sign: true })}
          cls={pnlClass(stats.netSum)}
        />
        <Stat size="hero" label="Trades" value={String(stats.count)} />
        <Stat
          size="hero"
          label="Win rate"
          // `computeStats` answers `0`, not `null`, when there are no decided
          // trades — correct for the STATISTIC (breakeven excluded from both
          // sides, so nothing to divide), wrong read as a MEASUREMENT: an
          // all-breakeven book showed "Win rate: 0.0%", indistinguishable from
          // a book that decided nine trades and lost every one. Caught by
          // `dashboard.render.test.tsx`'s all-breakeven case; the guard already
          // exists at the same call in `day-stats-card.tsx` and
          // `month-calendar.tsx` — this tile was the one place it was missed.
          value={
            stats.wins + stats.losses === 0 ? "—" : fmtPct(stats.winRate)
          }
        />
        <Stat
          size="hero"
          label="Profit factor"
          value={
            stats.profitFactor == null
              ? "—"
              : Number.isFinite(stats.profitFactor)
                ? fmtNum(stats.profitFactor, 2)
                : "∞"
          }
          title="Gross profit / gross loss. ∞ means no losing trades in range."
        />
        {/* ZAŠTO SE OVO RAZLIKUJE OD `Avg R`.
            Isti R, dva imenioca — i bez ove rečenice to na ekranu izgleda kao
            nesaglasnost. Expectancy je ponderisan win rate-om nad ODLUČENOM R
            populacijom, pa breakeven trejd ispada; `Avg R` je običan prosek
            preko svih koji imaju R. Na knjizi od 20 trejdova sa jednim
            breakeven-om to je 12.84/19 = 0.68 naspram 12.84/20 = 0.64. */}
        <Stat
          size="hero"
          label="Expectancy"
          value={fmtR(stats.expectancy)}
          cls={pnlClass(stats.expectancy)}
          title={`Expected R per trade, weighted by win rate over the ${stats.expectancySample} decided trades that carry an R. Breakeven trades are excluded, which is why this can differ from Avg R — that one is a plain mean over every trade with an R.`}
        />
        <Stat
          size="hero"
          label="Max drawdown"
          value={fmtMoney(stats.maxDrawdown, currency)}
          cls="text-[var(--loss)]"
          title="Worst peak-to-trough drop in cumulative P&L. Deposits and withdrawals are not losses, so they do not move this number."
        />
      </div>

      {/* The remaining twenty-four, in three named blocks the reader can fold
          away. Nothing is dropped and nothing is hidden by default — the tiles
          are the same tiles, they just no longer arrive as one undifferentiated
          wall. See `stat-group.tsx` for why "open" is an invariant here and not
          merely a default. */}
      <div className="space-y-4">
        <StatGroup id="result" title="Result — detail" count={10}>
          <Stat
            label="Gross P/L"
            value={fmtMoney(stats.grossSum, currency, { sign: true })}
            cls={pnlClass(stats.grossSum)}
          />
          <Stat label="Total R" value={fmtR(stats.totalR)} cls={pnlClass(stats.totalR)} />
          <Stat
            label="Avg R"
            value={fmtR(stats.avgR)}
            cls={pnlClass(stats.avgR)}
            title="Plain mean R over every trade that has one. Includes breakeven trades, which is why it can sit below Expectancy — that one weights by win rate over decided trades only."
          />
          <Stat label="Best" value={fmtMoney(stats.best, currency, { sign: true })} cls={pnlClass(stats.best)} />
          <Stat label="Worst" value={fmtMoney(stats.worst, currency, { sign: true })} cls={pnlClass(stats.worst)} />
          <Stat
            label="Streak W/L"
            value={`${stats.maxWinStreak} / ${stats.maxLossStreak}`}
          />
          <Stat
            label="Avg win/loss"
            value={winLossRatio != null ? fmtNum(winLossRatio, 2) : "—"}
            title="Average winning R divided by average losing R."
          />
          {/* THE DENOMINATOR, SPELLED OUT.

              `Breakeven` has always been here as a raw count while wins and
              losses were not, so "Win rate 52.6 %" sat on screen with nothing
              saying 52.6 % OF WHAT. The reader had to derive it from the trade
              count minus the breakeven count — arithmetic the screen should be
              doing. Reported by the owner on a real 20-trade book.

              Beside `Breakeven` on purpose: the three counts add up to
              `Trades`, and read together they show that breakeven sits OUTSIDE
              the win-rate denominator rather than being counted as a loss. */}
          <Stat
            label="Wins / Losses"
            value={`${stats.wins} / ${stats.losses}`}
            title={`Win rate is ${stats.wins} of ${stats.wins + stats.losses} decided trades. Breakeven trades are excluded from both sides, so wins + losses + breakeven = ${stats.count}.`}
          />
          <Stat
            label="Breakeven"
            value={String(stats.breakeven)}
            title={
              hasBreakevenBand(breakevenRange)
                ? `Trades landing in ${fmtMoney(breakevenRange.from, currency)} … ${fmtMoney(breakevenRange.to, currency)}. Outside the win-rate denominator — neither a win nor a loss.`
                : "No breakeven band configured — only an exact 0.00 counts, which almost never happens once fees are included. Set a range per account in Settings."
            }
          />
          <Stat
            label="Week win %"
            // Same guard, same reason: a book whose only week was flat (net
            // exactly at the breakeven band) has `winning + losing === 0`, and
            // `winPct` answers 0 for that — not "0% of weeks won" but "no week
            // was won or lost at all".
            value={
              weekly.winning + weekly.losing === 0
                ? "—"
                : fmtPct(weekly.winPct)
            }
            title={`${weekly.winning} winning of ${weekly.periods} weeks. The swing replacement for Day Win %.`}
          />
        </StatGroup>

        <StatGroup id="risk" title="Risk" count={7}>
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
            label="Avg daily DD"
            value={fmtMoney(dailyDd.avgMoney, currency)}
            cls={dailyDd.avgMoney < 0 ? "text-[var(--loss)]" : undefined}
            title={
              dailyDd.worstDay
                ? `Average drop below the day's own high-water mark, across ${dailyDd.days} days with a trade. A day that never went underwater counts as 0. Worst: ${fmtMoney(dailyDd.worstMoney, currency)} on ${dailyDd.worstDay}.`
                : `Average drop below the day's own high-water mark, across ${dailyDd.days} days with a trade.`
            }
          />
          <Stat
            label="Sharpe"
            value={ratios.sharpe != null ? fmtNum(ratios.sharpe, 2) : "—"}
            title={ratioTitle(
              "Mean daily P&L divided by its standard deviation.",
              ratios,
            )}
          />
          <Stat
            label="Sortino"
            value={ratios.sortino != null ? fmtNum(ratios.sortino, 2) : "—"}
            title={ratioTitle(
              "Like Sharpe, but the denominator counts losing days only — upside is not risk. Empty while no day has lost money.",
              ratios,
            )}
          />
          <Stat
            label="Calmar"
            value={ratios.calmar != null ? fmtNum(ratios.calmar, 2) : "—"}
            title={ratioTitle(
              "Annualized profit divided by max drawdown — the recovery factor divided by how long it took to earn.",
              ratios,
            )}
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
        </StatGroup>

        <StatGroup id="execution" title="Execution and activity" count={8}>
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
            label="Trading days"
            value={String(tradingDays)}
            title="Days a position was OPENED. Money is dated by close; activity by open."
          />
          <Stat
            label="Logged days"
            value={String(loggedDays)}
            title="Days with a journal entry — including days you deliberately did not trade."
          />
        </StatGroup>
      </div>

      {/* The verdict, beside the shape that produced it. The Sickre Score used
          to sit six sections down, below every raw money tile — the one figure
          that weighs result AND process together, ranked under `Total swap`. */}
      <div className="grid gap-4 [&>*]:min-w-0 lg:grid-cols-2">
        <ChartShell
          title={`Equity curve (${mode}, ${equityMetric === "money" ? currency : "R"})`}
          action={
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
          }
        >
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={equity} margin={{ left: 4, right: 8, top: 8 }}>
              <defs>
                <linearGradient id="eq" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis dataKey="i" {...AXIS_PROPS} />
              <YAxis {...AXIS_PROPS} width={56} />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
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
        </ChartShell>
        <SickreScoreCard score={sickreScore} />
      </div>

      {/* What the app has to say, before the reader digs for it themselves. */}
      <InsightsPanel result={insightResult} />

      {/* Process, high — not at the foot of the page. README: "P&L je posledica,
          proces je uzrok." A discipline streak buried under nine sections of
          money is the layout arguing the opposite of the thesis. */}
      <TrackerStreakCard
        series={trackerSeries}
        endDay={todayKey}
        hasRules={trackerRules.length > 0}
      />

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
          label="Weekly performance"
          currency={currency}
        />
      </div>

      <div className="grid gap-4 [&>*]:min-w-0 lg:grid-cols-2">
        <PeriodPerformanceCard
          summary={monthly}
          label="Monthly performance"
          currency={currency}
        />
        <ChartShell title="R-multiple distribution">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={hist} margin={{ left: 4, right: 8, top: 8 }}>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis dataKey="bucket" {...AXIS_PROPS} tick={{ fontSize: 10 }} />
              <YAxis allowDecimals={false} {...AXIS_PROPS} width={28} />
              <ReferenceLine x="-1..0" stroke="var(--border)" />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
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
        </ChartShell>
      </div>

      {/* The underwater curve beside the calendar of days that dug it.

          `min-w-0` on the items is load-bearing, not tidiness: grid tracks
          default to `min-width:auto`, and the heatmap's intrinsic width would
          otherwise push its card straight past the viewport edge. */}
      <div className="grid gap-4 [&>*]:min-w-0 lg:grid-cols-2">
        <DrawdownChart series={ddSeries} stats={drawdown} currency={currency} />
        <ChartShell
          title={`Daily P/L (${mode})`}
          subtitle="Last 26 weeks — green = profit, red = loss (account days)."
        >
          <CalendarHeatmap
            daily={daily}
            endDay={todayKey}
            currency={currency}
          />
        </ChartShell>
      </div>

      {/* Execution quality. Both charts are conditional and both draw on the
          same well of closed trades, so they share a row: they were two
          full-width bands stacked one under the other, which is most of the
          reason the page ran as long as it did. */}
      {(weeklySlip.length > 0 || weeklyExitEff.length > 0) && (
        <div className="grid gap-4 [&>*]:min-w-0 lg:grid-cols-2">
          {weeklySlip.length > 0 && (
            <ChartShell
              title="Entry slippage by week"
              subtitle="Planned entry vs avg fill, in R (vs planned stop). Includes spread when planned was mid and fill was ask/bid."
            >
              <ResponsiveContainer width="100%" height={220}>
                <BarChart
                  data={weeklySlip.map((w) => ({
                    week: w.week.slice(5),
                    avgDisplayR: -w.avgSlipR,
                    tradeCount: w.tradeCount,
                  }))}
                  margin={{ left: 4, right: 8, top: 8 }}
                >
                  <CartesianGrid {...GRID_PROPS} />
                  <XAxis dataKey="week" {...AXIS_PROPS} tick={{ fontSize: 10 }} />
                  <YAxis
                    {...AXIS_PROPS}
                    width={40}
                    tickFormatter={(v) => `${Number(v).toFixed(2)}R`}
                  />
                  <ReferenceLine y={0} stroke="var(--border)" />
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
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
            </ChartShell>
          )}

          {weeklyExitEff.length > 0 && (
            <ChartShell
              title="Target attainment by week"
              subtitle="Realized R vs planned target R. Not the same as Capture % (realized / MFE)."
            >
              <ResponsiveContainer width="100%" height={220}>
                <BarChart
                  data={weeklyExitEff.map((w) => ({
                    week: w.week.slice(5),
                    avgPct: w.avgPct,
                    tradeCount: w.tradeCount,
                  }))}
                  margin={{ left: 4, right: 8, top: 8 }}
                >
                  <CartesianGrid {...GRID_PROPS} />
                  <XAxis dataKey="week" {...AXIS_PROPS} tick={{ fontSize: 10 }} />
                  <YAxis
                    {...AXIS_PROPS}
                    width={44}
                    tickFormatter={(v) => `${Number(v).toFixed(0)}%`}
                  />
                  <ReferenceLine y={50} stroke="var(--border)" strokeDasharray="4 4" />
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
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
            </ChartShell>
          )}
        </div>
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
              {breakdownOptions.map((f) => (
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

/**
 * A KPI tile.
 *
 * THE DOM SHAPE BELOW IS LOAD-BEARING. `dashboard.render.test.tsx` and
 * `dashboard.controls.render.test.tsx` read a tile's value by finding the label
 * text, walking up to the element carrying `data-slot="card-content"`, and
 * taking `children[1]` — shadcn's own attribute, so the tests need no test ids
 * in production code. That makes exactly two things a contract:
 *
 *   1. `<CardContent>` has EXACTLY two direct children, and
 *   2. the label is the first, the value the second.
 *
 * Wrapping either in a div, or slipping a badge or an icon between them, moves
 * the value off `children[1]` and silently breaks nine assertions that exist to
 * prove the numbers on screen are the numbers the book computes. `size` is
 * therefore a CLASS switch and nothing more — it must never add an element.
 */
function Stat({
  label,
  value,
  cls,
  title,
  size = "default",
}: {
  label: string;
  value: string;
  cls?: string;
  title?: string;
  /** "hero" is the headline row: same markup, larger type. */
  size?: "default" | "hero";
}) {
  const hero = size === "hero";
  return (
    <Card title={title} className={hero ? "border-border/80 shadow-none" : ""}>
      <CardContent className={hero ? "p-4" : "p-3"}>
        <div className="text-xs text-muted-foreground">{label}</div>
        <div
          className={`mt-1 font-semibold tabular-nums ${
            hero ? "text-2xl" : "text-lg"
          } ${cls ?? ""}`}
        >
          {value}
        </div>
      </CardContent>
    </Card>
  );
}
