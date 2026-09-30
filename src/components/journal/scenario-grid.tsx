import { cn } from "@/lib/utils";

const fmtR = (r: number) => `${r > 0 ? "+" : ""}${r.toFixed(2)}`;

/**
 * The SL × TP grid (phase L): rows are stops as a multiple of the real one,
 * columns are targets in R of that stop. The real-stop row is marked, the best
 * cell is outlined. Shared by the trade card (one trade) and the reports panel
 * (the mean over a group) so both read the same way.
 */
export function ScenarioGrid({
  sl,
  tp,
  values,
  realRow,
  best,
  riskPts,
  hitRates,
  plannedTargetR,
}: {
  sl: number[];
  tp: number[];
  /** R per cell, in R of its own variant. */
  values: number[][];
  realRow: number;
  best?: { i: number; j: number } | null;
  /** One trade: its stop in points, to label each row with its size. */
  riskPts?: number;
  /** A group: share of trades whose target came first, per cell. */
  hitRates?: number[][];
  /** The planned target in R, when there is one: its column is marked. */
  plannedTargetR?: number | null;
}) {
  const plannedCol =
    plannedTargetR == null
      ? -1
      : tp.reduce((b, t, j) => (Math.abs(t - plannedTargetR) < Math.abs(tp[b] - plannedTargetR) ? j : b), 0);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs tabular-nums">
        <thead>
          <tr className="text-muted-foreground">
            <th className="px-2 py-1 text-left font-medium">Stop \ Target</th>
            {tp.map((t, j) => (
              <th key={t} className={cn("px-2 py-1 text-right font-medium", j === plannedCol && "text-foreground")}>
                {t}R{j === plannedCol ? " ·plan" : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sl.map((k, i) => (
            <tr key={k} className={cn("border-t", i === realRow && "bg-muted/50 font-medium")}>
              <td className="px-2 py-1 whitespace-nowrap">
                {k}× {i === realRow ? "your stop" : "stop"}
                {riskPts != null && (
                  <span className="text-muted-foreground"> ({+(k * riskPts).toFixed(2)} pts)</span>
                )}
              </td>
              {tp.map((t, j) => {
                const v = values[i][j];
                const isBest = best != null && best.i === i && best.j === j;
                return (
                  <td
                    key={t}
                    className={cn(
                      "px-2 py-1 text-right",
                      v > 0 ? "text-[var(--profit)]" : v < 0 ? "text-[var(--loss)]" : "text-muted-foreground",
                      isBest && "rounded outline outline-2 outline-[var(--profit)]",
                    )}
                    title={hitRates ? `target first in ${Math.round(hitRates[i][j] * 100)}% of trades` : undefined}
                  >
                    {fmtR(v)}
                    {hitRates && (
                      <span className="block text-[10px] text-muted-foreground">{Math.round(hitRates[i][j] * 100)}%</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
