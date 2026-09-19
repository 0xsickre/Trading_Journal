"use client";

import { useMemo, useState } from "react";
import { Filter, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DIMENSION_GROUP_LABELS,
  DIMENSION_GROUP_ORDER,
  bucketLabel,
  bucketsOf,
  type Dimension,
  type DimensionContext,
} from "@/lib/journal/reports/dimensions";
import { NUMERIC_FIELD_LABELS, type FilterClause } from "@/lib/journal/reports/filters";
import type { EnrichedTrade } from "@/lib/journal/enriched-trade";

type Op = "in" | "notIn" | "isSet" | "isNotSet";

const OP_LABELS: Record<Op, string> = {
  in: "is",
  notIn: "is not",
  isSet: "has a value",
  isNotSet: "has no value",
};

/** "-1,5" and "1.5" both read; anything that is not a finite number is empty. */
function parseBound(raw: string): number | undefined {
  const t = raw.trim().replace(",", ".");
  if (t === "") return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * The values a dimension actually takes in the book, in the dimension's own
 * order — grades A+ → C, weekdays Monday → Sunday, months oldest first — and
 * alphabetically only when it has none. "(none)" last.
 */
function orderedValues(dim: Dimension, seen: Set<string>): string[] {
  const values = [...seen];
  const rank = dim.order ? new Map(dim.order.map((k, i) => [k, i])) : null;
  return values.sort((a, b) => {
    if (a === "—") return 1;
    if (b === "—") return -1;
    if (rank) {
      const d = (rank.get(a) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b) ?? Number.MAX_SAFE_INTEGER);
      if (d !== 0) return d;
    }
    return a.localeCompare(b);
  });
}

/**
 * Filters over any dimension or number.
 *
 * A new filter is built HERE, in local state, and reaches the report only once
 * it constrains something. It used to be written into the URL the moment "Add"
 * was clicked, with no value yet — and the URL reader, rightly, drops an "is"
 * with nothing in it, so the row vanished before a value could be picked. The
 * same for numbers: a bound is typed as text and read on "Add", so `-1.5` can
 * be typed through `-` and `-1.` without either being thrown away.
 *
 * Negation is a peer of inclusion ("is not"), not a checkbox bolted on —
 * "everything except the revenge trades" is how most interesting questions are
 * asked.
 */
export function FilterBar({
  clauses,
  onChange,
  trades,
  dimensionContext,
  dimensions,
}: {
  clauses: FilterClause[];
  onChange: (next: FilterClause[]) => void;
  /** The book in scope — the values offered are the ones it actually has. */
  trades: EnrichedTrade[];
  dimensionContext: DimensionContext;
  dimensions: Dimension[];
}) {
  const [open, setOpen] = useState(false);
  const [field, setField] = useState(dimensions[0]?.key ?? "instrument");
  const [op, setOp] = useState<Op>("in");
  const [picked, setPicked] = useState<string[]>([]);
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");

  const dimByKey = useMemo(() => new Map(dimensions.map((d) => [d.key, d])), [dimensions]);
  const isNumeric = field in NUMERIC_FIELD_LABELS;
  const dim = dimByKey.get(field);

  // Only the field being built — bucketing every dimension over the whole book
  // on each render was the page's most expensive line for a dropdown.
  const values = useMemo(() => {
    if (!dim) return [];
    const seen = new Set<string>();
    for (const t of trades) for (const b of bucketsOf(dim, t, dimensionContext)) seen.add(b);
    return orderedValues(dim, seen);
  }, [dim, trades, dimensionContext]);

  const labelOf = (key: string) =>
    dimByKey.get(key)?.label ?? NUMERIC_FIELD_LABELS[key] ?? key;

  const draft: FilterClause | null = isNumeric
    ? parseBound(min) != null || parseBound(max) != null
      ? { field, op: "between", min: parseBound(min), max: parseBound(max) }
      : null
    : op === "isSet" || op === "isNotSet"
      ? { field, op }
      : picked.length > 0
        ? { field, op, values: picked }
        : null;

  function chooseField(next: string) {
    setField(next);
    setPicked([]);
    setMin("");
    setMax("");
  }

  function add() {
    if (!draft) return;
    onChange([...clauses, draft]);
    setPicked([]);
    setMin("");
    setMax("");
  }

  const describe = (c: FilterClause): string => {
    const d = dimByKey.get(c.field);
    if (c.op === "between") {
      const lo = c.min != null ? `≥ ${c.min}` : "";
      const hi = c.max != null ? `≤ ${c.max}` : "";
      return `${labelOf(c.field)} ${[lo, hi].filter(Boolean).join(" and ")}`;
    }
    if (c.op === "in" || c.op === "notIn") {
      return `${labelOf(c.field)} ${OP_LABELS[c.op]} ${c.values.map((v) => bucketLabel(d, v)).join(", ")}`;
    }
    return `${labelOf(c.field)} ${OP_LABELS[c.op]}`;
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={open ? "secondary" : "outline"}
          size="sm"
          className="h-9"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          <Filter className="size-3.5" />
          Filters
          {clauses.length > 0 && (
            <span className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground">
              {clauses.length}
            </span>
          )}
        </Button>
        {clauses.map((c, i) => (
          <span
            key={`${c.field}:${c.op}:${i}`}
            className="inline-flex items-center gap-1 rounded-full border bg-muted/40 py-0.5 pr-1 pl-2.5 text-xs"
          >
            {describe(c)}
            <button
              type="button"
              onClick={() => onChange(clauses.filter((_, x) => x !== i))}
              aria-label={`Remove filter: ${describe(c)}`}
              className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
      </div>

      {open && (
        <div className="space-y-3 rounded-lg border bg-card p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={field} onValueChange={chooseField}>
              <SelectTrigger className="h-9 w-52" aria-label="Filter field">
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
                <SelectGroup>
                  <SelectLabel>Numbers</SelectLabel>
                  {Object.entries(NUMERIC_FIELD_LABELS).map(([k, label]) => (
                    <SelectItem key={k} value={k}>
                      {label} (range)
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>

            {isNumeric ? (
              <>
                <Input
                  inputMode="decimal"
                  placeholder="min"
                  value={min}
                  onChange={(e) => setMin(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && add()}
                  className="h-9 w-24"
                  aria-label="Minimum"
                />
                <span className="text-xs text-muted-foreground">to</span>
                <Input
                  inputMode="decimal"
                  placeholder="max"
                  value={max}
                  onChange={(e) => setMax(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && add()}
                  className="h-9 w-24"
                  aria-label="Maximum"
                />
              </>
            ) : (
              <Select value={op} onValueChange={(v) => setOp(v as Op)}>
                <SelectTrigger className="h-9 w-36" aria-label="Filter condition">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(OP_LABELS) as Op[]).map((o) => (
                    <SelectItem key={o} value={o}>
                      {OP_LABELS[o]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            <Button size="sm" className="h-9" onClick={add} disabled={!draft}>
              <Plus className="size-3.5" /> Add
            </Button>
          </div>

          {!isNumeric && (op === "in" || op === "notIn") && (
            <div className="flex flex-wrap gap-1.5">
              {values.length === 0 ? (
                <span className="text-xs text-muted-foreground">No values in this book.</span>
              ) : (
                values.map((v) => {
                  const on = picked.includes(v);
                  return (
                    <button
                      key={v}
                      type="button"
                      aria-pressed={on}
                      onClick={() =>
                        setPicked((p) => (on ? p.filter((x) => x !== v) : [...p, v]))
                      }
                      className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
                        on
                          ? "border-primary bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {bucketLabel(dim, v)}
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
