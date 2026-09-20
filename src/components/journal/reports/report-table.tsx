"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMetric, metric, type ViewMode } from "@/lib/journal/units";
import { bucketLabel } from "@/lib/journal/reports/dimensions";
import { isInconclusive, parseSort, type ReportResult } from "@/lib/journal/reports/engine";

/**
 * The groups, one row each, with the whole book as a Total row.
 *
 * The trade count sits beside every figure, always, and the three figures a
 * reader is most likely to mistake for a fact — win rate, expectancy, profit
 * factor — carry their confidence interval underneath. A group of three trades
 * with a 100 % win rate is not a finding; the interval is what says so, where
 * dimming by sample size only said "there are few of these".
 *
 * A cell whose interval still contains its neutral value (0 for a mean, 50 for
 * a rate, 1 for a ratio) is dimmed: this sample cannot tell which side of
 * neutral the truth is on.
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
  if (result.rows.some((r) => result.metrics.some((m) => isInconclusive(r, m)))) {
    notes.push("Dimmed figures: the 95 % interval still includes no edge");
  }
  if (result.rows.some((r) => r.belowSample)) {
    notes.push(`Under ${result.minSample} trades: shown, but never ranked`);
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
                <tr key={row.bucket} className="border-b last:border-0">
                  <td className="sticky left-0 bg-card py-2 pr-3">
                    {bucketLabel(result.dimension, row.bucket)}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{row.n}</td>
                  {result.metrics.map((m) => {
                    const ci = row.intervals?.[m.key] ?? null;
                    const unsure = isInconclusive(row, m);
                    return (
                      <td
                        key={m.key}
                        className={`py-2 pl-3 text-right tabular-nums ${unsure ? "text-muted-foreground/70" : ""}`}
                        // The interval's own sample, when it differs from the
                        // row's: a win rate over 40 trades can be decided by 12.
                        title={
                          ci && ci.n !== row.n
                            ? `95 % interval over ${ci.n} of ${row.n} trades`
                            : undefined
                        }
                      >
                        {fmt(row.values[m.key], m.unit)}
                        {ci && (
                          // Both bounds through the formatter separately, so
                          // Privacy mode masks them exactly as it masks the
                          // figure above.
                          <span className="block text-[11px] font-normal text-muted-foreground">
                            {fmt(ci.lo, m.unit)} – {fmt(ci.hi, m.unit)}
                          </span>
                        )}
                      </td>
                    );
                  })}
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
