"use client";

import {
  useCallback,
  useMemo,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import Link from "next/link";
import { AlertTriangle, Download } from "lucide-react";
import dynamic from "next/dynamic";
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
import { ChartShell } from "@/components/journal/chart-shell";
import { StatGroup } from "@/components/journal/stat-group";
import { CalendarHeatmap } from "@/components/journal/calendar-heatmap";
import { TrackerStreakCard } from "@/components/journal/tracker-streak-card";
import { bookEquityLadder } from "@/lib/journal/tracker/equity-ladder";

/**
 * Every recharts plot on this page, behind a lazy boundary.
 *
 * recharts is ~840 KB in the production build and this component IS the `/`
 * route, so importing it directly put the whole library in the first bundle
 * every visitor parses — even one who has switched all the chart widgets off.
 *
 * `ssr: false` because these draw into a measured container: rendering them on
 * the server produces markup for a box whose size is not known yet, which the
 * client then throws away. The card, its title and its height come from
 * `ChartShell`, which is NOT lazy — so the layout is correct and stable while
 * the plot inside is still arriving, and nothing below it jumps.
 */
/** What `insightResult` answers while its panel is switched off. */
const EMPTY_INSIGHTS = { insights: [], skipped: [] };

const chartLoading = () => (
  <div className="h-full w-full animate-pulse rounded-md bg-muted/40" />
);

const DrawdownChart = dynamic(
  () => import("@/components/journal/drawdown-chart").then((m) => m.DrawdownChart),
  { ssr: false, loading: chartLoading },
);
const SickreScoreCard = dynamic(
  () =>
    import("@/components/journal/sickre-score-card").then(
      (m) => m.SickreScoreCard,
    ),
  { ssr: false, loading: chartLoading },
);
const EquityChart = dynamic(
  () => import("@/components/journal/dashboard-charts").then((m) => m.EquityChart),
  { ssr: false, loading: chartLoading },
);
const RDistributionChart = dynamic(
  () =>
    import("@/components/journal/dashboard-charts").then(
      (m) => m.RDistributionChart,
    ),
  { ssr: false, loading: chartLoading },
);
const SlippageChart = dynamic(
  () => import("@/components/journal/dashboard-charts").then((m) => m.SlippageChart),
  { ssr: false, loading: chartLoading },
);
const ExitEfficiencyChart = dynamic(
  () =>
    import("@/components/journal/dashboard-charts").then(
      (m) => m.ExitEfficiencyChart,
    ),
  { ssr: false, loading: chartLoading },
);
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
  TRACKER_SPAN_DAYS,
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
  currentEquity,
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
import {
  DonutRing,
  PROFIT_FACTOR_FULL,
  SemiGauge,
  Sparkline,
  SplitBar,
} from "@/components/journal/viz/tile-visuals";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { WidgetPicker } from "@/components/journal/widget-picker";
import {
  moveWidget,
  packRows,
  resolveOrder,
  toggleWidget,
  visibleWidgets,
  type WidgetSpan,
} from "@/lib/journal/dashboard-widgets";
import {
  createDashboardTemplate,
  deleteDashboardTemplate,
  renameDashboardTemplate,
  selectDashboardTemplate,
  setDashboardHiddenWidgets,
  setDashboardWidgetOrder,
  updateDashboardTemplateWidgets,
} from "@/app/(app)/actions";
import { TemplateMenu } from "@/components/journal/template-menu";
import {
  layoutToWidgets,
  templateMatchesLayout,
  widgetsToLayout,
  type DashboardTemplate,
} from "@/lib/journal/dashboard-templates";
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
  weeklySlippageR,
  weeklyExitEfficiency,
  type PnlMode,
} from "@/lib/journal/analytics";
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
import {
  fmtMoney,
  fmtR,
  fmtPct,
  fmtNum,
  pnlClass,
  sharedCurrency,
} from "@/lib/journal/format";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  canRender,
  formatMetric,
  metric as mkMetric,
  VIEW_MODES,
  type MetricContext,
  type ViewMode,
} from "@/lib/journal/units";
import { toEpoch, zonedDateKey } from "@/lib/journal/time";
import {
  computeDailyDrawdown,
  type DayPnlPoint,
} from "@/lib/journal/risk-ratios";

/**
 * How many of the four columns a widget takes.
 *
 * Literal classes rather than a template string: Tailwind's compiler scans
 * source text, so `col-span-${n}` compiles to nothing and every widget silently
 * collapses to one column. Each of these has to be written out to exist in the
 * stylesheet at all.
 */
const SPAN_CLASS: Record<WidgetSpan, string> = {
  1: "",
  2: "md:col-span-2 xl:col-span-2",
  4: "md:col-span-2 xl:col-span-4",
};

/**
 * A money tile, aware of the view-mode switcher — but the "dollars" case
 * still goes through `fmtMoney(..., { sign: true })` exactly as before,
 * because that leading "+" on a positive Net P/L is existing, tested
 * behavior this component already promised (`dashboard.render.test.tsx`).
 * `formatMetric`'s own money fallback deliberately omits the sign (see its
 * comment in `units.ts` — one value, one spelling, across every mode that
 * falls back to it), so reproducing "+" there would have re-introduced the
 * exact drift that rule exists to prevent. Every OTHER mode — %, Privacy, R,
 * Points, Ticks, Pips — is new surface with no prior contract, so those go
 * through `formatMetric` unchanged.
 */
function dashboardMoney(
  value: number | null | undefined,
  ctx: MetricContext,
  mode: ViewMode,
): string {
  return mode === "dollars"
    ? fmtMoney(value, ctx.currency, { sign: true })
    : formatMetric(mkMetric(value, "money", ctx), mode);
}

/**
 * The page below the headline, rendered FROM A LIST rather than written out.
 *
 * This is what makes the section order a preference instead of a fact about the
 * source file. The nodes arrive keyed by widget id; the reader's stored order
 * decides the sequence, `packRows` decides where the rows break, and a widget
 * with nothing to draw — a section switched off, or one whose data is absent
 * like the execution charts — is dropped before packing so it cannot leave a
 * gap behind.
 *
 * `false` as well as `null` counts as nothing, because that is what a
 * `show("x") && <Widget/>` expression evaluates to when the answer is no.
 */
function renderRows(
  nodes: Record<string, ReactNode>,
  order: readonly string[],
) {
  const present = resolveOrder(order).filter((w) => {
    const node = nodes[w.id];
    return node != null && node !== false;
  });

  return packRows(present).map((row) => (
    <div
      // Keyed by the row's first widget rather than by index: an index key
      // makes React reuse a chart's DOM for whatever lands in that slot after a
      // reorder, and recharts does not survive having its data swapped under it.
      key={row[0].id}
      className="grid gap-4 [&>*]:min-w-0 md:grid-cols-2 xl:grid-cols-4"
    >
      {row.map((w) => (
        <div key={w.id} className={SPAN_CLASS[w.span]}>
          {nodes[w.id]}
        </div>
      ))}
    </div>
  ));
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
  dashboardHiddenWidgets = [],
  dashboardWidgetOrder = [],
  dashboardTemplateId = null,
  dashboardTemplates = [],
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
  /**
   * Dashboard sections this user has switched off, from `tj_user_prefs`.
   *
   * Optional, defaulting to none hidden. Both dashboard render tests mount this
   * component without it, and every assertion they make depends on the default
   * meaning "show everything" — see the note beside the state below.
   */
  dashboardHiddenWidgets?: string[];
  /**
   * Section order from `tj_user_prefs`. Empty means the registry order, which
   * is the layout this page had before any of it was configurable.
   */
  dashboardWidgetOrder?: string[];
  /** Which saved arrangement the live layout came from. Provenance, not rule. */
  dashboardTemplateId?: string | null;
  dashboardTemplates?: DashboardTemplate[];
}) {
  /*
   * NO `useRouter` HERE, and the reason is worth stating because reaching for
   * one is the obvious move. Template writes change data the SERVER renders —
   * the list of saved layouts and which is selected — so a manual
   * `router.refresh()` looks necessary. It is not: a Server Action calling
   * `revalidatePath` returns the updated RSC payload with its own response, and
   * React applies it. The refresh would be a second round trip for a payload
   * already in hand.
   *
   * It also cannot be had. `useRouter` throws "invariant expected app router to
   * be mounted" outside a Next runtime, and both dashboard test files render
   * this component directly — seventeen assertions died on that import before
   * this comment existed.
   */

  /**
   * Sections switched off in the picker.
   *
   * SERVER-SIDE NOW, arriving as a prop rather than read from `localStorage` in
   * an effect. The browser store held this for one commit and was always the
   * wrong home: it is per BROWSER, which is the exact complaint
   * `20260801150000_user_prefs.sql` exists to answer. Open the dashboard on a
   * phone and a layout configured on the desktop was simply gone.
   *
   * The prop is OPTIONAL and defaults to empty, which keeps the invariant the
   * effect version was built around: `dashboard.render.test.tsx` renders this
   * component with no preferences at all, and every one of its assertions
   * depends on that meaning "show everything". A default that hid anything
   * would make eleven tile lookups return "" and read as arithmetic bugs.
   */
  const [hiddenWidgets, setHiddenWidgets] = useState<string[]>(
    dashboardHiddenWidgets,
  );

  /** Section order, same shape and same default reasoning as the hidden set. */
  const [widgetOrder, setWidgetOrder] = useState<string[]>(
    dashboardWidgetOrder,
  );

  /**
   * Which saved arrangement the live layout came from.
   *
   * Provenance only — the two arrays above are what renders. Touching the
   * picker leaves this alone, which is exactly how the layout comes to differ
   * from the template and how `modified` below notices.
   */
  const [templateId, setTemplateId] = useState<string | null>(
    dashboardTemplateId,
  );

  const selectedTemplate = useMemo(
    () => dashboardTemplates.find((t) => t.id === templateId) ?? null,
    [dashboardTemplates, templateId],
  );

  const templateModified = useMemo(
    () =>
      selectedTemplate != null &&
      !templateMatchesLayout(selectedTemplate, hiddenWidgets, widgetOrder),
    [selectedTemplate, hiddenWidgets, widgetOrder],
  );

  /** One place that reports a failed write, so none of the five forgets to. */
  const report = useCallback((res: { ok: boolean; error?: string }) => {
    if (!res.ok) toast.error(res.error ?? "Could not save.");
    return res.ok;
  }, []);

  const applyLayout = useCallback(
    (id: string | null, hidden: string[], order: string[]) => {
      const prev = { id: templateId, hidden: hiddenWidgets, order: widgetOrder };
      setTemplateId(id);
      setHiddenWidgets(hidden);
      setWidgetOrder(order);
      void selectDashboardTemplate(id, hidden, order).then((res) => {
        if (!res.ok) {
          setTemplateId(prev.id);
          setHiddenWidgets(prev.hidden);
          setWidgetOrder(prev.order);
          toast.error(res.error);
        }
      });
    },
    [templateId, hiddenWidgets, widgetOrder],
  );

  const onSelectTemplate = useCallback(
    (id: string | null) => {
      if (id == null) {
        // Detach without touching the page: the arrangement on screen is the
        // one the reader is looking at, and dropping its name should not also
        // rearrange it.
        applyLayout(null, hiddenWidgets, widgetOrder);
        return;
      }
      const t = dashboardTemplates.find((x) => x.id === id);
      if (!t) return;
      const next = widgetsToLayout(t.widgets);
      applyLayout(id, next.hidden, next.order);
    },
    [applyLayout, dashboardTemplates, hiddenWidgets, widgetOrder],
  );

  const onCreateTemplate = useCallback(
    (name: string) => {
      void createDashboardTemplate(
        name,
        layoutToWidgets(hiddenWidgets, widgetOrder),
      ).then((res) => {
        // The new row's id is assigned by the database, so the selection it
        // sets server-side only reaches this component on the next render.
        report(res);
      });
    },
    [hiddenWidgets, widgetOrder, report],
  );

  const onSaveTemplate = useCallback(() => {
    if (!selectedTemplate) return;
    void updateDashboardTemplateWidgets(
      selectedTemplate.id,
      layoutToWidgets(hiddenWidgets, widgetOrder),
    ).then((res) => {
      report(res);
    });
  }, [selectedTemplate, hiddenWidgets, widgetOrder, report]);

  const onRevertTemplate = useCallback(() => {
    if (!selectedTemplate) return;
    const next = widgetsToLayout(selectedTemplate.widgets);
    applyLayout(selectedTemplate.id, next.hidden, next.order);
  }, [selectedTemplate, applyLayout]);

  const onRenameTemplate = useCallback(
    (id: string, name: string) => {
      void renameDashboardTemplate(id, name).then((res) => {
        report(res);
      });
    },
    [report],
  );

  const onDeleteTemplate = useCallback(
    (id: string) => {
      void deleteDashboardTemplate(id).then((res) => {
        if (!report(res)) return;
        // The foreign key is ON DELETE SET NULL, so the page keeps the layout
        // and loses only its name. Said out loud, because a name silently
        // vanishing from the toolbar reads as a bug.
        setTemplateId(null);
        toast.success("Layout deleted. The sections on screen are unchanged.");
      });
    },
    [report],
  );

  const moveWidgetPosition = useCallback((id: string, direction: -1 | 1) => {
    setWidgetOrder((current) => {
      const next = moveWidget(current, id, direction);
      void setDashboardWidgetOrder(next).then((res) => {
        if (!res.ok) {
          setWidgetOrder(current);
          toast.error(res.error);
        }
      });
      return next;
    });
  }, []);

  const toggleWidgetVisibility = useCallback((id: string) => {
    setHiddenWidgets((current) => {
      const next = toggleWidget(current, id);
      // Optimistic, with the previous value captured for the rollback — the
      // same shape `journal-grid.tsx` uses for its columns. A picker that waits
      // for a round trip before the section disappears feels broken on a slow
      // connection, and a picker that never rolls back lies when the write
      // fails.
      void setDashboardHiddenWidgets(next).then((res) => {
        if (!res.ok) {
          setHiddenWidgets(current);
          toast.error(res.error);
        }
      });
      return next;
    });
  }, []);

  /**
   * Render gate — and, for five memos below, a compute gate too.
   *
   * A hook cannot be called conditionally, so nothing here skips `useMemo`.
   * What the gated ones skip is the WORK INSIDE it, returning an empty value
   * when their widget is switched off.
   *
   * Only memos read by exactly ONE hideable widget qualify, and each is
   * verified as such: `insightResult`, `hist`, `ddSeries`, `weeklySlip`,
   * `weeklyExitEff`. `trackerSeries` and `processAdherencePct` look like
   * candidates and are NOT gated — both feed the Sickre score, and returning a
   * placeholder for them would not hide a number, it would silently change one.
   * That is the line: gating may cost a widget its content, never a figure its
   * meaning.
   */
  const visible = useMemo(() => visibleWidgets(hiddenWidgets), [hiddenWidgets]);
  const show = useCallback((id: string) => visible.has(id), [visible]);

  const [accountFilter, setAccountFilter] = useState("all");
  const [period, setPeriod] = useState("90");
  const [mode, setMode] = useState<PnlMode>("net");

  /**
   * The three controls that invalidate almost everything.
   *
   * Flipping net/gross re-runs roughly seventeen memos, each a full pass over
   * the book; period and account filter are comparable. Done synchronously the
   * browser cannot paint until all of them finish, so the button appears not to
   * respond to the click that started the work.
   *
   * `startTransition` marks the recompute as interruptible: the pressed state
   * lands immediately, the figures follow, and `recomputing` dims them in
   * between so the reader can tell a stale number from a settled one.
   */
  const [recomputing, startRecompute] = useTransition();
  const setModeDeferred = useCallback(
    (next: PnlMode) => startRecompute(() => setMode(next)),
    [],
  );
  const setPeriodDeferred = useCallback(
    (next: string) => startRecompute(() => setPeriod(next)),
    [],
  );
  const setAccountFilterDeferred = useCallback(
    (next: string) => startRecompute(() => setAccountFilter(next)),
    [],
  );
  // Dollars/%/Privacy/R/Ticks/Pips/Points — the same switcher `/reports`
  // already built (`units.ts`). A plain `useState` like every other control on
  // this bar (`period`, `accountFilter`, `mode`), not URL-synced: nothing else
  // here is either.
  const [viewMode, setViewMode] = useState<ViewMode>("dollars");
  // The equity chart's old standalone $/R toggle is now just this switcher
  // read narrowly — "r" picks the R-denominated series, anything else the
  // money one. `buildEquity` still only knows those two, so the derived value
  // keeps its original type instead of threading all seven modes into it.
  const equityMetric: "money" | "r" = viewMode === "r" ? "r" : "money";
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
   * Timezone per account, on the same fallback chain the routes use.
   *
   * This used to hold `?? "America/New_York"` with no fallback to the PRIMARY
   * account, while `/calendar` and `/playbooks` fell back to
   * `primary?.timezone`. For a trade with no `account_id` — and one is created
   * whenever an account is deleted, because the foreign key is
   * `ON DELETE SET NULL` — the Dashboard would date it on a New York day and
   * the calendar in the primary account's zone. On an account in
   * `Europe/Berlin` that is the same trade in two different calendar columns.
   *
   * The primary is "first active, else first" — the same rule
   * `getPrimaryAccount` applies on the server.
   */
  const tzForAccount = useMemo(() => {
    const primary = accounts.find((a) => a.is_active) ?? accounts[0];
    return accountTimezoneResolver(accounts, primary?.timezone);
  }, [accounts]);

  const tzOf = useCallback(
    (t: { row: TradeRow }) => tzForAccount(t.row.account_id),
    [tzForAccount],
  );

  /**
   * "All accounts" pooling raw money across DIFFERENT currencies — €500 and
   * $300 summed as "$800" — was silently wrong here and in `reports-workbench.tsx`
   * before this guard existed: unreachable with one account, live the moment a
   * second one in another currency exists. There is no safe number to show
   * instead (unlike `sharedBreakevenRange`, which falls back to a conservative
   * exact-zero band — money has no neutral fallback), so the page refuses to
   * compute one at all. See the render gate near the bottom of this component,
   * which replaces the entire money-dependent body with an explanation rather
   * than risk missing one of the many tiles that touch `currency`/`startBalance`.
   */
  const mixedCurrency =
    accountFilter === "all" &&
    accounts.length > 1 &&
    sharedCurrency(accounts) == null;

  const currency = useMemo(() => {
    if (accountFilter !== "all")
      return accounts.find((a) => a.id === accountFilter)?.currency ?? "USD";
    return sharedCurrency(accounts) ?? "USD";
  }, [accountFilter, accounts]);

  const startBalance = useMemo(() => {
    if (accountFilter !== "all")
      return accounts.find((a) => a.id === accountFilter)?.starting_balance ?? 0;
    // Mixed currencies: 0 rather than a cross-currency sum. Harmless either
    // way once `mixedCurrency` is true — the render gate never shows a tile
    // that would read this — but 0 is the honest "nothing safe to add" value
    // if anything downstream ever reads it before that gate does.
    if (mixedCurrency) return 0;
    return accounts.reduce((s, a) => s + (a.starting_balance ?? 0), 0);
  }, [accountFilter, accounts, mixedCurrency]);

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
    // The same expression four routes use — the only difference is WHAT gets
      // passed in: the Dashboard filters by the selected account, the routes take
      // all of them. That difference is deliberate and stays; what was removed is
      // five copies of the rule itself, "a band applies only if every account
      // agrees".
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
   * Denominator for Percentage view mode — current equity, not starting
   * balance. Built through `buildBalanceTimeline`/`currentEquity` exactly like
   * `/reports` does (`reports-workbench.tsx`), so the two screens cannot
   * report a different percentage for the same account.
   *
   * `realizedAll`, not `realized`: equity is what the account holds TODAY,
   * scoped by account but never by the period filter — the same reasoning
   * `/reports` documents for its own `equityBase`. Net P&L, not gross: fees
   * and swap are real cash effects on the balance a percentage is measured
   * against, gross P&L is not.
   */
  const equityBase = useMemo(() => {
    // `startBalance` is already 0 when mixed, but `realizedAll` here still
    // pools every account's `net` regardless — summing it into a running
    // total would still cross currencies even with a currency-safe seed.
    if (mixedCurrency) return null;
    const base = currentEquity(
      buildBalanceTimeline(
        startBalance,
        realizedAll.map((t) => ({ at: t.closedAt ?? "", pnl: t.net })),
        scopedCashEvents,
      ),
    );
    return base > 0 ? base : null;
  }, [startBalance, realizedAll, scopedCashEvents, mixedCurrency]);

  const metricCtx: MetricContext = useMemo(
    () => ({ currency, equityBase }),
    [currency, equityBase],
  );

  /**
   * Which view modes are even meaningful right now, so the switcher can grey
   * out the ones that are not — R/Points/Ticks/Pips need a single instrument
   * or a single planned risk, neither of which a portfolio-wide dashboard
   * tile has. Probed with a representative money value, the same idiom
   * `reports-workbench.tsx` uses for its own switcher.
   */
  const viewModeRenderable = useMemo(() => {
    const probe = mkMetric(1, "money", metricCtx);
    return Object.fromEntries(
      VIEW_MODES.map((m) => [m.value, canRender(probe, m.value)]),
    ) as Record<ViewMode, boolean>;
  }, [metricCtx]);

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
    () => (show("drawdown") ? drawdownSeries(balanceTimeline) : []),
    [show, balanceTimeline],
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
   * Closed trades that NO number on this page includes.
   *
   * `toRealized` discards every row without a `net_pl`, and that is right — a
   * trade that cannot be valued must not enter a total as a zero. But a
   * discarded row also vanishes from the trade count, from the net result and
   * from every metric below. The Dashboard used to say nothing about it, so a
   * book of ten trades with three unvalued read "7" without a word.
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
  const dailyDd = useMemo(() => computeDailyDrawdown(dayPoints), [dayPoints]);

  // Built once and shared: the insight rules need it for the derived setup
  // grade, and the process-adherence score needs it for the follow rate. Two
  // constructions would be two chances for them to disagree about which rules
  // exist.
  const playbookLookup = useMemo(
    () => buildPlaybookLookup(playbooks, positionRules),
    [playbooks, positionRules],
  );

  const insightResult = useMemo(
    () =>
      !show("insights")
        ? EMPTY_INSIGHTS
        : runInsights(
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
          rules: playbookLookup.rules,
        }),
      ),
    [
      show,
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
      playbookLookup.rules,
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
    // Scoped to the same accounts and cash the rest of this panel is scoped to,
    // so a filtered dashboard judges the limits against the filtered book.
    const equityOf = bookEquityLadder(
      index,
      accountFilter === "all"
        ? accounts
        : accounts.filter((a) => a.id === accountFilter),
      scopedCashEvents,
      tzForAccount,
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
        evaluateAutoRulesForDay(
          d,
          index,
          configsFromRules(rulesLiveOn(trackerRules, d)),
          equityOf,
        ),
        byDate.get(d) ?? new Map(),
      ),
    todayKey);
  }, [
    trackerRules,
    checkins,
    trades,
    accounts,
    scopedCashEvents,
    accountFilter,
    tzForAccount,
    todayKey,
  ]);

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

    const followRatePct = computeFollowRate(
      enrichTrades(realized, { tzOf, range: breakevenRange, pnlOf, fillCounts }),
      playbookLookup.rules,
    );

    return processAdherence({ trackerPct, followRatePct });
  }, [
    trackerSeries,
    period,
    todayKey,
    playbookLookup.rules,
    realized,
    tzOf,
    breakevenRange,
    pnlOf,
    fillCounts,
  ]);

  /**
   * Worst prop-firm headroom across the accounts running a challenge.
   *
   * MINIMUM, NOT AVERAGE. The constraint that ends a challenge is whichever
   * account came nearest to its own floor, and averaging two accounts lets a
   * comfortable one paper over the one that sat a fraction of a percent from
   * the end. `null` — the component drops and the rest renormalize — when no
   * account has FTMO mode on, or when every challenge window is still empty.
   *
   * DELIBERATELY OUTSIDE THE PERIOD FILTER, unlike every other component fed
   * to the score, including `processAdherencePct` directly above, which is
   * windowed precisely so the score does not mix timeframes. The exception is
   * not an oversight: a challenge window is defined by its own `ftmo_reset_at`
   * and a fixed starting balance, and 4.5 % of a 5 % floor does not stop having
   * been touched because the reader switched the view to the last 30 days.
   * Recomputing it over the dashboard period would produce a number no prop
   * firm would recognise.
   */
  const ftmoHeadroomPct = useMemo(() => {
    const rooms = ftmoStatuses
      .map(({ result }) => result.headroomPct)
      .filter((h): h is number => h != null);
    return rooms.length === 0 ? null : Math.min(...rooms);
  }, [ftmoStatuses]);

  const sickreScore = useMemo(
    () =>
      computeSickreScore({
        profitFactor: stats.profitFactor,
        avgWinLossRatio: winLossRatio,
        // Peak-P&L base, not the equity percentage shown in the KPI row — the
        // two have different denominators and only this one matches how
        // TradeZella computes it, which is what keeps the score comparable.
        maxDrawdownPctOfPeakPnl: drawdown.maxPctOfPeakPnl,
        recoveryFactor: recovery,
        consistencyScore: consistency.score,
        processAdherencePct,
        ftmoHeadroomPct,
        // Drawdown and consistency both answer 0 for an empty book, and a 0
        // drawdown scores 100. The counts let the score tell "no evidence"
        // from "measured zero" and drop the component instead.
        sample: { trades: stats.count, decided: stats.wins + stats.losses },
      }),
    [
      stats.profitFactor,
      stats.count,
      stats.wins,
      stats.losses,
      winLossRatio,
      drawdown.maxPctOfPeakPnl,
      recovery,
      consistency.score,
      processAdherencePct,
      ftmoHeadroomPct,
    ],
  );
  const equity = useMemo(
    () => buildEquity(realized, mode, equityMetric, windowed.openingEquity),
    [realized, mode, equityMetric, windowed],
  );

  /**
   * Cumulative money behind the Net P/L tile's sparkline.
   *
   * Deliberately not `equity` above, which follows the chart's $/R toggle: a
   * line drawn in R under a number denominated in money would be two different
   * quantities sharing one tile, and the line is the half a reader takes in
   * first. Reuses `equity` whenever the toggle already says money, so the
   * common case costs nothing.
   */
  const netSeries = useMemo(
    () =>
      equityMetric === "money"
        ? equity
        : buildEquity(realized, mode, "money", windowed.openingEquity),
    [equity, equityMetric, realized, mode, windowed],
  );
  const hist = useMemo(
    () => (show("r-distribution") ? rHistogram(realized) : []),
    [show, realized],
  );
  const daily = useMemo(
    () => dailyPnl(realized, mode, tzOf),
    [realized, mode, tzOf],
  );
  const breakdown = useMemo(
    () => breakdownByField(realized, breakdownField, breakevenRange),
    [realized, breakdownField, breakevenRange],
  );
  const weeklySlip = useMemo(
    () => (show("execution-quality") ? weeklySlippageR(realized, tzOf) : []),
    [show, realized, tzOf],
  );
  const weeklyExitEff = useMemo(
    () => (show("execution-quality") ? weeklyExitEfficiency(realized, tzOf) : []),
    [show, realized, tzOf],
  );

  function handleExportMentorPack() {
    // The trigger button is disabled in this state too — this is the same
    // belt-and-suspenders the rest of the mixed-currency handling uses
    // (`mixedCurrency`'s own comment above): `currency` falls back to "USD"
    // here, and without this guard the pack would silently sum trades from
    // accounts in different currencies under that one fake label.
    if (mixedCurrency) return;
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
        rules: playbookLookup.rules,
      }),
    );

    const md = buildMentorPack(scoped, {
      rules: playbookLookup.rules,
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
          <Select value={accountFilter} onValueChange={setAccountFilterDeferred}>
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
              onClick={() => setPeriodDeferred(p.value)}
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
              onClick={() => setModeDeferred(m)}
            >
              {m}
            </Button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">
          {mode === "net" ? "Net = after fees & swap" : "Gross = price move only"}
        </span>

        {/* Dollars/%/Privacy/R/Ticks/Pips/Points — reuses `/reports`' own
            switcher (`units.ts`) rather than a second design for the same
            idea. Disabled rather than hidden when a mode has nothing to show
            (R/Points/Ticks/Pips on a multi-instrument portfolio view), so the
            reader sees the mode exists without it silently doing nothing. */}
        <div className="flex rounded-md border p-0.5">
          {VIEW_MODES.map((vm) => (
            <Button
              key={vm.value}
              variant={viewMode === vm.value ? "secondary" : "ghost"}
              size="sm"
              className="h-7"
              disabled={!viewModeRenderable[vm.value]}
              title={vm.note}
              onClick={() => setViewMode(vm.value)}
            >
              {vm.label}
            </Button>
          ))}
        </div>

        {/* The export pickers used to sit here, inline: a granularity select,
            up to two date inputs or a quarter+year pair, a button, and a range
            preview line under the whole bar. Six controls that describe a
            DIFFERENT period than the one this bar sets — and, sitting among the
            filters, read as though they narrowed the page. They are one popover
            now; the trigger says what they are for, and the range preview lives
            next to the pickers that produce it instead of under the filters. */}
        {/* Next to the export popover rather than among the filters, because
            it is the same kind of control: it changes what you get, not which
            trades are counted. */}
        <div className="flex items-center gap-2 sm:ml-auto">
          <TemplateMenu
            templates={dashboardTemplates}
            selectedId={templateId}
            modified={templateModified}
            onSelect={onSelectTemplate}
            onCreate={onCreateTemplate}
            onSave={onSaveTemplate}
            onRevert={onRevertTemplate}
            onRename={onRenameTemplate}
            onDelete={onDeleteTemplate}
          />
          <WidgetPicker
            hidden={hiddenWidgets}
            order={widgetOrder}
            onToggle={toggleWidgetVisibility}
            onMove={moveWidgetPosition}
          />
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                disabled={mixedCurrency}
                title={
                  mixedCurrency
                    ? "Accounts in scope use different currencies — pick one account to export"
                    : "Download a Markdown pack for the selected period to upload into Claude for mentor feedback"
                }
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

      {mixedCurrency ? (
        /* No safe pooled number exists here — see `mixedCurrency`'s own
           comment above. Everything from "THE HEADLINE SIX" down to the
           final breakdown table reads `currency`/`startBalance`/`equityBase`
           somewhere, directly or through `metricCtx`/`stats`/`drawdown`, so
           replacing the whole body with an explanation is the only way to
           guarantee none of them silently shows a cross-currency sum —
           tile-by-tile gating would only be as safe as the least-audited tile. */
        <Alert variant="destructive">
          <AlertTitle>Accounts in scope use different currencies</AlertTitle>
          <AlertDescription>
            {accounts.map((a) => a.currency).filter((c, i, arr) => arr.indexOf(c) === i).join(", ")}{" "}
            — adding money across them would mean summing unlike units, so
            nothing on this page is shown while &quot;All accounts&quot; spans
            more than one currency. Pick a single account above to see the
            full dashboard again.
          </AlertDescription>
        </Alert>
      ) : (
      <>
      {/* THE HEADLINE SIX.
          Everything below used to sit in this one flat grid — thirty tiles at
          one size, no headings, so `Net P/L` and `Total swap` carried the same
          visual weight and the reader had to know the app to find the number
          they came for. These six are the ones a session actually opens on.

          `Trades` is up here as sample size, not as a metric: README's rule is
          "sample size travels with the number", and a win rate over four trades
          read without its denominator is exactly the kind of confident-wrong
          figure this project is built to refuse. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat
          size="hero"
          label="Net P/L"
          value={dashboardMoney(stats.netSum, metricCtx, viewMode)}
          cls={pnlClass(stats.netSum)}
          visual={
            <Sparkline
              values={netSeries.map((p) => p.value)}
              tone={
                stats.netSum < 0 ? "var(--loss)" : "var(--profit)"
              }
            />
          }
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
          // Same guard as the value: no decided trades means an empty arc, not
          // an arc sitting at zero. The two must never disagree.
          visual={
            <SemiGauge
              pct={stats.wins + stats.losses === 0 ? null : stats.winRate}
            />
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
          // `Infinity` closes the ring — the ∞ above is a maximum, not a gap.
          visual={
            <DonutRing value={stats.profitFactor} full={PROFIT_FACTOR_FULL} />
          }
        />
        {/* WHY THIS DIFFERS FROM `Avg R`.
            The same R, two denominators — and without this sentence it looks
            like an inconsistency on screen. Expectancy is weighted by the win
            rate over the DECIDED R population, so a breakeven trade drops out;
            `Avg R` is a plain mean over everything that has an R. On a book of
            20 trades with one breakeven that is 12.84/19 = 0.68 against
            12.84/20 = 0.64. */}
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
          // Percentage mode is special-cased to the EXISTING peak-relative figure
          // (the "Max drawdown %" tile below, `drawdown.maxPctOfEquity`) rather
          // than run through the generic money→% conversion every other tile
          // uses. The generic one divides by TODAY's equity — a number that
          // drifts as the account grows even though the drawdown event itself
          // is fixed in the past, and is not how drawdown percentage is
          // measured anywhere in trading practice. Peak-to-trough over the
          // peak IS that measure, and it is what the dedicated tile already
          // computes correctly; showing a second, different number under the
          // same "Max drawdown" name would read as a contradiction, not a
          // second fact.
          value={
            viewMode === "percentage" && drawdown.maxAt
              ? formatMetric(mkMetric(-drawdown.maxPctOfEquity, "pct"), viewMode)
              : dashboardMoney(stats.maxDrawdown, metricCtx, viewMode)
          }
          cls="text-[var(--loss)]"
          title="Worst peak-to-trough drop in cumulative P&L. Deposits and withdrawals are not losses, so they do not move this number. In Percentage mode this shows the SAME peak-relative share as the 'Max drawdown %' tile below, not a share of today's equity — a drawdown's severity does not shrink just because the account has grown since."
        />
      </div>

      {/* The rest, in ONE named block the reader can fold away.
          Three blocks once, then two, now one — each round of moving tiles to
          /reports left fewer behind, and a heading over two tiles costs more
          attention than the tiles pay back. Nothing is hidden by default; see
          `stat-group.tsx` for why "open" is an invariant here and not merely a
          default.

          `id` stays `result` even though the title no longer does. It keys the
          stored fold preference, and `stat-group.tsx` documents that renaming
          one re-opens that group — a reader who folded this block away should
          not find it open again because the heading above it was reworded. */}
      {/* Dimmed while a control's recompute is still in flight. The numbers on
          screen are the PREVIOUS filter's until it lands, and saying so is the
          difference between "still working" and "these are your figures". */}
      <div
        className={cn(
          "space-y-5 transition-opacity",
          recomputing && "pointer-events-none opacity-60",
        )}
        aria-busy={recomputing}
      >
      {renderRows(
        {
        "detail-tiles": show("detail-tiles") && (
        <StatGroup id="result" title="Result and risk — detail" count={12}>
          <Stat
            label="Gross P/L"
            value={dashboardMoney(stats.grossSum, metricCtx, viewMode)}
            cls={pnlClass(stats.grossSum)}
          />
          {/* The basis, said where the number is read. R does not follow the
              net/gross switch — that switch moves money only — and on a swing
              book held through carry the two can disagree on a single trade.
              Left undocumented, that reads as a bug rather than as the two
              separate questions it is. See README § Money and counting. */}
          <Stat
            label="Total R"
            value={fmtR(stats.totalR)}
            cls={pnlClass(stats.totalR)}
            title="Sum of R over every trade that has a stop. R is always GROSS — it measures the setup against the risk taken, and does not follow the net/gross switch, which moves money only. A trade held through carry can therefore be a loss in money and positive in R."
          />
          <Stat
            label="Avg R"
            value={fmtR(stats.avgR)}
            cls={pnlClass(stats.avgR)}
            title="Plain mean R over every trade that has one. Includes breakeven trades, which is why it can sit below Expectancy — that one weights by win rate over decided trades only."
          />
          <Stat label="Best" value={dashboardMoney(stats.best, metricCtx, viewMode)} cls={pnlClass(stats.best)} />
          <Stat label="Worst" value={dashboardMoney(stats.worst, metricCtx, viewMode)} cls={pnlClass(stats.worst)} />
          <Stat
            label="Streak W/L"
            value={`${stats.maxWinStreak} / ${stats.maxLossStreak}`}
          />
          <Stat
            label="Avg win/loss"
            value={winLossRatio != null ? fmtNum(winLossRatio, 2) : "—"}
            title="Average winning R divided by average losing R."
            // The one place on this page where green and red are literally an
            // average win and an average loss, so the money colours are right
            // rather than a collision. Draws nothing until both sides exist.
            visual={
              <SplitBar left={stats.avgWinMoney} right={stats.avgLossMoney} />
            }
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
          {/* THE TWO DRAWDOWN TILES CLOSE THIS GRID RATHER THAN OPENING THEIR
              OWN. They were a `StatGroup` of their own for one round, and a
              heading plus a rule plus a fold for two tiles is more furniture
              than content — it read as a leftover, which is exactly what it
              was after the other eleven moved to /reports. Here they fill the
              two empty cells the six-column grid was already leaving, and the
              block lands on twelve: two full rows, no gaps.

              They belong in "detail" on their own merit, not only to tidy the
              layout. Both expand a tile in the headline row above — `Max
              drawdown %` is the percentage companion of `Max drawdown`, the
              same relationship `Gross P/L` has to `Net P/L` at the start of
              this group. */}
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
            // No `equityBase` in the context passed here — on purpose.
            // Percentage mode's fallback in `formatMetric` is "no denominator,
            // show money", and there is no sound denominator for this one: a
            // daily loss limit (the FTMO-style rule this metric mirrors, per
            // its own doc comment in risk-ratios.ts) is measured against a
            // FIXED reference such as starting balance, never against
            // TODAY's fluctuating equity. Rather than invent and ship an
            // untested percentage basis, this tile opts out of the switcher
            // the same way Trades/Streak already do — Privacy still masks it,
            // since that check runs before the denominator is ever consulted.
            value={formatMetric(mkMetric(dailyDd.avgMoney, "money", { currency }), viewMode)}
            cls={dailyDd.avgMoney < 0 ? "text-[var(--loss)]" : undefined}
            title={
              dailyDd.worstDay
                ? `Average drop below the day's own high-water mark, across ${dailyDd.days} days with a trade. A day that never went underwater counts as 0. Worst: ${fmtMoney(dailyDd.worstMoney, currency)} on ${dailyDd.worstDay}.`
                : `Average drop below the day's own high-water mark, across ${dailyDd.days} days with a trade.`
            }
          />
        </StatGroup>
        ),

        /* The verdict, beside the shape that produced it — a DEFAULT
           adjacency now rather than a fixed one, since the reader can move
           either. The Sickre Score used to sit six sections down, below every
           raw money tile: the one figure that weighs result AND process
           together, ranked under `Total swap`. */
        equity: show("equity") && (
        <ChartShell
          // The $/R toggle that used to live here is the view-mode switcher
          // now — "R" mode picks the R-denominated series (see `equityMetric`
          // above), so the chart reads the shared control instead of keeping
          // its own narrower copy of the same idea.
          title={`Equity curve (${mode}, ${equityMetric === "money" ? currency : "R"})`}
        >
          <EquityChart data={equity} metric={equityMetric} currency={currency} />
        </ChartShell>
        ),
        score: show("score") && <SickreScoreCard score={sickreScore} />,

        /* What the app has to say, before the reader digs for it themselves. */
        insights: show("insights") && <InsightsPanel result={insightResult} />,

        /* Process, high by default — not at the foot of the page. README:
           "P&L is the consequence, process is the cause." A discipline streak
           buried under nine sections of money is the layout arguing the
           opposite. */
        tracker: show("tracker") && (
          <TrackerStreakCard
            series={trackerSeries}
            endDay={todayKey}
            hasRules={trackerRules.length > 0}
            tradingDays={tradingDays}
            loggedDays={loggedDays}
          />
        ),

        "hold-time": show("hold-time") && <HoldTimeCard stats={holdTime} />,
        costs: show("costs") && <CostReportCard costs={costs} currency={currency} />,
        "plan-vs-reality": show("plan-vs-reality") && (
          <PlanVsRealityCard
            plannedR={plannedR}
            excursion={excursion}
            direction={directionSplit}
          />
        ),
        weekly: show("weekly") && (
          <PeriodPerformanceCard
            summary={weekly}
            label="Weekly performance"
            currency={currency}
          />
        ),
        monthly: show("monthly") && (
          <PeriodPerformanceCard
            summary={monthly}
            label="Monthly performance"
            currency={currency}
          />
        ),
        "r-distribution": show("r-distribution") && (
        <ChartShell title="R-multiple distribution">
          <RDistributionChart data={hist} />
        </ChartShell>
        ),

        /* The underwater curve beside the calendar of days that dug it.

           `min-w-0` on the items is load-bearing, not tidiness: grid tracks
           default to `min-width:auto`, and the heatmap's intrinsic width would
           otherwise push its card straight past the viewport edge. It lives on
           the row container in `renderRows` now, so every row carries it. */
        drawdown: show("drawdown") && (
          <DrawdownChart series={ddSeries} stats={drawdown} currency={currency} />
        ),
        calendar: show("calendar") && (
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
        ),

        /* Execution quality. Both charts are conditional on having data of
           their own, ON TOP of the picker — a section switched on that has
           nothing to plot still shows nothing, and `renderRows` drops it before
           packing so it cannot leave a gap. */
        "execution-quality": show("execution-quality") &&
          (weeklySlip.length > 0 || weeklyExitEff.length > 0) && (
        <div className="grid gap-4 [&>*]:min-w-0 lg:grid-cols-2">
          {weeklySlip.length > 0 && (
            <ChartShell
              title="Entry slippage by week"
              subtitle="Planned entry vs avg fill, in R (vs planned stop). Includes spread when planned was mid and fill was ask/bid."
            >
              <SlippageChart weeks={weeklySlip} />
            </ChartShell>
          )}

          {weeklyExitEff.length > 0 && (
            <ChartShell
              title="Target attainment by week"
              subtitle="Realized R vs planned target R. Not the same as Capture % (realized / MFE)."
            >
              <ExitEfficiencyChart weeks={weeklyExitEff} />
            </ChartShell>
          )}
        </div>
        ),

        /* Breakdown by tag */
        "tag-breakdown": show("tag-breakdown") && (
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
                      {dashboardMoney(r.netSum, metricCtx, viewMode)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
        ),
        },
        widgetOrder,
      )}
      </div>
      </>
      )}
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
 *
 * `visual` is how a gauge gets onto a tile WITHOUT touching any of that: it
 * renders as a sibling of `CardContent`, so it is structurally incapable of
 * reaching `children[1]`. Inside the value div would also keep the position —
 * and would hold only until someone gave the gauge an SVG `<title>`, because
 * `textContent` concatenates descendants and `"55.6%"` would quietly become
 * `"55.6%Win rate gauge"`. The failure would point at the tile, not at the
 * gauge that caused it. Out here that cannot happen at all.
 */
function Stat({
  label,
  value,
  cls,
  title,
  size = "default",
  visual,
}: {
  label: string;
  value: string;
  cls?: string;
  title?: string;
  /** "hero" is the headline row: same markup, larger type. */
  size?: "default" | "hero";
  /**
   * A redundant encoding of `value` — a gauge, a ring, a sparkline.
   *
   * `aria-hidden` because the number beside it already says this. The visual
   * adds shape, not information, and a screen reader announcing "gauge, 56 of
   * 100" next to "55.6%" says the same thing twice, worse.
   */
  visual?: ReactNode;
}) {
  const hero = size === "hero";
  return (
    <Card
      title={title}
      className={cn(
        // `py-0`: the base Card ships `py-6`, which this tile never overrode —
        // 48px of vertical padding around a 12px content box, on every one of
        // the thirty-one tiles. `relative` anchors `visual`.
        "relative overflow-hidden py-0",
        hero && "border-border/80 shadow-none",
      )}
    >
      {visual && (
        <div aria-hidden className="pointer-events-none absolute inset-0">
          {visual}
        </div>
      )}
      <CardContent
        // The right gutter is reserved whether or not a visual is present, so a
        // row of tiles keeps one baseline for its numbers.
        className={hero ? "p-4 pr-20" : "p-3 pr-16"}
      >
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
