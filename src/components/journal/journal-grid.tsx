"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type ColumnDef,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  ArrowUpDown,
  Columns3,
  Download,
  MoreHorizontal,
  Pencil,
  Trash2,
  AlertTriangle,
  ExternalLink,
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { dimensionsByGroup, getDimension } from "@/lib/journal/reports/dimensions";
import {
  classifyOutcome,
  resolveBreakevenRange,
  EXACT_ZERO_RANGE,
} from "@/lib/journal/breakeven";
import { Badge } from "@/components/ui/badge";
import type { Account, TradeRow } from "@/lib/journal/types";
import { fmtInTz } from "@/lib/journal/time";
import { fmtMoney, fmtNum, fmtR, pnlClass } from "@/lib/journal/format";
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
  stringFieldValue,
} from "@/lib/journal/field-values";
import { deleteTrade, activateTrade } from "@/app/(app)/trades/actions";
import { setJournalHiddenColumns } from "@/app/(app)/journal/actions";
import {
  hiddenToVisibility,
  toggleHidden,
  visibleCount,
} from "@/lib/journal/column-prefs";
import {
  formatLifecycleStatusLabel,
  lifecycleStatusHint,
} from "@/lib/journal/trade-lifecycle";

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

/**
 * Grid filters come from the dimension registry, so a label is written once.
 *
 * Most of them filter on the RAW column value (see `fieldMatchesFilter`), which
 * is why only trade-column dimensions qualify — a derived bucket like "1–3d" is
 * not a value any row stores.
 *
 * `outcome` is the one exception, and it is here on purpose: it replaced the
 * manual `result` column, which was dropped for duplicating it. Win / loss /
 * breakeven fall out of net P&L against the account's breakeven band, so the
 * value has to be COMPUTED per row rather than read — hence its own branch in
 * `filtered` and its own fixed option list below.
 */
const FILTER_KEYS = new Set([
  "instrument",
  "direction",
  "setup_grade",
  "ict_entry_model",
  "status",
]);

const OUTCOME_KEY = "outcome";
const outcomeDimension = getDimension(OUTCOME_KEY);

const FILTERS: { key: string; label: string; options?: readonly string[] }[] = [
  ...dimensionsByGroup("trade")
    .filter((d) => FILTER_KEYS.has(d.key))
    .map((d) => ({ key: d.key, label: d.label })),
  ...(outcomeDimension
    ? [
        {
          key: OUTCOME_KEY,
          label: outcomeDimension.label,
          // `distinct()` has nothing to read for a derived value, so the
          // buckets come from the dimension's own declared order.
          options: outcomeDimension.order ?? ["win", "breakeven", "loss"],
        },
      ]
    : []),
];

function distinct(rows: TradeRow[], key: string): string[] {
  const set = new Set<string>();
  for (const r of rows) {
    const tags = arrayFieldValue(r, key);
    if (tags) for (const tag of tags) set.add(tag);
    else {
      const v = stringFieldValue(r, key);
      if (v) set.add(v);
    }
  }
  return [...set].sort();
}

function fieldMatchesFilter(row: TradeRow, key: string, value: string): boolean {
  const tags = arrayFieldValue(row, key);
  if (tags) return tags.includes(value);
  return stringFieldValue(row, key) === value;
}

/**
 * Every column the user may switch off, and its name.
 *
 * This map does three jobs at once, which is the point: it labels the headers
 * below, it labels the picker, and **membership in it is what makes a column
 * hideable**. A column absent from here — `actions`, the row menu — simply
 * cannot be turned off, with no separate flag to keep in step.
 *
 * Labels live here rather than inline in each header so the name is written
 * once; the picker and the column heading cannot drift apart.
 */
const COLUMN_LABELS: Record<string, string> = {
  trade_no: "#",
  date: "Date (NY)",
  instrument: "Instrument",
  direction: "Dir",
  setup_grade: "Grade",
  size: "Size",
  avg_entry: "Entry",
  slippage_r: "Slip R",
  avg_exit: "Exit",
  r: "R",
  exit_eff: "Target %",
  capture: "Capture %",
  gross: "Gross",
  net: "Net",
  status: "Status",
  chart: "Grafikon",
};

const HIDEABLE_COLUMNS = Object.keys(COLUMN_LABELS);

export function JournalGrid({
  trades,
  accounts,
  fieldDefs = [],
  hiddenColumns = [],
}: {
  trades: TradeRow[];
  accounts: Account[];
  /** User-defined fields, so the export carries them like any other column. */
  fieldDefs?: FieldDef[];
  /** Columns the user switched off, from tj_user_prefs. */
  hiddenColumns?: string[];
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

  const [search, setSearch] = useState("");
  const [accountFilter, setAccountFilter] = useState<string>("all");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [sorting, setSorting] = useState<SortingState>([]);

  // Optimistic: the column disappears on click and the save follows. A round
  // trip before the grid reacts would read as a dead checkbox.
  const [hidden, setHidden] = useState<string[]>(hiddenColumns);
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
    setHidden(next);
    void setJournalHiddenColumns(next).then((res) => {
      if (!res.ok) {
        setHidden(hidden);
        toast.error(res.error);
      }
    });
  }

  /**
   * Breakeven band per account, for the outcome filter.
   *
   * Per account and not one global band: the same −$40 is a breakeven trade on
   * an account whose band reaches −$50 and a loss on one that does not, and
   * collapsing the two would classify a trade by whichever account happened to
   * be first.
   */
  const rangeByAccount = useMemo(
    () => new Map(accounts.map((a) => [a.id, resolveBreakevenRange(a)])),
    [accounts],
  );

  const outcomeOf = useCallback(
    (t: TradeRow): "win" | "loss" | "breakeven" | null => {
      const net = t.stats?.net_pl;
      // An open or missed trade has no outcome yet. Null excludes it from every
      // outcome bucket rather than parking it in "loss" at 0.
      if (net == null) return null;
      const range =
        (t.account_id ? rangeByAccount.get(t.account_id) : null) ??
        EXACT_ZERO_RANGE;
      return classifyOutcome(net, range);
    },
    [rangeByAccount],
  );

  const filtered = useMemo(() => {
    return trades.filter((t) => {
      if (accountFilter !== "all" && t.account_id !== accountFilter) return false;
      for (const [k, v] of Object.entries(filters)) {
        if (!v || v === "all") continue;
        if (k === OUTCOME_KEY) {
          if (outcomeOf(t) !== v) return false;
          continue;
        }
        if (!fieldMatchesFilter(t, k, v)) return false;
      }
      if (search.trim()) {
        const q = search.toLowerCase();
        const tagHay = ["technical_tags", "psychology_tags"]
          .flatMap((k) => {
            const v = t[k];
            return Array.isArray(v) ? v : [];
          })
          .filter((x): x is string => typeof x === "string");
        const hay = [
          t.instrument,
          t.trade_journal_notes,
          t.ict_entry_model,
          t.setup_grade,
          ...tagHay,
        ]
          .filter((x) => typeof x === "string")
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [trades, accountFilter, filters, search, outcomeOf]);

  const tzOf = useCallback(
    (t: TradeRow) =>
      (t.account_id && tzByAccount.get(t.account_id)) || "America/New_York",
    [tzByAccount],
  );
  const curOf = useCallback(
    (t: TradeRow) => (t.account_id && currencyByAccount.get(t.account_id)) || "USD",
    [currencyByAccount],
  );

  const columns = useMemo<ColumnDef<TradeRow>[]>(
    () => [
      {
        accessorKey: "trade_no",
        header: COLUMN_LABELS.trade_no,
        cell: ({ row }) => row.original.trade_no ?? "—",
      },
      {
        id: "date",
        header: ({ column }) => (
          <SortBtn column={column} label={COLUMN_LABELS.date} />
        ),
        accessorFn: (r) => r.stats?.opened_at ?? r.created_at,
        cell: ({ row }) => {
          const t = row.original;
          const d = t.stats?.opened_at ?? t.created_at;
          return (
            <span className="whitespace-nowrap">
              {fmtInTz(d, tzOf(t), "MM/dd HH:mm")}
            </span>
          );
        },
      },
      {
        accessorKey: "instrument",
        header: COLUMN_LABELS.instrument,
        cell: ({ row }) => {
          // A trade whose instrument can no longer be resolved has no point value,
          // so the view returns null money rather than pricing it in raw points.
          // Say so here instead of letting the P/L column render a bare dash.
          const unpriced = row.original.stats?.point_value_source === "missing";
          return (
            <span className="flex items-center gap-1.5">
              <span className="font-mono">
                {(row.original.instrument as string) ?? "—"}
              </span>
              {unpriced && (
                <Badge
                  variant="outline"
                  className="text-[var(--loss)]"
                  title="No instrument definition for this symbol, so its point value is unknown and P/L cannot be calculated. Add the instrument in Settings."
                >
                  unpriced
                </Badge>
              )}
            </span>
          );
        },
      },
      {
        accessorKey: "direction",
        header: COLUMN_LABELS.direction,
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
        accessorKey: "setup_grade",
        header: COLUMN_LABELS.setup_grade,
        cell: ({ row }) => (row.original.setup_grade as string) ?? "—",
      },
      {
        id: "size",
        header: COLUMN_LABELS.size,
        accessorFn: (r) => r.stats?.entry_qty ?? null,
        cell: ({ row }) => fmtNum(row.original.stats?.entry_qty, 2),
      },
      {
        id: "avg_entry",
        header: COLUMN_LABELS.avg_entry,
        accessorFn: (r) => r.stats?.avg_entry ?? null,
        cell: ({ row }) => fmtNum(row.original.stats?.avg_entry, 2),
      },
      {
        id: "slippage_r",
        header: ({ column }) => <SortBtn column={column} label={COLUMN_LABELS.slippage_r} />,
        accessorFn: (r) => slippageFromTrade(r)?.slippageR ?? null,
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
        accessorFn: (r) => r.stats?.avg_exit ?? null,
        cell: ({ row }) => fmtNum(row.original.stats?.avg_exit, 2),
      },
      {
        id: "r",
        header: ({ column }) => <SortBtn column={column} label={COLUMN_LABELS.r} />,
        accessorFn: (r) => r.stats?.realized_r ?? null,
        cell: ({ row }) => (
          <span className={pnlClass(row.original.stats?.realized_r)}>
            {fmtR(row.original.stats?.realized_r)}
          </span>
        ),
      },
      {
        id: "exit_eff",
        header: ({ column }) => <SortBtn column={column} label={COLUMN_LABELS.exit_eff} />,
        accessorFn: (r) => exitEfficiencyFromTrade(r)?.pct ?? null,
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
        header: ({ column }) => <SortBtn column={column} label={COLUMN_LABELS.capture} />,
        accessorFn: (r) => excursionFromTrade(r).capturePct,
        cell: ({ row }) => {
          // Null means the trade carries no MFE price, or never went in favour
          // at all — either way there is no peak to have captured a share of, and
          // a 0 % would read as "gave it all back".
          const pct = excursionFromTrade(row.original).capturePct;
          if (pct == null) return "—";
          return (
            // 100 % is the whole move, so the midpoint is the natural neutral —
            // same treatment the Target % column already gives its own scale.
            <span className={pnlClass(pct - 50)}>{fmtNum(pct, 0)}%</span>
          );
        },
      },
      {
        id: "gross",
        header: ({ column }) => <SortBtn column={column} label={COLUMN_LABELS.gross} />,
        accessorFn: (r) => r.stats?.gross_pl ?? null,
        cell: ({ row }) => (
          <span className={pnlClass(row.original.stats?.gross_pl)}>
            {fmtMoney(row.original.stats?.gross_pl, curOf(row.original), { sign: true })}
          </span>
        ),
      },
      {
        id: "net",
        header: ({ column }) => <SortBtn column={column} label={COLUMN_LABELS.net} />,
        accessorFn: (r) => r.stats?.net_pl ?? null,
        cell: ({ row }) => (
          <span className={`font-medium ${pnlClass(row.original.stats?.net_pl)}`}>
            {fmtMoney(row.original.stats?.net_pl, curOf(row.original), { sign: true })}
          </span>
        ),
      },
      {
        accessorKey: "status",
        header: COLUMN_LABELS.status,
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
        cell: ({ row }) => (
          <RowActions
            id={row.original.id}
            status={String(row.original.status)}
            onDeleted={() => router.refresh()}
          />
        ),
      },
    ],
    [tzOf, curOf, router],
  );

  const table = useReactTable({
    data: filtered,
    columns,
    // Visibility is controlled from `hidden` and never from the table's own API,
    // so there is deliberately no onColumnVisibilityChange: the picker is the
    // only writer, and it saves as it goes.
    state: { sorting, columnVisibility },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  function exportData(kind: "csv" | "xlsx") {
    const rows = filtered.map((t) => {
      const o: Record<string, unknown> = {
        "Trade #": t.trade_no ?? "",
        Date: fmtInTz(t.stats?.opened_at ?? t.created_at, tzOf(t), "yyyy-MM-dd HH:mm"),
      };
      for (const f of getAllFormFields(fieldDefs))
        o[f.label] = displayFieldValue(t, f.name);
      o["Planned R:R"] = (t.planned_rr as string) ?? "";
      o["Planned Size"] = t.position_size ?? "";
      o["Avg Entry"] = t.stats?.avg_entry ?? "";
      o["Slip R"] = fmtSlippageR(slippageFromTrade(t)?.slippageR);
      o["Avg Exit"] = t.stats?.avg_exit ?? "";
      o["Size"] = t.stats?.entry_qty ?? "";
      o["R"] = t.stats?.realized_r ?? "";
      o["Target attainment %"] = fmtExitEfficiencyPct(exitEfficiencyFromTrade(t)?.pct);
      // MAE and MFE ride along with the capture: the mentor reading the export
      // cannot judge "captured 40 %" without knowing how big the peak was.
      const excursion = excursionFromTrade(t);
      o["MAE R"] = excursion.maeR ?? "";
      o["MFE R"] = excursion.mfeR ?? "";
      o["MFE capture %"] =
        excursion.capturePct == null ? "" : fmtNum(excursion.capturePct, 0);
      o["Gross P/L"] = t.stats?.gross_pl ?? "";
      o["Net P/L"] = t.stats?.net_pl ?? "";
      o["Status"] = t.status;
      o["Miss reason"] = (t.miss_reason as string) ?? "";
      o["Missed at"] = (t.missed_at as string) ?? "";
      return o;
    });
    if (rows.length === 0) {
      toast.error("Nothing to export");
      return;
    }
    if (kind === "csv") {
      import("papaparse").then((Papa) => {
        const csv = Papa.default.unparse(rows);
        downloadBlob(csv, "journal.csv", "text/csv;charset=utf-8;");
      });
    } else {
      import("xlsx").then((XLSX) => {
        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Journal");
        XLSX.writeFile(wb, "journal.xlsx");
      });
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Search notes, model…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-9 w-48"
        />
        {accounts.length > 1 && (
          <FilterSelect
            label="Account"
            value={accountFilter}
            onChange={setAccountFilter}
            options={accounts.map((a) => ({ value: a.id, label: a.name }))}
          />
        )}
        {FILTERS.map((f) => (
          <FilterSelect
            key={f.key}
            label={f.label}
            value={filters[f.key] ?? "all"}
            onChange={(v) => setFilters((p) => ({ ...p, [f.key]: v }))}
            options={(f.options ?? distinct(trades, f.key)).map((v) => ({
              value: v,
              label: v,
            }))}
          />
        ))}
        <Button
          type="button"
          variant={filters.status === "missed" ? "default" : "outline"}
          size="sm"
          className="h-9"
          onClick={() =>
            setFilters((p) => ({
              ...p,
              status: p.status === "missed" ? "all" : "missed",
            }))
          }
        >
          Missed
        </Button>
        <div className="ml-auto flex gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Columns3 className="size-4" /> Kolone
                {hidden.length > 0 && (
                  <Badge variant="secondary" className="ml-1">
                    {visibleCount(hidden, HIDEABLE_COLUMNS)}/
                    {HIDEABLE_COLUMNS.length}
                  </Badge>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
              {HIDEABLE_COLUMNS.map((id) => {
                const on = !hidden.includes(id);
                // The last one on cannot be switched off; `toggleHidden` refuses
                // it too, but a checkbox that silently does nothing is worse than
                // one that is visibly unavailable.
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
          <Button variant="outline" size="sm" onClick={() => exportData("csv")}>
            <Download className="size-4" /> CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => exportData("xlsx")}>
            <Download className="size-4" /> Excel
          </Button>
        </div>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((h) => (
                  <TableHead key={h.id} className="whitespace-nowrap">
                    {h.isPlaceholder
                      ? null
                      : flexRender(h.column.columnDef.header, h.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-32 text-center text-muted-foreground">
                  No trades yet.{" "}
                  <Link href="/trades/new" className="underline">
                    Log your first trade
                  </Link>
                  .
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer"
                  onClick={() => router.push(`/trades/${row.original.id}/edit`)}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      onClick={(e) => {
                        if (cell.column.id === "actions") e.stopPropagation();
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
      <p className="text-xs text-muted-foreground">
        {filtered.length} of {trades.length} trades. Click a row to edit.
      </p>
    </div>
  );
}

function SortBtn({
  column,
  label,
}: {
  column: { toggleSorting: (d?: boolean) => void; getIsSorted: () => false | "asc" | "desc" };
  label: string;
}) {
  return (
    <button
      className="inline-flex items-center gap-1"
      onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
    >
      {label}
      <ArrowUpDown className="size-3" />
    </button>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-9 w-auto min-w-28 gap-1">
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

function RowActions({
  id,
  status,
  onDeleted,
}: {
  id: string;
  status: string;
  onDeleted: () => void;
}) {
  const router = useRouter();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8">
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => router.push(`/trades/${id}/edit`)}>
          <Pencil className="size-4" /> Edit
        </DropdownMenuItem>
        {status === "planned" && (
          <DropdownMenuItem
            onClick={async () => {
              const res = await activateTrade(id);
              if (!res.ok) toast.error(res.error);
              else {
                toast.success("Trade moved to active");
                onDeleted();
              }
            }}
          >
            Move to active
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          className="text-destructive"
          onClick={async () => {
            const res = await deleteTrade(id);
            if (!res.ok) toast.error(res.error);
            else {
              toast.success("Trade deleted");
              onDeleted();
            }
          }}
        >
          <Trash2 className="size-4" /> Delete
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
