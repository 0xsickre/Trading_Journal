"use client";

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type ColumnDef,
  type PaginationState,
  type RowSelectionState,
  type SortingState,
  type Updater,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Download,
  MoreHorizontal,
  Pencil,
  Tag as TagIcon,
  Trash2,
  AlertTriangle,
  Merge,
  ExternalLink,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TagMultiSelect } from "@/components/journal/tag-multi-select";
import {
  classifyOutcome,
  resolveBreakevenRange,
  EXACT_ZERO_RANGE,
} from "@/lib/journal/breakeven";
import { Badge } from "@/components/ui/badge";
import { moneyProvenance } from "@/lib/journal/money-provenance";
import { buildPlaybookLookup } from "@/lib/journal/reports/rule-lookup";
import { setupScoreFromTrade } from "@/lib/journal/setup-score";
import type { Playbook, PositionRule } from "@/lib/journal/playbook-types";
import { cn } from "@/lib/utils";
import type { Account, OptionsMap, TradeRow } from "@/lib/journal/types";
import { fmtInTz, DATE_TIME, DEFAULT_TZ } from "@/lib/journal/time";
import {
  fmtMoney,
  fmtNum,
  fmtPct,
  fmtPrice,
  fmtR,
  pnlClass,
} from "@/lib/journal/format";
import { formatDuration } from "@/lib/journal/units";
import { winRateOf } from "@/lib/journal/analytics";
import { fmtSlippageR, slippageFromTrade } from "@/lib/journal/entry-slippage";
import {
  exitEfficiencyFromTrade,
  fmtExitEfficiencyPct,
} from "@/lib/journal/exit-efficiency";
import { excursionFromTrade } from "@/lib/journal/excursion";
import { primaryTradeImageUrl } from "@/lib/journal/tradingview-snapshot";
import { getAllFormFields } from "@/lib/journal/form-config";
import type { FieldDef } from "@/lib/journal/field-def-types";
import {
  arrayFieldValue,
  displayFieldValue,
  numberFieldValue,
  stringFieldValue,
} from "@/lib/journal/field-values";
import {
  deleteTrade,
  bulkDeleteTrades,
  bulkAddTag,
  mergeTrades,
  type BulkTagKind,
} from "@/app/(app)/trades/actions";
import {
  defaultMergeChoice,
  describeSide,
  mergeRefusal,
  type MergeSide,
} from "@/lib/journal/merge-positions";
import { setJournalHiddenColumns } from "@/app/(app)/journal/actions";
import {
  effectiveHidden,
  hiddenToVisibility,
  toStoredHidden,
  toggleHidden,
  visibleCount,
} from "@/lib/journal/column-prefs";
import {
  formatLifecycleStatusLabel,
  lifecycleStatusHint,
} from "@/lib/journal/trade-lifecycle";
import {
  DEFAULT_VIEW,
  PAGE_SIZES,
  PAGE_SIZE_ALL,
  PERIODS,
  inBounds,
  loadViewState,
  periodBounds,
  saveViewState,
  summarizeTrades,
  tradeDayKey,
  type Period,
} from "@/lib/journal/trades-view";

function statusBadgeClass(status: string): string | undefined {
  if (status === "missed") return "border-amber-500/50 text-amber-700 dark:text-amber-400";
  if (status === "planned") return "text-muted-foreground";
  return undefined;
}

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge
      variant={status === "missed" ? "outline" : "secondary"}
      className={statusBadgeClass(status)}
      title={lifecycleStatusHint(status)}
    >
      {formatLifecycleStatusLabel(status)}
    </Badge>
  );
}

const OUTCOME_KEY = "outcome";
const OUTCOME_LABELS: Record<string, string> = {
  win: "Win",
  breakeven: "Breakeven",
  loss: "Loss",
};
const STATUS_ORDER = ["planned", "open", "partial", "closed", "missed"];

/**
 * Every column the user may switch off, and its name.
 *
 * This map does three jobs at once, which is the point: it labels the headers
 * below, it labels the picker, and **membership in it is what makes a column
 * hideable**. A column absent from here — `actions`, the row menu — simply
 * cannot be turned off, with no separate flag to keep in step.
 */
const COLUMN_LABELS: Record<string, string> = {
  trade_no: "#",
  date: "Opened",
  instrument: "Instrument",
  direction: "Dir",
  playbook: "Playbook",
  setup_grade: "Grade",
  plan_entry: "Plan",
  stop_price: "Stop",
  target_price: "Target",
  size: "Size",
  avg_entry: "Entry",
  slippage_r: "Slip R",
  avg_exit: "Exit",
  hold: "Hold",
  r: "R",
  exit_eff: "Target %",
  capture: "Capture %",
  gross: "Gross",
  net: "Net",
  status: "Status",
  chart: "Chart",
};

const HIDEABLE_COLUMNS = Object.keys(COLUMN_LABELS);

/**
 * Off until the trader turns them on. These answer study questions — how far
 * the fill was from the plan, how much of the move was kept — rather than the
 * scanning ones the list is opened for, and with them on the table ran to
 * twenty columns and a horizontal scroll on any laptop.
 */
const DEFAULT_HIDDEN_COLUMNS = [
  "plan_entry",
  "stop_price",
  "target_price",
  "slippage_r",
  "exit_eff",
  "capture",
  "gross",
];

/**
 * The three tag columns a bulk "Add tag" can target, and the option-list
 * key(s) each one reads its values from — the same lookup `trade-form.tsx`
 * uses for the per-trade pickers (`form-config.ts`), so a bulk-applied tag is
 * never a value the single-trade form wouldn't also offer.
 */
const BULK_TAG_CATEGORIES: {
  value: BulkTagKind;
  label: string;
  listKey?: string;
  listKeys?: string[];
}[] = [
  { value: "technical", label: "Technical", listKey: "technical_tag" },
  { value: "psychology", label: "Psychology", listKeys: ["emotion", "discipline"] },
  { value: "mistake", label: "Mistake", listKey: "mistake" },
];

/** One dimension filter: its options come from the book, its match from the row. */
type FilterSpec = {
  key: string;
  label: string;
  options: { value: string; label: string }[];
  match: (t: TradeRow, value: string) => boolean;
};

function distinctValues(rows: TradeRow[], read: (t: TradeRow) => string[]): string[] {
  const set = new Set<string>();
  for (const r of rows) for (const v of read(r)) if (v) set.add(v);
  return [...set].sort((a, b) => a.localeCompare(b));
}

/** A column's values: the tags of an array field, or the one string of a plain one. */
function fieldValues(t: TradeRow, key: string): string[] {
  const tags = arrayFieldValue(t, key);
  if (tags) return tags;
  const v = stringFieldValue(t, key);
  return v ? [v] : [];
}

export function JournalGrid({
  trades,
  accounts,
  fieldDefs = [],
  hiddenColumns = [],
  optionsMap = {},
  playbooks = [],
  positionRules,
  viewKey,
}: {
  trades: TradeRow[];
  accounts: Account[];
  /** User-defined fields, so the export carries them like any other column. */
  fieldDefs?: FieldDef[];
  /** Columns the user switched off, from tj_user_prefs. */
  hiddenColumns?: string[];
  /** Option-list values, keyed by list key — powers the bulk "Add tag" picker. */
  optionsMap?: OptionsMap;
  /** Playbooks and their rules, for the playbook column and the derived setup grade. */
  playbooks?: Playbook[];
  /** Recorded rule answers, the other half of that grade. */
  positionRules?: Map<string, PositionRule[]>;
  /**
   * Which remembered view this list uses. Absent on `/journal`; a playbook's
   * Trades tab passes its own, so the two lists keep separate filters.
   */
  viewKey?: string;
}) {
  const router = useRouter();
  const tzByAccount = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of accounts) m.set(a.id, a.timezone);
    return m;
  }, [accounts]);
  const currencyByAccount = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of accounts) m.set(a.id, a.currency);
    return m;
  }, [accounts]);
  const playbookName = useMemo(
    () => new Map(playbooks.map((p) => [p.id, p.name])),
    [playbooks],
  );

  // View state. Starts from the default on the server and on first paint, and
  // the tab's remembered view is read after mount — sessionStorage does not
  // exist during SSR, and reading it in render would mismatch hydration.
  const [search, setSearch] = useState(DEFAULT_VIEW.search);
  /**
   * The value the FILTER reads, one render behind the box. `filtered` scores
   * every trade against the rule library for its grade, so driving it straight
   * off `search` ran that pass on every keystroke.
   */
  const deferredSearch = useDeferredValue(search);
  const [accountFilter, setAccountFilter] = useState<string>(DEFAULT_VIEW.account);
  const [filters, setFilters] = useState<Record<string, string>>(DEFAULT_VIEW.filters);
  const [period, setPeriod] = useState<Period>(DEFAULT_VIEW.period);
  const [customFrom, setCustomFrom] = useState(DEFAULT_VIEW.customFrom);
  const [customTo, setCustomTo] = useState(DEFAULT_VIEW.customTo);
  // Newest trade first. The server orders by `created_at` — when the ROW was
  // written — so a backlog imported today sat above last week's trades.
  const [sorting, setSorting] = useState<SortingState>(DEFAULT_VIEW.sort);
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: DEFAULT_VIEW.pageIndex,
    pageSize: DEFAULT_VIEW.pageSize,
  });
  const restored = useRef(false);

  useEffect(() => {
    const v = loadViewState(viewKey);
    setSearch(v.search);
    setAccountFilter(v.account);
    setFilters(v.filters);
    setPeriod(v.period);
    setCustomFrom(v.customFrom);
    setCustomTo(v.customTo);
    setSorting(v.sort);
    setPagination({ pageIndex: v.pageIndex, pageSize: v.pageSize });
    restored.current = true;
  }, [viewKey]);

  useEffect(() => {
    if (!restored.current) return;
    saveViewState({
      search,
      account: accountFilter,
      filters,
      period,
      customFrom,
      customTo,
      sort: sorting,
      pageSize: pagination.pageSize,
      pageIndex: pagination.pageIndex,
    }, viewKey);
  }, [search, accountFilter, filters, period, customFrom, customTo, sorting, pagination, viewKey]);

  /** Any narrowing sends the reader back to page one — page 4 of a smaller set may not exist. */
  const toFirstPage = () => setPagination((p) => (p.pageIndex === 0 ? p : { ...p, pageIndex: 0 }));

  function setFilter(key: string, value: string) {
    setFilters((p) => {
      const next = { ...p };
      if (value === "all") delete next[key];
      else next[key] = value;
      return next;
    });
    toFirstPage();
  }

  function clearAllFilters() {
    setFilters({});
    setAccountFilter("all");
    setPeriod("all");
    setCustomFrom("");
    setCustomTo("");
    setSearch("");
    toFirstPage();
  }

  // Optimistic: the column disappears on click and the save follows. A round
  // trip before the grid reacts would read as a dead checkbox.
  const [hidden, setHidden] = useState<string[]>(() =>
    effectiveHidden(hiddenColumns, HIDEABLE_COLUMNS, DEFAULT_HIDDEN_COLUMNS),
  );

  // Bulk selection + the dialogs it can open. `rowSelection` is keyed by trade
  // id (`getRowId` below), not row index, so it survives a re-sort.
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [bulkPending, startBulk] = useTransition();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [rowToDelete, setRowToDelete] = useState<TradeRow | null>(null);
  const [tagDialogOpen, setTagDialogOpen] = useState(false);
  const [tagKind, setTagKind] = useState<BulkTagKind>("technical");
  const [tagValues, setTagValues] = useState<string[]>([]);
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);

  const columnVisibility = useMemo(
    // Only the hideable ids are listed; TanStack treats every column it does
    // not hear about as visible, which is exactly right for `actions`.
    () => hiddenToVisibility(hidden, HIDEABLE_COLUMNS),
    [hidden],
  );

  function toggleColumn(id: string) {
    const next = toggleHidden(hidden, HIDEABLE_COLUMNS, id);
    // `toggleHidden` returns the input unchanged when it refuses — hiding the
    // last visible column — so there is nothing to save and nothing to redraw.
    if (next.length === hidden.length && next.every((x, i) => x === hidden[i]))
      return;
    const before = hidden;
    setHidden(next);
    void setJournalHiddenColumns(toStoredHidden(next)).then((res) => {
      if (!res.ok) {
        setHidden(before);
        toast.error(res.error);
      }
    });
  }

  /**
   * Breakeven band per account, for the outcome filter. Per account and not one
   * global band: the same −$40 is breakeven on an account whose band reaches
   * −$50 and a loss on one that does not.
   */
  const rangeByAccount = useMemo(
    () => new Map(accounts.map((a) => [a.id, resolveBreakevenRange(a)])),
    [accounts],
  );

  const outcomeOf = useCallback(
    (t: TradeRow): "win" | "loss" | "breakeven" | null => {
      // Closed trades only. A partial's P&L is not final, and an open or missed
      // trade has no outcome at all — null keeps it out of every bucket.
      const net = t.stats?.net_pl;
      if (net == null || t.status !== "closed") return null;
      const range =
        (t.account_id ? rangeByAccount.get(t.account_id) : null) ??
        EXACT_ZERO_RANGE;
      return classifyOutcome(net, range);
    },
    [rangeByAccount],
  );

  const ruleLookup = useMemo(
    () => buildPlaybookLookup(playbooks, positionRules).rules,
    [playbooks, positionRules],
  );

  /**
   * The grade shown, filtered on and searched: derived from the criteria when
   * they were answered, the hand-typed column otherwise. The filter used to
   * read the typed column alone, so it could disagree with the column beside
   * it about which rows were a B.
   */
  const gradeOf = useCallback(
    (t: TradeRow): string | null => {
      const scored = setupScoreFromTrade(
        { id: t.id, outcome: outcomeOf(t), row: t },
        ruleLookup,
      );
      return scored?.grade ?? (t.setup_grade as string) ?? null;
    },
    [ruleLookup, outcomeOf],
  );

  const tzOf = useCallback(
    (t: TradeRow | undefined) =>
      (t?.account_id && tzByAccount.get(t.account_id)) || DEFAULT_TZ,
    [tzByAccount],
  );
  const curOf = useCallback(
    (t: TradeRow) => (t.account_id && currencyByAccount.get(t.account_id)) || "USD",
    [currencyByAccount],
  );
  const playbookOf = useCallback(
    (t: TradeRow) => {
      const id = t.playbook_id as string | null | undefined;
      return id ? (playbookName.get(id) ?? null) : null;
    },
    [playbookName],
  );

  const filterSpecs = useMemo<FilterSpec[]>(() => {
    const simple = (key: string, label: string): FilterSpec => ({
      key,
      label,
      options: distinctValues(trades, (t) => fieldValues(t, key)).map((v) => ({
        value: v,
        label: v,
      })),
      match: (t, v) => fieldValues(t, key).includes(v),
    });
    const usedPlaybooks = new Set(trades.map((t) => t.playbook_id as string | null));
    return [
      simple("instrument", "Instrument"),
      simple("direction", "Direction"),
      {
        key: "playbook",
        label: "Playbook",
        options: playbooks
          .filter((p) => usedPlaybooks.has(p.id))
          .map((p) => ({ value: p.id, label: p.name })),
        match: (t, v) => t.playbook_id === v,
      },
      {
        key: "setup_grade",
        label: "Grade",
        options: distinctValues(trades, (t) => {
          const g = gradeOf(t);
          return g ? [g] : [];
        }).map((v) => ({ value: v, label: v })),
        match: (t, v) => gradeOf(t) === v,
      },
      simple("ict_entry_model", "Entry model"),
      simple("technical_tags", "Technical tag"),
      simple("mistake", "Mistake"),
      {
        key: OUTCOME_KEY,
        label: "Outcome",
        options: ["win", "breakeven", "loss"].map((v) => ({
          value: v,
          label: OUTCOME_LABELS[v],
        })),
        match: (t, v) => outcomeOf(t) === v,
      },
      {
        key: "status",
        label: "Status",
        options: STATUS_ORDER.filter((s) => trades.some((t) => t.status === s)).map(
          (s) => ({ value: s, label: formatLifecycleStatusLabel(s) }),
        ),
        match: (t, v) => t.status === v,
      },
      {
        key: "needs_review",
        label: "Review",
        options: [{ value: "yes", label: "Needs review" }],
        match: (t) => t.needs_review === true,
      },
    ];
  }, [trades, playbooks, gradeOf, outcomeOf]);

  // The timezone "today" is counted in: the filtered account's, else the first
  // active account's. Each trade's own day is still read in its own account tz.
  const scopeTz = useMemo(() => {
    const a =
      accounts.find((x) => x.id === accountFilter) ??
      accounts.find((x) => x.is_active) ??
      accounts[0];
    return a?.timezone ?? DEFAULT_TZ;
  }, [accounts, accountFilter]);

  const bounds = useMemo(
    () =>
      periodBounds(period, new Date(), scopeTz, { from: customFrom, to: customTo }),
    [period, scopeTz, customFrom, customTo],
  );

  const filtered = useMemo(() => {
    const active = filterSpecs.filter((f) => filters[f.key] != null);
    const q = deferredSearch.trim().toLowerCase();
    return trades.filter((t) => {
      if (accountFilter !== "all" && t.account_id !== accountFilter) return false;
      if (!inBounds(tradeDayKey(t, tzOf(t)), bounds)) return false;
      for (const f of active) if (!f.match(t, filters[f.key])) return false;
      if (q) {
        const tagHay = ["technical_tags", "psychology_tags", "mistake"].flatMap(
          (k) => arrayFieldValue(t, k) ?? [],
        );
        const hay = [
          t.trade_no != null ? `#${t.trade_no}` : null,
          t.instrument,
          t.direction,
          t.trade_journal_notes,
          t.ict_entry_model,
          t.miss_reason,
          playbookOf(t),
          gradeOf(t),
          ...tagHay,
        ]
          .filter((x) => typeof x === "string")
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [trades, accountFilter, bounds, filterSpecs, filters, deferredSearch, tzOf, gradeOf, playbookOf]);

  const summary = useMemo(() => summarizeTrades(filtered, accounts), [filtered, accounts]);

  /**
   * The selection the table sees: only rows still in the filtered set. A row
   * ticked and then filtered away used to stay selected out of sight, and the
   * count, the merge pair and a delete could each disagree about it.
   */
  const visibleSelection = useMemo(() => {
    const ids = new Set(filtered.map((t) => t.id));
    const out: RowSelectionState = {};
    for (const [id, on] of Object.entries(rowSelection)) if (on && ids.has(id)) out[id] = true;
    return out;
  }, [rowSelection, filtered]);

  const onRowSelectionChange = (u: Updater<RowSelectionState>) =>
    setRowSelection(typeof u === "function" ? u(visibleSelection) : u);

  const columns = useMemo<ColumnDef<TradeRow>[]>(
    () => [
      {
        id: "select",
        enableSorting: false,
        header: ({ table }) => (
          <Checkbox
            checked={
              table.getIsAllRowsSelected()
                ? true
                : table.getIsSomeRowsSelected()
                  ? "indeterminate"
                  : false
            }
            onCheckedChange={(v) => table.toggleAllRowsSelected(!!v)}
            aria-label="Select all"
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(v) => row.toggleSelected(!!v)}
            aria-label="Select row"
          />
        ),
      },
      {
        id: "trade_no",
        header: COLUMN_LABELS.trade_no,
        accessorFn: (r) => r.trade_no ?? undefined,
        cell: ({ row }) => (
          <span className="text-muted-foreground tabular-nums">
            {row.original.trade_no ?? "—"}
          </span>
        ),
      },
      {
        id: "date",
        header: COLUMN_LABELS.date,
        accessorFn: (r) => r.stats?.opened_at ?? r.created_at,
        cell: ({ row }) => {
          const t = row.original;
          const tz = tzOf(t);
          return (
            <span className="whitespace-nowrap tabular-nums" title={tz.replace("_", " ")}>
              {fmtInTz(t.stats?.opened_at ?? t.created_at, tz, DATE_TIME)}
            </span>
          );
        },
      },
      {
        id: "instrument",
        header: COLUMN_LABELS.instrument,
        accessorFn: (r) => (r.instrument as string) ?? undefined,
        cell: ({ row }) => {
          // Only the warnings. "broker" — the money came from the statement —
          // is not something to act on, so it moved to the Net cell's tooltip
          // instead of sitting as a badge on every imported row.
          const money = moneyProvenance(row.original.stats);
          const warn = money.label != null && money.label !== "broker";
          return (
            <span className="flex items-center gap-1.5">
              <span className="font-mono">
                {(row.original.instrument as string) ?? "—"}
              </span>
              {warn && (
                <Badge
                  variant="outline"
                  className={money.unpriced ? "text-[var(--loss)]" : "text-muted-foreground"}
                  title={money.title ?? undefined}
                >
                  {money.label}
                </Badge>
              )}
            </span>
          );
        },
      },
      {
        id: "direction",
        header: COLUMN_LABELS.direction,
        accessorFn: (r) => (r.direction as string) ?? undefined,
        cell: ({ row }) => {
          const d = row.original.direction as string;
          if (!d) return "—";
          const short = d.toLowerCase().startsWith("short");
          return (
            <Badge
              variant="outline"
              className={short ? "text-[var(--loss)]" : "text-[var(--profit)]"}
            >
              {d}
            </Badge>
          );
        },
      },
      {
        id: "playbook",
        header: COLUMN_LABELS.playbook,
        accessorFn: (r) => playbookOf(r) ?? undefined,
        cell: ({ row }) => (
          <span className="block max-w-40 truncate">{playbookOf(row.original) ?? "—"}</span>
        ),
      },
      {
        id: "setup_grade",
        accessorFn: (r) => gradeOf(r) ?? undefined,
        header: COLUMN_LABELS.setup_grade,
        cell: ({ row }) => gradeOf(row.original) ?? "—",
      },
      // The plan, as opposed to what happened. Prices format against the
      // trade's own frozen tick size, because two decimals turns a EURUSD stop
      // of 1.16101 and a target of 1.16453 into the same "1.16".
      {
        id: "plan_entry",
        header: COLUMN_LABELS.plan_entry,
        accessorFn: (r) => numberFieldValue(r, "entry_price") ?? undefined,
        cell: ({ row }) =>
          fmtPrice(
            numberFieldValue(row.original, "entry_price"),
            numberFieldValue(row.original, "tick_size_at_trade"),
          ),
      },
      {
        id: "stop_price",
        header: COLUMN_LABELS.stop_price,
        accessorFn: (r) => numberFieldValue(r, "stop_price") ?? undefined,
        cell: ({ row }) =>
          fmtPrice(
            numberFieldValue(row.original, "stop_price"),
            numberFieldValue(row.original, "tick_size_at_trade"),
          ),
      },
      {
        id: "target_price",
        header: COLUMN_LABELS.target_price,
        accessorFn: (r) => numberFieldValue(r, "target_price") ?? undefined,
        cell: ({ row }) =>
          fmtPrice(
            numberFieldValue(row.original, "target_price"),
            numberFieldValue(row.original, "tick_size_at_trade"),
          ),
      },
      {
        id: "size",
        header: COLUMN_LABELS.size,
        accessorFn: (r) => r.stats?.entry_qty || undefined,
        cell: ({ row }) => fmtNum(row.original.stats?.entry_qty || null, 2),
      },
      // Fill averages at the same precision as the plan columns. They used to
      // print two decimals, so an FX entry and exit could read identical.
      {
        id: "avg_entry",
        header: COLUMN_LABELS.avg_entry,
        accessorFn: (r) => r.stats?.avg_entry ?? undefined,
        cell: ({ row }) =>
          fmtPrice(
            row.original.stats?.avg_entry,
            numberFieldValue(row.original, "tick_size_at_trade"),
          ),
      },
      {
        id: "slippage_r",
        header: COLUMN_LABELS.slippage_r,
        accessorFn: (r) => slippageFromTrade(r)?.slippageR ?? undefined,
        cell: ({ row }) => {
          const slip = slippageFromTrade(row.original);
          if (slip?.slippageR == null) return "—";
          return (
            <span className={pnlClass(-slip.slippageR)}>
              {fmtSlippageR(slip.slippageR)}
            </span>
          );
        },
      },
      {
        id: "avg_exit",
        header: COLUMN_LABELS.avg_exit,
        accessorFn: (r) => r.stats?.avg_exit ?? undefined,
        cell: ({ row }) =>
          fmtPrice(
            row.original.stats?.avg_exit,
            numberFieldValue(row.original, "tick_size_at_trade"),
          ),
      },
      {
        id: "hold",
        header: COLUMN_LABELS.hold,
        accessorFn: (r) => r.stats?.duration_seconds ?? undefined,
        cell: ({ row }) => (
          <span className="whitespace-nowrap">
            {formatDuration(row.original.stats?.duration_seconds)}
          </span>
        ),
      },
      {
        id: "r",
        header: COLUMN_LABELS.r,
        accessorFn: (r) => r.stats?.realized_r ?? undefined,
        cell: ({ row }) => (
          <span className={pnlClass(row.original.stats?.realized_r)}>
            {fmtR(row.original.stats?.realized_r)}
          </span>
        ),
      },
      {
        id: "exit_eff",
        header: COLUMN_LABELS.exit_eff,
        accessorFn: (r) => exitEfficiencyFromTrade(r)?.pct ?? undefined,
        cell: ({ row }) => {
          const eff = exitEfficiencyFromTrade(row.original);
          if (eff == null) return "—";
          return (
            <span className={pnlClass(eff.pct - 50)}>
              {fmtExitEfficiencyPct(eff.pct)}
            </span>
          );
        },
      },
      {
        id: "capture",
        header: COLUMN_LABELS.capture,
        accessorFn: (r) => excursionFromTrade(r).capturePct ?? undefined,
        cell: ({ row }) => {
          // Null means no MFE price, or a trade that never went in favour —
          // there is no peak to have captured a share of.
          const pct = excursionFromTrade(row.original).capturePct;
          if (pct == null) return "—";
          return <span className={pnlClass(pct - 50)}>{fmtNum(pct, 0)}%</span>;
        },
      },
      {
        id: "gross",
        header: COLUMN_LABELS.gross,
        accessorFn: (r) => r.stats?.gross_pl ?? undefined,
        cell: ({ row }) => (
          <span className={pnlClass(row.original.stats?.gross_pl)}>
            {fmtMoney(row.original.stats?.gross_pl, curOf(row.original), { sign: true })}
          </span>
        ),
      },
      {
        id: "net",
        header: COLUMN_LABELS.net,
        accessorFn: (r) => r.stats?.net_pl ?? undefined,
        cell: ({ row }) => {
          const money = moneyProvenance(row.original.stats);
          return (
            <span
              className={`font-medium tabular-nums ${pnlClass(row.original.stats?.net_pl)}`}
              title={money.label === "broker" ? (money.title ?? undefined) : undefined}
            >
              {fmtMoney(row.original.stats?.net_pl, curOf(row.original), { sign: true })}
            </span>
          );
        },
      },
      {
        id: "status",
        header: COLUMN_LABELS.status,
        accessorFn: (r) => STATUS_ORDER.indexOf(String(r.status)),
        cell: ({ row }) => {
          const t = row.original;
          return (
            <div className="flex items-center gap-1">
              <StatusBadge status={String(t.status)} />
              {t.needs_review && (
                <span title="Needs review">
                  <AlertTriangle className="size-3.5 text-[var(--chart-4)]" />
                </span>
              )}
            </div>
          );
        },
      },
      {
        id: "chart",
        header: "",
        enableSorting: false,
        cell: ({ row }) => {
          const url = primaryTradeImageUrl(row.original.tv_images ?? {});
          if (!url) return null;
          return (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex text-muted-foreground hover:text-foreground"
              title="Open TradingView snapshot"
            >
              <ExternalLink className="size-4" />
            </a>
          );
        },
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        cell: ({ row }) => (
          <RowActions
            id={row.original.id}
            onDelete={() => setRowToDelete(row.original)}
          />
        ),
      },
    ],
    [tzOf, curOf, gradeOf, playbookOf],
  );

  // React Compiler cannot memoize a `useReactTable` result: the builder hands
  // back fresh functions every render by design.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: filtered,
    columns,
    // A trade's own id, not its position in `filtered`, so selection survives
    // a re-sort without re-pointing at whatever trade now sits at that index.
    getRowId: (row) => row.id,
    state: { sorting, columnVisibility, rowSelection: visibleSelection, pagination },
    onSortingChange: (u) => {
      setSorting(u);
      toFirstPage();
    },
    onRowSelectionChange,
    onPaginationChange: setPagination,
    // The page is reset by the controls that narrow the set, not by every new
    // `data` array — a router refresh after an edit must not jump to page one.
    autoResetPageIndex: false,
    enableRowSelection: true,
    // Nulls last in either direction: a trade with no R is not the worst R.
    defaultColumn: { sortUndefined: "last" },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  // A remembered page past the end of a smaller set would show an empty table.
  const pageCount = table.getPageCount();
  if (pagination.pageIndex > 0 && pagination.pageIndex >= pageCount) {
    setPagination((p) => ({ ...p, pageIndex: Math.max(0, pageCount - 1) }));
  }

  const selectedRows = useMemo(
    () => filtered.filter((t) => visibleSelection[t.id]),
    [filtered, visibleSelection],
  );
  const selectedIds = useMemo(() => selectedRows.map((t) => t.id), [selectedRows]);

  /**
   * The two selected trades as the merge decision needs them. Only ever two:
   * merging three rows is three decisions about which judgement survives.
   */
  const mergePair = useMemo((): [MergeSide, MergeSide] | null => {
    if (selectedRows.length !== 2) return null;
    const asSide = (t: TradeRow): MergeSide => ({
      id: t.id,
      tradeNo: (t.trade_no as number) ?? null,
      instrument: (t.instrument as string) ?? null,
      direction: (t.direction as string) ?? null,
      accountId: (t.account_id as string) ?? null,
      source: (t.source as string) ?? null,
      createdAt: (t.created_at as string) ?? null,
      openedAt: t.stats?.opened_at ?? null,
      avgEntry: t.stats?.avg_entry ?? null,
      avgExit: t.stats?.avg_exit ?? null,
      entryQty: t.stats?.entry_qty ?? null,
      netPl: t.stats?.net_pl ?? null,
    });
    return [asSide(selectedRows[0]), asSide(selectedRows[1])];
  }, [selectedRows]);

  const mergeBlocked = mergePair ? mergeRefusal(mergePair[0], mergePair[1]) : null;
  // Not a question: the imported trade's numbers correct the typed one, and
  // the typed one keeps its grade, plan and notes.
  const mergeChoice = mergePair ? defaultMergeChoice(mergePair[0], mergePair[1]) : null;

  /** Active narrowing, as removable chips — a filter you cannot see is one you forget you set. */
  const chips = useMemo(() => {
    const out: { id: string; label: string; clear: () => void }[] = [];
    if (accountFilter !== "all") {
      const a = accounts.find((x) => x.id === accountFilter);
      out.push({
        id: "account",
        label: `Account: ${a?.name ?? "?"}`,
        clear: () => {
          setAccountFilter("all");
          toFirstPage();
        },
      });
    }
    if (period !== "all") {
      const label =
        period === "custom"
          ? `${customFrom || "…"} → ${customTo || "…"}`
          : (PERIODS.find((p) => p.value === period)?.label ?? period);
      out.push({
        id: "period",
        label: `Period: ${label}`,
        clear: () => {
          setPeriod("all");
          toFirstPage();
        },
      });
    }
    for (const f of filterSpecs) {
      const v = filters[f.key];
      if (v == null) continue;
      const opt = f.options.find((o) => o.value === v)?.label ?? v;
      out.push({ id: f.key, label: `${f.label}: ${opt}`, clear: () => setFilter(f.key, "all") });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountFilter, accounts, period, customFrom, customTo, filterSpecs, filters]);

  const activeFilterCount = filterSpecs.filter((f) => filters[f.key] != null).length;
  const isNarrowed = chips.length > 0 || search.trim() !== "";

  function exportData(kind: "csv" | "xlsx") {
    // The selection when there is one — "export these five" is what ticking
    // them usually means — and the filtered set otherwise.
    const source = selectedRows.length > 0 ? selectedRows : filtered;
    const rows = source.map((t) => {
      const o: Record<string, unknown> = {
        "Trade #": t.trade_no ?? "",
        Opened: fmtInTz(t.stats?.opened_at ?? t.created_at, tzOf(t), "yyyy-MM-dd HH:mm"),
        Account: accounts.find((a) => a.id === t.account_id)?.name ?? "",
        Playbook: playbookOf(t) ?? "",
      };
      for (const f of getAllFormFields(fieldDefs))
        o[f.label] = displayFieldValue(t, f.name);
      o["Planned R:R"] = (t.planned_rr as string) ?? "";
      o["Planned Size"] = t.position_size ?? "";
      o["Avg Entry"] = t.stats?.avg_entry ?? "";
      o["Slip R"] = fmtSlippageR(slippageFromTrade(t)?.slippageR);
      o["Avg Exit"] = t.stats?.avg_exit ?? "";
      o["Size"] = t.stats?.entry_qty ?? "";
      o["Hold"] = t.stats?.duration_seconds != null ? formatDuration(t.stats.duration_seconds) : "";
      o["R"] = t.stats?.realized_r ?? "";
      o["Target attainment %"] = fmtExitEfficiencyPct(exitEfficiencyFromTrade(t)?.pct);
      // MAE and MFE ride along with the capture: "captured 40 %" means nothing
      // without knowing how big the peak was.
      const excursion = excursionFromTrade(t);
      o["MAE R"] = excursion.maeR ?? "";
      o["MFE R"] = excursion.mfeR ?? "";
      o["MFE capture %"] =
        excursion.capturePct == null ? "" : fmtNum(excursion.capturePct, 0);
      o["Gross P/L"] = t.stats?.gross_pl ?? "";
      o["Net P/L"] = t.stats?.net_pl ?? "";
      o["Currency"] = curOf(t);
      o["Status"] = formatLifecycleStatusLabel(String(t.status));
      o["Miss reason"] = (t.miss_reason as string) ?? "";
      o["Missed at"] = (t.missed_at as string) ?? "";
      return o;
    });
    if (rows.length === 0) {
      toast.error("Nothing to export");
      return;
    }
    const stamp = new Date().toISOString().slice(0, 10);
    if (kind === "csv") {
      import("papaparse").then((Papa) => {
        const csv = Papa.default.unparse(rows);
        downloadBlob(csv, `trades-${stamp}.csv`, "text/csv;charset=utf-8;");
      });
    } else {
      import("xlsx").then((XLSX) => {
        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Trades");
        XLSX.writeFile(wb, `trades-${stamp}.xlsx`);
      });
    }
  }

  const pageRows = table.getRowModel().rows;
  const visibleColumnCount = table.getVisibleLeafColumns().length;

  return (
    <div className="space-y-3">
      <SummaryBar summary={summary} />

      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Search notes, tags, playbook…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            toFirstPage();
          }}
          className="h-9 w-56"
          aria-label="Search trades"
        />
        <Select
          value={period}
          onValueChange={(v) => {
            setPeriod(v as Period);
            toFirstPage();
          }}
        >
          <SelectTrigger className="h-9 w-auto min-w-36" aria-label="Period">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERIODS.map((p) => (
              <SelectItem key={p.value} value={p.value}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {period === "custom" && (
          <div className="flex items-center gap-1">
            <Input
              type="date"
              className="h-9 w-36"
              value={customFrom}
              onChange={(e) => {
                setCustomFrom(e.target.value);
                toFirstPage();
              }}
              aria-label="From"
            />
            <span className="text-muted-foreground">–</span>
            <Input
              type="date"
              className="h-9 w-36"
              value={customTo}
              onChange={(e) => {
                setCustomTo(e.target.value);
                toFirstPage();
              }}
              aria-label="To"
            />
          </div>
        )}
        {accounts.length > 1 && (
          <FilterSelect
            label="Account"
            value={accountFilter}
            onChange={(v) => {
              setAccountFilter(v);
              toFirstPage();
            }}
            options={accounts.map((a) => ({ value: a.id, label: a.name }))}
          />
        )}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-9">
              <SlidersHorizontal className="size-4" /> Filters
              {activeFilterCount > 0 && (
                <Badge variant="secondary" className="ml-1">
                  {activeFilterCount}
                </Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Filters</p>
              {activeFilterCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs text-muted-foreground"
                  onClick={() => {
                    setFilters({});
                    toFirstPage();
                  }}
                >
                  Clear all
                </Button>
              )}
            </div>
            {filterSpecs
              // A filter with nothing to choose from is a dead control.
              .filter((f) => f.options.length > 0 || filters[f.key] != null)
              .map((f) => (
                <FilterSelect
                  key={f.key}
                  label={f.label}
                  value={filters[f.key] ?? "all"}
                  onChange={(v) => setFilter(f.key, v)}
                  options={f.options}
                  className="w-full"
                />
              ))}
          </PopoverContent>
        </Popover>
        <div className="ml-auto flex items-center gap-2">
          {selectedIds.length > 0 && (
            <>
              <span className="text-xs text-muted-foreground">
                {selectedIds.length} selected
              </span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    Bulk actions
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setTagDialogOpen(true)}>
                    <TagIcon className="size-4" /> Add tag…
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={!mergePair || mergeBlocked != null}
                    onClick={() => setMergeDialogOpen(true)}
                  >
                    <Merge className="size-4" /> Merge 2 trades…
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-destructive"
                    onClick={() => setDeleteDialogOpen(true)}
                  >
                    <Trash2 className="size-4" /> Delete selected
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Columns3 className="size-4" /> Columns
                <Badge variant="secondary" className="ml-1">
                  {visibleCount(hidden, HIDEABLE_COLUMNS)}/{HIDEABLE_COLUMNS.length}
                </Badge>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
              {HIDEABLE_COLUMNS.map((id) => {
                const on = !hidden.includes(id);
                // The last one on cannot be switched off; a checkbox that
                // silently does nothing is worse than one visibly unavailable.
                const isLast = on && visibleCount(hidden, HIDEABLE_COLUMNS) === 1;
                return (
                  <DropdownMenuCheckboxItem
                    key={id}
                    checked={on}
                    disabled={isLast}
                    onSelect={(e) => {
                      // Keep the menu open — hiding several columns in a row is
                      // the normal way this gets used.
                      e.preventDefault();
                      toggleColumn(id);
                    }}
                  >
                    {COLUMN_LABELS[id]}
                  </DropdownMenuCheckboxItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Download className="size-4" /> Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => exportData("csv")}>
                CSV
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => exportData("xlsx")}>
                Excel
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((c) => (
            <Badge key={c.id} variant="secondary" className="gap-1 pr-1 font-normal">
              {c.label}
              <button
                type="button"
                onClick={c.clear}
                className="rounded-sm p-0.5 hover:bg-muted-foreground/20"
                aria-label={`Remove ${c.label}`}
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs text-muted-foreground"
            onClick={clearAllFilters}
          >
            Clear all
          </Button>
        </div>
      )}

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((h) => {
                  const sorted = h.column.getIsSorted();
                  const label = h.isPlaceholder
                    ? null
                    : flexRender(h.column.columnDef.header, h.getContext());
                  return (
                    <TableHead
                      key={h.id}
                      className="whitespace-nowrap"
                      aria-sort={
                        sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined
                      }
                    >
                      {h.column.getCanSort() && COLUMN_LABELS[h.column.id] ? (
                        <button
                          type="button"
                          className={cn(
                            "inline-flex items-center gap-1 hover:text-foreground",
                            sorted && "text-foreground",
                          )}
                          onClick={() => h.column.toggleSorting(sorted === "asc")}
                        >
                          {label}
                          {sorted === "asc" ? (
                            <ArrowUp className="size-3" />
                          ) : sorted === "desc" ? (
                            <ArrowDown className="size-3" />
                          ) : (
                            <ArrowUpDown className="size-3 opacity-40" />
                          )}
                        </button>
                      ) : (
                        label
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {pageRows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={visibleColumnCount}
                  className="h-32 text-center text-muted-foreground"
                >
                  {trades.length === 0 ? (
                    <>
                      No trades yet.{" "}
                      <Link href="/trades/new" className="underline">
                        Log your first trade
                      </Link>
                      .
                    </>
                  ) : (
                    <>
                      No trades match these filters.{" "}
                      <button type="button" className="underline" onClick={clearAllFilters}>
                        Clear filters
                      </button>
                    </>
                  )}
                </TableCell>
              </TableRow>
            ) : (
              pageRows.map((row) => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer"
                  tabIndex={0}
                  data-state={row.getIsSelected() ? "selected" : undefined}
                  onClick={() => router.push(`/trades/${row.original.id}/edit`)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && e.target === e.currentTarget)
                      router.push(`/trades/${row.original.id}/edit`);
                  }}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      onClick={(e) => {
                        if (cell.column.id === "actions" || cell.column.id === "select")
                          e.stopPropagation();
                      }}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <p>
          {filtered.length} of {trades.length} trades
          {isNarrowed ? " (filtered)" : ""}
        </p>
        <div className="flex items-center gap-2">
          <Select
            value={String(pagination.pageSize)}
            onValueChange={(v) => setPagination({ pageIndex: 0, pageSize: Number(v) })}
          >
            <SelectTrigger className="h-8 w-auto gap-1" aria-label="Rows per page">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZES.map((s) => (
                <SelectItem key={s} value={String(s)}>
                  {s} / page
                </SelectItem>
              ))}
              <SelectItem value={String(PAGE_SIZE_ALL)}>All</SelectItem>
            </SelectContent>
          </Select>
          {pageCount > 1 && (
            <>
              <span className="tabular-nums">
                Page {pagination.pageIndex + 1} of {pageCount}
              </span>
              <Button
                variant="outline"
                size="icon"
                className="size-8"
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage()}
                aria-label="Previous page"
              >
                <ChevronLeft className="size-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="size-8"
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage()}
                aria-label="Next page"
              >
                <ChevronRight className="size-4" />
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Merge. The preview names both trades and says it cannot be undone —
          the same contract as the delete dialogs below. */}
      <Dialog open={mergeDialogOpen} onOpenChange={setMergeDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Merge two trades into one</DialogTitle>
            <DialogDescription>
              The imported numbers correct the typed trade: times, entry, exit,
              size and costs come from the import, anything the typed trade is
              missing is filled in, and its grade, plan and notes stay. The
              second row is then deleted. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {mergePair && mergeChoice && (() => {
            const keep = mergePair.find((p) => p.id === mergeChoice.keepId)!;
            const from = mergePair.find((p) => p.id === mergeChoice.fillsFromId)!;
            // In the kept trade's own account timezone — this used to read the
            // FIRST trade in the whole book, whichever account that was on.
            const tz = tzOf(trades.find((t) => t.id === keep.id));
            const when = (iso: string) => fmtInTz(iso, tz, DATE_TIME);
            return (
              <div className="space-y-2 text-sm">
                <div className="rounded-md border p-2">
                  <div className="text-xs text-muted-foreground">Stays, corrected</div>
                  <div className="font-medium">{describeSide(keep, when)}</div>
                </div>
                <div className="rounded-md border border-dashed p-2 opacity-80">
                  <div className="text-xs text-muted-foreground">
                    Its numbers are used, then it is deleted
                  </div>
                  <div className="font-medium">{describeSide(from, when)}</div>
                </div>
              </div>
            );
          })()}
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setMergeDialogOpen(false)}
              disabled={bulkPending}
            >
              Cancel
            </Button>
            <Button
              disabled={bulkPending || !mergeChoice}
              onClick={() =>
                startBulk(async () => {
                  if (!mergeChoice) return;
                  const res = await mergeTrades(
                    mergeChoice.keepId,
                    mergeChoice.fillsFromId,
                  );
                  if (!res.ok) {
                    toast.error(res.error);
                    return;
                  }
                  toast.success("Merged into one trade");
                  setMergeDialogOpen(false);
                  setRowSelection({});
                  router.refresh();
                })
              }
            >
              Merge
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* One trade. It used to go on a single menu click with no question —
          fills, rule answers and snapshots included. */}
      <Dialog
        open={rowToDelete != null}
        onOpenChange={(v) => {
          if (!v) setRowToDelete(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Delete trade
              {rowToDelete?.trade_no != null ? ` #${rowToDelete.trade_no}` : ""}
              {rowToDelete?.instrument ? ` (${rowToDelete.instrument as string})` : ""}?
            </DialogTitle>
            <DialogDescription>
              This cannot be undone. Its fills, rule answers and chart snapshots
              are deleted with it.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRowToDelete(null)} disabled={bulkPending}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={bulkPending}
              onClick={() =>
                startBulk(async () => {
                  if (!rowToDelete) return;
                  const res = await deleteTrade(rowToDelete.id);
                  if (!res.ok) {
                    toast.error(res.error);
                    return;
                  }
                  toast.success("Trade deleted");
                  setRowToDelete(null);
                  router.refresh();
                })
              }
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Delete {selectedIds.length} trade{selectedIds.length === 1 ? "" : "s"}?
            </DialogTitle>
            <DialogDescription>
              This cannot be undone. Executions, images and chart snapshots on
              these trades are deleted with them.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setDeleteDialogOpen(false)}
              disabled={bulkPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={bulkPending}
              onClick={() =>
                startBulk(async () => {
                  const res = await bulkDeleteTrades(selectedIds);
                  if (!res.ok) {
                    toast.error(res.error);
                    return;
                  }
                  toast.success(
                    `${res.deleted} trade${res.deleted === 1 ? "" : "s"} deleted`,
                  );
                  setDeleteDialogOpen(false);
                  setRowSelection({});
                  router.refresh();
                })
              }
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={tagDialogOpen}
        onOpenChange={(v) => {
          setTagDialogOpen(v);
          if (!v) setTagValues([]);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Add tag to {selectedIds.length} trade{selectedIds.length === 1 ? "" : "s"}
            </DialogTitle>
            <DialogDescription>
              Applied on top of whatever each trade already carries — existing
              tags are never removed.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Select
              value={tagKind}
              onValueChange={(v) => {
                setTagKind(v as BulkTagKind);
                setTagValues([]);
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BULK_TAG_CATEGORIES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <TagMultiSelect
              value={tagValues}
              onChange={setTagValues}
              optionsMap={optionsMap}
              listKey={BULK_TAG_CATEGORIES.find((c) => c.value === tagKind)?.listKey}
              listKeys={BULK_TAG_CATEGORIES.find((c) => c.value === tagKind)?.listKeys}
            />
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setTagDialogOpen(false)}
              disabled={bulkPending}
            >
              Cancel
            </Button>
            <Button
              disabled={bulkPending || tagValues.length === 0}
              onClick={() =>
                startBulk(async () => {
                  const res = await bulkAddTag(selectedIds, tagKind, tagValues);
                  if (!res.ok) {
                    toast.error(res.error);
                    return;
                  }
                  toast.success(
                    `Tagged ${selectedIds.length} trade${selectedIds.length === 1 ? "" : "s"}`,
                  );
                  setTagDialogOpen(false);
                  setTagValues([]);
                  router.refresh();
                })
              }
            >
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * What the rows on screen add up to — the question a filtered list is usually
 * opened to answer ("how do my A+ longs on NQ actually do?"). Closed trades
 * only; see `summarizeTrades`.
 */
function SummaryBar({ summary }: { summary: ReturnType<typeof summarizeTrades> }) {
  const s = summary.stats;
  const cur = summary.currency;
  const money = (v: number | null | undefined, sign = false) =>
    cur ? fmtMoney(v, cur, { sign }) : "—";
  const mixed = cur == null && summary.closed > 0;
  const winRate = s ? winRateOf(s.wins, s.losses) : null;
  const pf = s?.profitFactor;

  const extra = [
    summary.live > 0 ? `${summary.live} open` : null,
    summary.notTaken > 0 ? `${summary.notTaken} planned/missed` : null,
  ].filter(Boolean);

  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-3 lg:grid-cols-6">
      <SummaryCell
        label="Closed trades"
        value={String(summary.closed)}
        sub={extra.length > 0 ? extra.join(" · ") : undefined}
      />
      <SummaryCell
        label="Win rate"
        value={winRate != null ? fmtPct(winRate, 1) : "—"}
        sub={s ? `${s.wins}W · ${s.losses}L · ${s.breakeven}BE` : undefined}
      />
      <SummaryCell
        label="Net P/L"
        value={money(s?.netSum, true)}
        valueClass={cur ? pnlClass(s?.netSum) : undefined}
        sub={mixed ? "Mixed currencies — filter to one account" : undefined}
      />
      <SummaryCell
        label="Profit factor"
        value={pf == null ? "—" : Number.isFinite(pf) ? fmtNum(pf, 2) : "∞"}
      />
      <SummaryCell
        label="Expectancy"
        value={s && s.expectancySample > 0 ? fmtR(s.expectancy) : "—"}
        valueClass={s && s.expectancySample > 0 ? pnlClass(s.expectancy) : undefined}
        sub={s && s.expectancySample > 0 ? `per trade, ${s.expectancySample} with R` : undefined}
      />
      <SummaryCell
        label="Avg win / loss"
        value={
          s && (s.wins > 0 || s.losses > 0)
            ? `${money(s.wins > 0 ? s.avgWinMoney : null)} / ${money(s.losses > 0 ? s.avgLossMoney : null)}`
            : "—"
        }
      />
    </div>
  );
}

function SummaryCell({
  label,
  value,
  sub,
  valueClass,
}: {
  label: string;
  value: string;
  sub?: string;
  valueClass?: string;
}) {
  return (
    <div className="bg-card px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("text-base font-semibold tabular-nums", valueClass)}>{value}</div>
      {sub && <div className="truncate text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={cn("h-9 w-auto min-w-28 gap-1", className)}>
        <span className="text-muted-foreground">{label}:</span>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function RowActions({ id, onDelete }: { id: string; onDelete: () => void }) {
  const router = useRouter();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8" aria-label="Trade actions">
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => router.push(`/trades/${id}/edit`)}>
          <Pencil className="size-4" /> Edit
        </DropdownMenuItem>
        <DropdownMenuItem className="text-destructive" onClick={onDelete}>
          <Trash2 className="size-4" /> Delete…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function downloadBlob(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
