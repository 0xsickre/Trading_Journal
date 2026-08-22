"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMetric, metric, type ViewMode } from "@/lib/journal/units";
import type { ReportResult } from "@/lib/journal/reports/engine";

/**
 * Summary table.
 *
 * `n` sits in its own column, always. A category with three trades and a 100 %
 * win rate is not a finding, and a reader can only know that if the sample is
 * on screen next to the number — so thin rows are dimmed rather than dropped.
 */
export function ReportTable({
  result,
  viewMode,
  currency,
  equityBase,
  sortBy,
  onSort,
}: {
  result: ReportResult;
  viewMode: ViewMode;
  currency: string;
  equityBase: number | null;
  sortBy?: string;
  onSort: (metricKey: string) => void;
}) {
  if (result.rows.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{result.dimension.label}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="py-6 text-center text-sm text-muted-foreground">
            No trades match the selected filters.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{result.dimension.label}</CardTitle>
        <p className="text-xs text-muted-foreground">
          {result.rows.length} groups · {result.totalTrades} trades
          {result.excluded > 0 && (
            <>
              {" "}
              · <span className="text-[var(--chart-4)]">
                {result.excluded} without a value for this dimension, omitted
              </span>
            </>
          )}
        </p>
        {result.multiValue && (
          <p className="text-xs text-[var(--chart-4)]">
            One trade can land in several rows, so the sum of the rows{" "}
            is <strong>not</strong> the overall P&amp;L.
          </p>
        )}
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-muted-foreground">
              <tr className="border-b">
                <th className="py-2 pr-3 text-left font-medium">
                  {result.dimension.label}
                </th>
                <th className="py-2 pr-3 text-right font-medium">n</th>
                {result.metrics.map((m) => (
                  <th key={m.key} className="py-2 pl-3 text-right font-medium">
                    <button
                      onClick={() => onSort(m.key)}
                      title={m.hint}
                      className="inline-flex items-center gap-1 hover:text-foreground"
                    >
                      {m.label}
                      {sortBy === m.key &&
                        (m.higherIsBetter ? (
                          <ArrowDown className="size-3" />
                        ) : (
                          <ArrowUp className="size-3" />
                        ))}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row) => (
                <tr
                  key={row.bucket}
                  className={`border-b last:border-0 ${
                    row.belowSample ? "opacity-45" : ""
                  }`}
                  title={
                    row.belowSample
                      ? `Only ${row.n} trades — below the threshold of ${result.minSample}. The numbers are shown, but do not trust them.`
                      : undefined
                  }
                >
                  <td className="py-2 pr-3">{row.bucket}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                    {row.n}
                  </td>
                  {result.metrics.map((m) => (
                    <td
                      key={m.key}
                      className="py-2 pl-3 text-right tabular-nums"
                    >
                      {formatMetric(
                        metric(row.values[m.key], m.unit, {
                          currency,
                          equityBase,
                        }),
                        viewMode,
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {result.rows.some((r) => r.belowSample) && (
          <p className="mt-3 text-xs text-muted-foreground">
            Dimmed rows have fewer than {result.minSample} trades.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
