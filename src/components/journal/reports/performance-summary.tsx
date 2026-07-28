"use client";

import { Card, CardContent } from "@/components/ui/card";
import { formatMetric, metric, type ViewMode } from "@/lib/journal/units";
import type { PerformanceSummary } from "@/lib/journal/reports/engine";
import type { ReportMetric } from "@/lib/journal/reports/metrics";

/**
 * Best / worst / most active / highest win rate.
 *
 * Only categories at or above the sample threshold are eligible, which is the
 * whole point: crowning a three-trade category "best" is exactly the mistake
 * this layer exists to prevent. When nothing qualifies the panel says so
 * instead of quietly naming the least-thin option.
 */
export function PerformanceSummaryPanel({
  summary,
  metric: selected,
  viewMode,
  currency,
  equityBase,
  minSample,
}: {
  summary: PerformanceSummary;
  metric: ReportMetric;
  viewMode: ViewMode;
  currency: string;
  equityBase: number | null;
  minSample: number;
}) {
  if (summary.qualifying === 0) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-muted-foreground">
          Nijedna kategorija nema bar {minSample} trejdova. Dok je tako,
          proglašavanje &bdquo;najbolje&ldquo; bi bilo nagađanje, pa se ne prikazuje.
        </CardContent>
      </Card>
    );
  }

  const fmt = (v: number | null | undefined) =>
    formatMetric(
      metric(v ?? null, selected.unit, { currency, equityBase }),
      viewMode,
    );

  const items = [
    {
      label: `Najbolji — ${selected.label}`,
      bucket: summary.best?.bucket,
      value: fmt(summary.best?.values[selected.key]),
      n: summary.best?.n,
      cls: "text-[var(--profit)]",
    },
    {
      label: `Najgori — ${selected.label}`,
      bucket: summary.worst?.bucket,
      value: fmt(summary.worst?.values[selected.key]),
      n: summary.worst?.n,
      cls: "text-[var(--loss)]",
    },
    {
      label: "Najaktivniji",
      bucket: summary.mostActive?.bucket,
      value: `${summary.mostActive?.n ?? 0} trejdova`,
      n: summary.mostActive?.n,
      cls: "",
    },
    {
      label: "Najviši win rate",
      bucket: summary.highestWinRate?.bucket,
      value:
        summary.highestWinRate?.values.win_rate != null
          ? `${summary.highestWinRate.values.win_rate.toFixed(1)}%`
          : "—",
      n: summary.highestWinRate?.n,
      cls: "",
    },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((it) => (
        <Card key={it.label}>
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground">{it.label}</div>
            <div className="mt-1 truncate font-medium" title={it.bucket}>
              {it.bucket ?? "—"}
            </div>
            <div className={`mt-0.5 text-lg font-semibold tabular-nums ${it.cls}`}>
              {it.value}
            </div>
            {it.n != null && (
              <div className="text-xs text-muted-foreground">n={it.n}</div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
