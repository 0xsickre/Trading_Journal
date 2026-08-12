"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatMetric, metric as mkMetric, type ViewMode } from "@/lib/journal/units";
import { runReport } from "@/lib/journal/reports/engine";
import { getMetric } from "@/lib/journal/reports/metrics";
import type { MetricContext } from "@/lib/journal/reports/metrics";
import {
  DIMENSIONS,
  type Dimension,
  bucketsOf,
  type DimensionContext,
} from "@/lib/journal/reports/dimensions";
import type { FilterSet } from "@/lib/journal/reports/filters";
import type { EnrichedTrade } from "@/lib/journal/enriched-trade";

/**
 * Compare two filter sets side by side.
 *
 * Same engine, run twice — which only works because a filter set is a plain
 * serializable object. The comparison is deliberately built as "split the
 * current scope by one dimension's value" rather than as two free-form filter
 * builders: the question people actually ask is "A versus not-A", and the
 * second side is therefore the exact negation of the first, guaranteeing the
 * two halves partition the book instead of silently overlapping.
 */
export function CompareView({
  trades,
  baseFilters,
  dimensionContext,
  metricContext,
  dimensionKey,
  columnKeys,
  minSample,
  viewMode,
  currency,
  equityBase,
  dimensions = DIMENSIONS,
}: {
  trades: EnrichedTrade[];
  baseFilters: FilterSet;
  dimensionContext: DimensionContext;
  metricContext: MetricContext;
  dimensionKey: string;
  columnKeys: string[];
  minSample: number;
  viewMode: ViewMode;
  currency: string;
  equityBase: number | null;
  /** Built-ins plus the user's own fields. */
  dimensions?: Dimension[];
}) {
  // Setup grade is the default split because every trade has one; a custom
  // field might not exist at all on a fresh account.
  const [splitField, setSplitField] = useState("setup_grade");
  const [splitValue, setSplitValue] = useState<string>("");

  const options = useMemo(() => {
    const dim = dimensions.find((d) => d.key === splitField);
    if (!dim) return [];
    const seen = new Set<string>();
    for (const t of trades) {
      for (const b of bucketsOf(dim, t, dimensionContext)) seen.add(b);
    }
    return [...seen].sort();
  }, [splitField, trades, dimensionContext, dimensions]);

  const value = splitValue || options[0] || "";

  const sides = useMemo(() => {
    if (!value) return null;
    const build = (op: "in" | "notIn") =>
      runReport({
        trades,
        dimension: dimensionKey,
        metricKeys: columnKeys,
        filters: {
          ...baseFilters,
          clauses: [...baseFilters.clauses, { field: splitField, op, values: [value] }],
        },
        dimensionContext,
        metricContext,
        minSample,
      });
    return { a: build("in"), b: build("notIn") };
  }, [
    trades,
    dimensionKey,
    columnKeys,
    baseFilters,
    splitField,
    value,
    dimensionContext,
    metricContext,
    minSample,
  ]);

  const totals = (side: ReturnType<typeof runReport>) => {
    if (!side) return null;
    const all = side.rows.flatMap((r) => r.trades);
    // De-duplicated: a multi-value dimension puts one trade in several rows.
    const unique = [...new Map(all.map((t) => [t.id, t])).values()];
    const out: Record<string, number | null> = {};
    for (const key of columnKeys) {
      const m = getMetric(key);
      out[key] = m ? m.compute(unique, metricContext) : null;
    }
    return { values: out, n: unique.length };
  };

  const ta = totals(sides?.a ?? null);
  const tb = totals(sides?.b ?? null);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">Podeli po</span>
        <Select
          value={splitField}
          onValueChange={(v) => {
            setSplitField(v);
            setSplitValue("");
          }}
        >
          <SelectTrigger className="h-9 w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {dimensions.map((d) => (
              <SelectItem key={d.key} value={d.key}>
                {d.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={value} onValueChange={setSplitValue}>
          <SelectTrigger className="h-9 w-52">
            <SelectValue placeholder="Vrednost" />
          </SelectTrigger>
          <SelectContent>
            {options.map((o) => (
              <SelectItem key={o} value={o}>
                {o}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!value ? (
        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">
            Izaberi vrednost po kojoj se knjiga deli na dva dela.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {[
            { label: `${value}`, side: ta, tone: "border-[var(--profit)]" },
            { label: `All except: ${value}`, side: tb, tone: "border-[var(--chart-3)]" },
          ].map((col) => (
            <Card key={col.label} className={`border-t-2 ${col.tone}`}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{col.label}</CardTitle>
                <p className="text-xs text-muted-foreground">
                  {col.side?.n ?? 0} trejdova
                  {(col.side?.n ?? 0) < minSample && " — below the threshold, draw no conclusion"}
                </p>
              </CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <tbody>
                    {columnKeys.map((k) => {
                      const m = getMetric(k);
                      if (!m) return null;
                      return (
                        <tr key={k} className="border-b last:border-0">
                          <td className="py-1.5 text-muted-foreground">
                            {m.label}
                          </td>
                          <td className="py-1.5 text-right tabular-nums">
                            {formatMetric(
                              mkMetric(col.side?.values[k] ?? null, m.unit, {
                                currency,
                                equityBase,
                              }),
                              viewMode,
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        The other side is the exact negation of the first, so the two halves make the whole
        skup — bez preklapanja i bez izgubljenih trejdova.
      </p>
    </div>
  );
}
