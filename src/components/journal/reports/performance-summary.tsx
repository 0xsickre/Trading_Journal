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
          No category has at least {minSample} trades. While that holds,
          calling one &quot;best&quot; would be guessing, so none is shown.
        </CardContent>
      </Card>
    );
  }

  /**
   * One qualifying category is not a ranking.
   *
   * With a single eligible row, `summarizeReport` hands back the SAME row as
   * `best` and as `worst` — it sorted a list of one — and the four cards below
   * would then state, of one bucket, that it is both the best and the worst
   * while "most active" and "highest win rate" name it a third and fourth
   * time. Every claim is technically derivable and not one of them is
   * informative: "best of one" says nothing that "the only one" does not.
   *
   * Same principle as the `qualifying === 0` branch above, one step along: that
   * one refuses to crown a thin category, this one refuses to crown an
   * unopposed one.
   */
  if (summary.qualifying === 1) {
    const only = summary.best ?? summary.mostActive;
    return (
      <Card>
        <CardContent className="p-4 text-sm text-muted-foreground">
          Only one category clears {minSample} trades
          {only ? ` (${only.bucket}, n=${only.n})` : ""}, so there is nothing to
          rank it against. Split the book a different way, or widen the date
          range, to get a comparison.
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
      label: `Best — ${selected.label}`,
      bucket: summary.best?.bucket,
      value: fmt(summary.best?.values[selected.key]),
      n: summary.best?.n,
      cls: "text-[var(--profit)]",
    },
    {
      label: `Worst — ${selected.label}`,
      bucket: summary.worst?.bucket,
      value: fmt(summary.worst?.values[selected.key]),
      n: summary.worst?.n,
      cls: "text-[var(--loss)]",
    },
    {
      label: "Most active",
      bucket: summary.mostActive?.bucket,
      value: `${summary.mostActive?.n ?? 0} trades`,
      n: summary.mostActive?.n,
      cls: "",
    },
    {
      label: "Highest win rate",
      bucket: summary.highestWinRate?.bucket,
      // Routed through `formatMetric` like every other value in this panel —
      // a raw `.toFixed(1)` here used to ignore `viewMode` entirely, which
      // meant privacy mode masked every other tile but still leaked the win
      // rate in the clear.
      value: formatMetric(
        metric(summary.highestWinRate?.values.win_rate ?? null, "pct", {
          currency,
          equityBase,
        }),
        viewMode,
      ),
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
