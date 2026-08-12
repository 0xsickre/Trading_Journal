"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMetric, metric, type ViewMode } from "@/lib/journal/units";
import { getCell, type PivotResult } from "@/lib/journal/reports/pivot";

/**
 * Cross-analysis grid.
 *
 * Three display rules, each answering a way a pivot can mislead:
 *
 *   - a thin cell is DIMMED, never hidden — hiding invites the reader to read
 *     the blank as zero;
 *   - `n` is printed under every value, because a pivot cuts an already small
 *     book into a grid and most cells are thin by construction;
 *   - an intersection with no trades is an em dash, visibly different from a
 *     cell whose value happens to be zero.
 */
export function CrossAnalysis({
  result,
  viewMode,
  currency,
  equityBase,
}: {
  result: PivotResult;
  viewMode: ViewMode;
  currency: string;
  equityBase: number | null;
}) {
  const fmt = (v: number | null) =>
    formatMetric(metric(v, result.metric.unit, { currency, equityBase }), viewMode);

  if (result.rowKeys.length === 0 || result.colKeys.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Cross-analiza</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="py-6 text-center text-sm text-muted-foreground">
            No trades carry a value for both dimensions.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          {result.rowDimension.label} × {result.colDimension.label}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {result.metric.label} · {result.grandTotal.n} trades · cells below{" "}
          {result.minSample} trades are dimmed
        </p>
        {result.multiValue && (
          <p className="text-xs text-[var(--chart-4)]">
            One axis is multi-valued — the totals exceed the overall trade count.
          </p>
        )}
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className="py-2 pr-3 text-left font-medium" />
                {result.colKeys.map((c) => (
                  <th key={c} className="px-3 py-2 text-right font-medium">
                    {c}
                  </th>
                ))}
                <th className="py-2 pl-3 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {result.rowKeys.map((r) => (
                <tr key={r} className="border-b last:border-0">
                  <td className="py-2 pr-3 font-medium">{r}</td>
                  {result.colKeys.map((c) => {
                    const cell = getCell(result, r, c);
                    return (
                      <td
                        key={c}
                        className={`px-3 py-2 text-right tabular-nums ${
                          cell?.belowSample ? "opacity-40" : ""
                        }`}
                        title={
                          cell
                            ? `${cell.n} trejdova${
                                cell.belowSample ? " — below the threshold" : ""
                              }`
                            : "No trade in this intersection"
                        }
                      >
                        {cell ? (
                          <>
                            <div>{fmt(cell.value)}</div>
                            <div className="text-xs text-muted-foreground">
                              n={cell.n}
                            </div>
                          </>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    );
                  })}
                  <td className="py-2 pl-3 text-right tabular-nums font-medium">
                    <div>{fmt(result.rowTotals.get(r)?.value ?? null)}</div>
                    <div className="text-xs text-muted-foreground">
                      n={result.rowTotals.get(r)?.n ?? 0}
                    </div>
                  </td>
                </tr>
              ))}
              <tr className="border-t-2">
                <td className="py-2 pr-3 font-medium">Total</td>
                {result.colKeys.map((c) => (
                  <td
                    key={c}
                    className="px-3 py-2 text-right tabular-nums font-medium"
                  >
                    <div>{fmt(result.colTotals.get(c)?.value ?? null)}</div>
                    <div className="text-xs text-muted-foreground">
                      n={result.colTotals.get(c)?.n ?? 0}
                    </div>
                  </td>
                ))}
                <td className="py-2 pl-3 text-right tabular-nums font-medium">
                  <div>{fmt(result.grandTotal.value)}</div>
                  <div className="text-xs text-muted-foreground">
                    n={result.grandTotal.n}
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
