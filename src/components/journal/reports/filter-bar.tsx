"use client";

import { useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DIMENSIONS,
  DIMENSION_GROUP_LABELS,
  DIMENSION_GROUP_ORDER,
  bucketsOf,
  type Dimension,
  type DimensionContext,
} from "@/lib/journal/reports/dimensions";
import {
  NUMERIC_FIELD_LABELS,
  activeFilterCount,
  type FilterClause,
  type FilterSet,
} from "@/lib/journal/reports/filters";
import type { EnrichedTrade } from "@/lib/journal/enriched-trade";

const OP_LABELS: Record<FilterClause["op"], string> = {
  in: "jeste",
  notIn: "is not",
  between: "between",
  isSet: "has a value",
  isNotSet: "has no value",
};

/**
 * Filter builder.
 *
 * Negation is a peer of inclusion in the operator dropdown, not a checkbox
 * bolted onto it — "excluding" is how you ask most of the interesting
 * questions ("everything except the revenge trades"), and burying it would
 * make the common case feel like an edge case.
 */
export function FilterBar({
  filters,
  onChange,
  trades,
  dimensionContext,
  dimensions = DIMENSIONS,
  accounts,
}: {
  filters: FilterSet;
  onChange: (next: FilterSet) => void;
  trades: EnrichedTrade[];
  dimensionContext: DimensionContext;
  /** Built-ins plus the user's own fields — a custom field filters like any other. */
  dimensions?: Dimension[];
  accounts: { id: string; name: string }[];
}) {
  const [draftField, setDraftField] = useState<string>(dimensions[0].key);
  const [draftOp, setDraftOp] = useState<FilterClause["op"]>("in");

  /** Values actually present in the book — never a list of what could exist. */
  const valuesFor = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const dim of dimensions) {
      const seen = new Set<string>();
      for (const t of trades) {
        for (const b of bucketsOf(dim, t, dimensionContext)) seen.add(b);
      }
      map.set(dim.key, [...seen].sort());
    }
    return map;
  }, [trades, dimensionContext, dimensions]);

  const isNumeric = draftField in NUMERIC_FIELD_LABELS;

  function addClause() {
    if (isNumeric) {
      onChange({
        ...filters,
        clauses: [...filters.clauses, { field: draftField, op: "between" }],
      });
      return;
    }
    if (draftOp === "isSet" || draftOp === "isNotSet") {
      onChange({
        ...filters,
        clauses: [...filters.clauses, { field: draftField, op: draftOp }],
      });
      return;
    }
    onChange({
      ...filters,
      clauses: [
        ...filters.clauses,
        { field: draftField, op: draftOp === "notIn" ? "notIn" : "in", values: [] },
      ],
    });
  }

  function updateClause(i: number, next: FilterClause) {
    const clauses = [...filters.clauses];
    clauses[i] = next;
    onChange({ ...filters, clauses });
  }

  function removeClause(i: number) {
    onChange({ ...filters, clauses: filters.clauses.filter((_, x) => x !== i) });
  }

  const labelOf = (field: string) =>
    dimensions.find((d) => d.key === field)?.label ??
    NUMERIC_FIELD_LABELS[field] ??
    field;

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">Filters</span>
        {activeFilterCount(filters) > 0 && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
            {activeFilterCount(filters)} aktivnih
          </span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Input
            type="date"
            value={filters.dateFrom ?? ""}
            onChange={(e) =>
              onChange({ ...filters, dateFrom: e.target.value || undefined })
            }
            className="h-8 w-auto"
            aria-label="From date"
          />
          <span className="text-xs text-muted-foreground">do</span>
          <Input
            type="date"
            value={filters.dateTo ?? ""}
            onChange={(e) =>
              onChange({ ...filters, dateTo: e.target.value || undefined })
            }
            className="h-8 w-auto"
            aria-label="To date"
          />
          <Select
            value={filters.accountIds?.[0] ?? "all"}
            onValueChange={(v) =>
              onChange({
                ...filters,
                accountIds: v === "all" ? undefined : [v],
              })
            }
          >
            <SelectTrigger className="h-8 w-auto min-w-32">
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
        </div>
      </div>

      {filters.clauses.map((c, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <span className="min-w-32 text-sm">{labelOf(c.field)}</span>

          {c.op === "between" ? (
            <>
              <Input
                inputMode="decimal"
                placeholder="min"
                value={c.min ?? ""}
                onChange={(e) =>
                  updateClause(i, {
                    ...c,
                    min: e.target.value === "" ? undefined : Number(e.target.value),
                  })
                }
                className="h-8 w-24"
              />
              <span className="text-xs text-muted-foreground">do</span>
              <Input
                inputMode="decimal"
                placeholder="max"
                value={c.max ?? ""}
                onChange={(e) =>
                  updateClause(i, {
                    ...c,
                    max: e.target.value === "" ? undefined : Number(e.target.value),
                  })
                }
                className="h-8 w-24"
              />
            </>
          ) : c.op === "in" || c.op === "notIn" ? (
            <>
              <Select
                value={c.op}
                onValueChange={(v) =>
                  updateClause(i, {
                    field: c.field,
                    op: v as "in" | "notIn",
                    values: c.values,
                  })
                }
              >
                <SelectTrigger className="h-8 w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="in">{OP_LABELS.in}</SelectItem>
                  <SelectItem value="notIn">{OP_LABELS.notIn}</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex flex-wrap gap-1">
                {(valuesFor.get(c.field) ?? []).map((v) => {
                  const on = c.values.includes(v);
                  return (
                    <button
                      key={v}
                      onClick={() =>
                        updateClause(i, {
                          field: c.field,
                          op: c.op,
                          values: on
                            ? c.values.filter((x: string) => x !== v)
                            : [...c.values, v],
                        })
                      }
                      className={`rounded-full border px-2 py-0.5 text-xs ${
                        on
                          ? "border-primary bg-primary text-primary-foreground"
                          : "text-muted-foreground"
                      }`}
                    >
                      {v}
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <span className="text-sm text-muted-foreground">
              {OP_LABELS[c.op]}
            </span>
          )}

          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={() => removeClause(i)}
            aria-label="Remove filter"
          >
            <X className="size-3.5" />
          </Button>
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-2">
        <Select value={draftField} onValueChange={setDraftField}>
          <SelectTrigger className="h-8 w-52">
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
            <div className="px-2 py-1 text-xs text-muted-foreground">Numbers</div>
            {Object.entries(NUMERIC_FIELD_LABELS).map(([k, label]) => (
              <SelectItem key={k} value={k}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {!isNumeric && (
          <Select
            value={draftOp}
            onValueChange={(v) => setDraftOp(v as FilterClause["op"])}
          >
            <SelectTrigger className="h-8 w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="in">{OP_LABELS.in}</SelectItem>
              <SelectItem value="notIn">{OP_LABELS.notIn}</SelectItem>
              <SelectItem value="isSet">{OP_LABELS.isSet}</SelectItem>
              <SelectItem value="isNotSet">{OP_LABELS.isNotSet}</SelectItem>
            </SelectContent>
          </Select>
        )}

        <Button variant="outline" size="sm" className="h-8" onClick={addClause}>
          <Plus className="size-3.5" /> Add filter
        </Button>

        {activeFilterCount(filters) > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-muted-foreground"
            onClick={() => onChange({ clauses: [] })}
          >
            Clear all
          </Button>
        )}
      </div>
    </div>
  );
}
