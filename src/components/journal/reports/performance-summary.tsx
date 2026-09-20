"use client";

import { Card, CardContent } from "@/components/ui/card";
import { formatMetric, metric, type ViewMode } from "@/lib/journal/units";
import { bucketLabel, type Dimension } from "@/lib/journal/reports/dimensions";
import type { PerformanceSummary } from "@/lib/journal/reports/engine";
import type { ReportMetric } from "@/lib/journal/reports/metrics";

/**
 * Best, worst and most traded group, on the metric the table is sorted by.
 *
 * Only groups at or above the sample threshold are eligible: crowning a
 * three-trade group "best" is the mistake this layer exists to prevent. With
 * fewer than two eligible groups there is nothing to rank, and it says so in
 * one line rather than naming the only group best AND worst.
 *
 * The metric is always one of the table's columns, so the cards always have a
 * value — they used to read a separate metric that could be absent from the
 * rows and showed "—" for it.
 */
export function PerformanceSummaryPanel({
  summary,
  dimension,
  metric: selected,
  viewMode,
  currency,
  equityBase,
  minSample,
}: {
  summary: PerformanceSummary;
  dimension: Dimension;
  metric: ReportMetric;
  viewMode: ViewMode;
  currency: string;
  equityBase: number | null;
  minSample: number;
}) {
  if (summary.qualifying < 2) {
    return (
      <p className="text-sm text-muted-foreground">
        Rankings need at least two groups with {minSample} or more trades.
      </p>
    );
  }

  const fmt = (v: number | null | undefined) =>
    formatMetric(metric(v ?? null, selected.unit, { currency, equityBase }), viewMode);
  const name = (b: string | undefined) => (b == null ? "—" : bucketLabel(dimension, b));

  const items = [
    {
      label: `Best ${selected.label.toLowerCase()}`,
      row: summary.best,
      value: fmt(summary.best?.values[selected.key]),
      interval: summary.best?.intervals?.[selected.key] ?? null,
    },
    {
      label: `Worst ${selected.label.toLowerCase()}`,
      row: summary.worst,
      value: fmt(summary.worst?.values[selected.key]),
      interval: summary.worst?.intervals?.[selected.key] ?? null,
    },
    {
      label: "Most traded",
      row: summary.mostActive,
      value: `${summary.mostActive?.n ?? 0} trades`,
      interval: null,
    },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {items.map((it) => (
        <Card key={it.label}>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">{it.label}</div>
            <div className="mt-1 truncate font-medium" title={name(it.row?.bucket)}>
              {name(it.row?.bucket)}
            </div>
            <div className="mt-0.5 flex items-baseline justify-between gap-2">
              <span className="text-lg font-semibold tabular-nums">{it.value}</span>
              {it.row && it.label !== "Most traded" && (
                <span className="text-xs text-muted-foreground">{it.row.n} trades</span>
              )}
            </div>
            {/* The ranking itself is decided on the conservative end of this
                interval (see `summarizeReport`), so the card shows the range
                the winner was chosen on rather than only the figure it won
                with. */}
            {it.interval && (
              <div className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
                {fmt(it.interval.lo)} – {fmt(it.interval.hi)}
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
