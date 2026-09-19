"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMetric, metric, type ViewMode } from "@/lib/journal/units";
import { bucketLabel } from "@/lib/journal/reports/dimensions";
import { parseSort, type ReportResult } from "@/lib/journal/reports/engine";

/**
 * The groups, one row each, with the whole book as a Total row.
 *
 * The trade count sits beside every figure, always. A group of three trades
 * with a 100 % win rate is not a finding, and a reader can only know that if
 * the sample is on screen — so thin rows are dimmed, never dropped.
 *
 * A header click sorts by that column, better end first; a second click
 * reverses it. The arrow shows the order actually in force.
 */
export function ReportTable({
  result,
  totals,
  viewMode,
  currency,
  equityBase,
  sortBy,
  onSort,
}: {
  result: ReportResult;
  /** The same metrics over every trade in the table; `null` hides the row. */
  totals: Record<string, number | null> | null;
  viewMode: ViewMode;
  currency: string;
  equityBase: number | null;
  sortBy?: string;
  onSort: (next: string) => void;
}) {
  const sort = parseSort(sortBy);
  const active = sort && result.metrics.some((m) => m.key === sort.key) ? sort : null;
  const fmt = (v: number | null | undefined, unit: ReportResult["metrics"][number]["unit"]) =>
    formatMetric(metric(v ?? null, unit, { currency, equityBase }), viewMode);

  const notes: string[] = [];
  if (result.rows.some((r) => r.belowSample)) {
    notes.push(`Dimmed: fewer than ${result.minSample} trades`);
  }
  if (result.excluded > 0) {
    notes.push(`${result.excluded} ${result.excluded === 1 ? "trade has" : "trades have"} no ${result.dimension.label.toLowerCase()} and ${result.excluded === 1 ? "is" : "are"} left out`);
  }
  if (result.multiValue) {
    notes.push("A trade can sit in several rows, so rows do not add up to the book");
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">By {result.dimension.label.toLowerCase()}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="max-h-[32rem] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-card text-muted-foreground">
              <tr className="border-b">
                <th className="sticky left-0 z-10 bg-card py-2 pr-3 text-left font-medium">
                  {result.dimension.label}
                </th>
                <th className="py-2 pr-3 text-right font-medium">Trades</th>
                {result.metrics.map((m) => {
                  const on = active?.key === m.key;
                  const betterFirst = m.higherIsBetter === false ? "asc" : "desc";
                  const dir = on ? (active.dir ?? betterFirst) : null;
                  const next = `${m.key}:${on ? (dir === "asc" ? "desc" : "asc") : betterFirst}`;
                  return (
                    <th
                      key={m.key}
                      className="py-2 pl-3 text-right font-medium"
                      aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none"}
                    >
                      <button
                        type="button"
                        onClick={() => onSort(next)}
                        title={m.hint}
                        className={`inline-flex items-center gap-1 hover:text-foreground ${on ? "text-foreground" : ""}`}
                      >
                        {m.label}
                        {dir === "desc" && <ArrowDown className="size-3" />}
                        {dir === "asc" && <ArrowUp className="size-3" />}
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row) => (
                <tr
                  key={row.bucket}
                  className={`border-b last:border-0 ${row.belowSample ? "text-muted-foreground/70" : ""}`}
                >
                  <td className="sticky left-0 bg-card py-2 pr-3">
                    {bucketLabel(result.dimension, row.bucket)}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{row.n}</td>
                  {result.metrics.map((m) => (
                    <td key={m.key} className="py-2 pl-3 text-right tabular-nums">
                      {fmt(row.values[m.key], m.unit)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            {totals && (
              <tfoot>
                <tr className="border-t-2 font-medium">
                  <td className="sticky left-0 bg-card py-2 pr-3">Total</td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {result.totalTrades - result.excluded}
                  </td>
                  {result.metrics.map((m) => (
                    <td key={m.key} className="py-2 pl-3 text-right tabular-nums">
                      {fmt(totals[m.key], m.unit)}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        {notes.length > 0 && (
          <p className="mt-3 text-xs text-muted-foreground">{notes.join(" · ")}.</p>
        )}
      </CardContent>
    </Card>
  );
}
