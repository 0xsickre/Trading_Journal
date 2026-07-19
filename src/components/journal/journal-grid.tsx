"use client";

import { useMemo, useState } from "react";
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
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import type { Account, TradeRow } from "@/lib/journal/types";
import { fmtInTz } from "@/lib/journal/time";
import { fmtMoney, fmtNum, fmtR, pnlClass } from "@/lib/journal/format";
import { fmtSlippageR, slippageFromTrade } from "@/lib/journal/entry-slippage";
import { ARRAY_FIELD_NAMES, getAllFormFields } from "@/lib/journal/form-config";
import { deleteTrade } from "@/app/(app)/trades/actions";

const FILTERS: { key: string; label: string }[] = [
  { key: "instrument", label: "Instrument" },
  { key: "direction", label: "Direction" },
  { key: "setup_grade", label: "Grade" },
  { key: "ict_entry_model", label: "Model" },
  { key: "result", label: "Result" },
  { key: "status", label: "Status" },
];

function distinct(rows: TradeRow[], key: string): string[] {
  const set = new Set<string>();
  for (const r of rows) {
    const v = r[key];
    if (ARRAY_FIELD_NAMES.has(key) && Array.isArray(v)) {
      for (const tag of v) if (typeof tag === "string" && tag) set.add(tag);
    } else if (typeof v === "string" && v) set.add(v);
  }
  return [...set].sort();
}

function fieldMatchesFilter(row: TradeRow, key: string, value: string): boolean {
  const raw = row[key];
  if (ARRAY_FIELD_NAMES.has(key)) {
    return Array.isArray(raw) && raw.includes(value);
  }
  return raw === value;
}

export function JournalGrid({
  trades,
  accounts,
}: {
  trades: TradeRow[];
  accounts: Account[];
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

  const filtered = useMemo(() => {
    return trades.filter((t) => {
      if (accountFilter !== "all" && t.account_id !== accountFilter) return false;
      for (const [k, v] of Object.entries(filters)) {
        if (v && v !== "all" && !fieldMatchesFilter(t, k, v)) return false;
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
  }, [trades, accountFilter, filters, search]);

  function tzOf(t: TradeRow) {
    return (t.account_id && tzByAccount.get(t.account_id)) || "America/New_York";
  }
  function curOf(t: TradeRow) {
    return (t.account_id && currencyByAccount.get(t.account_id)) || "USD";
  }

  const columns = useMemo<ColumnDef<TradeRow>[]>(
    () => [
      {
        accessorKey: "trade_no",
        header: "#",
        cell: ({ row }) => row.original.trade_no ?? "—",
      },
      {
        id: "date",
        header: ({ column }) => (
          <SortBtn column={column} label="Date (NY)" />
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
        header: "Instrument",
        cell: ({ row }) => (
          <span className="font-mono">{(row.original.instrument as string) ?? "—"}</span>
        ),
      },
      {
        accessorKey: "direction",
        header: "Dir",
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
        header: "Grade",
        cell: ({ row }) => (row.original.setup_grade as string) ?? "—",
      },
      {
        id: "size",
        header: "Size",
        accessorFn: (r) => r.stats?.entry_qty ?? null,
        cell: ({ row }) => fmtNum(row.original.stats?.entry_qty, 2),
      },
      {
        id: "avg_entry",
        header: "Entry",
        accessorFn: (r) => r.stats?.avg_entry ?? null,
        cell: ({ row }) => fmtNum(row.original.stats?.avg_entry, 2),
      },
      {
        id: "slippage_r",
        header: ({ column }) => <SortBtn column={column} label="Slip R" />,
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
        header: "Exit",
        accessorFn: (r) => r.stats?.avg_exit ?? null,
        cell: ({ row }) => fmtNum(row.original.stats?.avg_exit, 2),
      },
      {
        id: "r",
        header: ({ column }) => <SortBtn column={column} label="R" />,
        accessorFn: (r) => r.stats?.realized_r ?? null,
        cell: ({ row }) => (
          <span className={pnlClass(row.original.stats?.realized_r)}>
            {fmtR(row.original.stats?.realized_r)}
          </span>
        ),
      },
      {
        id: "gross",
        header: ({ column }) => <SortBtn column={column} label="Gross" />,
        accessorFn: (r) => r.stats?.gross_pl ?? null,
        cell: ({ row }) => (
          <span className={pnlClass(row.original.stats?.gross_pl)}>
            {fmtMoney(row.original.stats?.gross_pl, curOf(row.original), { sign: true })}
          </span>
        ),
      },
      {
        id: "net",
        header: ({ column }) => <SortBtn column={column} label="Net" />,
        accessorFn: (r) => r.stats?.net_pl ?? null,
        cell: ({ row }) => (
          <span className={`font-medium ${pnlClass(row.original.stats?.net_pl)}`}>
            {fmtMoney(row.original.stats?.net_pl, curOf(row.original), { sign: true })}
          </span>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => {
          const t = row.original;
          return (
            <div className="flex items-center gap-1">
              <Badge variant="secondary">{t.status}</Badge>
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
          const url = ((row.original.chart_url as string) ?? "").trim();
          if (!/^https?:\/\//i.test(url)) return null;
          return (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex text-muted-foreground hover:text-foreground"
              title="Open TradingView chart"
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
          <RowActions id={row.original.id} onDeleted={() => router.refresh()} />
        ),
      },
    ],
    [tzByAccount, currencyByAccount, router],
  );

  const table = useReactTable({
    data: filtered,
    columns,
    state: { sorting },
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
      for (const f of getAllFormFields()) {
        const val = t[f.name];
        o[f.label] =
          ARRAY_FIELD_NAMES.has(f.name) && Array.isArray(val)
            ? val.join(", ")
            : ((val as string) ?? "");
      }
      o["Planned R:R"] = (t.planned_rr as string) ?? "";
      o["Planned Size"] = t.position_size ?? "";
      o["Avg Entry"] = t.stats?.avg_entry ?? "";
      o["Slip R"] = fmtSlippageR(slippageFromTrade(t)?.slippageR);
      o["Avg Exit"] = t.stats?.avg_exit ?? "";
      o["Size"] = t.stats?.entry_qty ?? "";
      o["R"] = t.stats?.realized_r ?? "";
      o["Gross P/L"] = t.stats?.gross_pl ?? "";
      o["Net P/L"] = t.stats?.net_pl ?? "";
      o["Status"] = t.status;
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
            options={distinct(trades, f.key).map((v) => ({ value: v, label: v }))}
          />
        ))}
        <div className="ml-auto flex gap-2">
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

function RowActions({ id, onDeleted }: { id: string; onDeleted: () => void }) {
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
