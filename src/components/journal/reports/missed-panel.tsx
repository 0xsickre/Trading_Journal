"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { MissedCost } from "@/lib/journal/missed-cost";

/**
 * What the trades you did not take were worth.
 *
 * Over the WHOLE book of the accounts in scope, not the filtered range: a
 * missed trade has no close, so the report's date bounds — which are bounds on
 * the close day — cannot answer for it. Said in the panel rather than assumed.
 *
 * Three refusals, which are most of the content:
 *   - an unmeasured miss is counted, never summed as zero;
 *   - with nothing measured, the total is an em dash and the panel says what
 *     would measure it;
 *   - the count of stale plans sits beside the sum, because a book that never
 *     marks anything missed reads as "nothing missed" for the wrong reason.
 */
export function MissedPanel({
  cost,
  stalePlans,
}: {
  cost: MissedCost;
  /** Plans left unresolved for more than a fortnight. */
  stalePlans: number;
}) {
  if (cost.trades.length === 0 && stalePlans === 0) return null;

  const total = cost.totalR;
  const sign = total == null ? "" : total > 0 ? "+" : "";

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Missed setups</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="tabular-nums">
            {cost.trades.length} missed
          </span>
          <span className="tabular-nums">
            {total == null ? "—" : `${sign}${total.toFixed(2)}R`}{" "}
            <span className="text-xs text-muted-foreground">hypothetical</span>
          </span>
          {cost.measured > 0 && (
            <span className="text-xs text-muted-foreground">
              {cost.wouldHaveWorked} of {cost.measured} measured would have reached target
            </span>
          )}
        </div>

        {cost.byReason.length > 0 && (
          <ul className="space-y-0.5 text-xs text-muted-foreground">
            {cost.byReason.map((r) => (
              <li key={r.reason || "—"} className="tabular-nums">
                {r.reason || "no reason recorded"}: {r.totalR > 0 ? "+" : ""}
                {r.totalR.toFixed(2)}R over {r.n} {r.n === 1 ? "miss" : "misses"}
              </li>
            ))}
          </ul>
        )}

        <p className="text-xs text-muted-foreground">
          {cost.unmeasured > 0 && (
            <>
              {cost.unmeasured} of these {cost.unmeasured === 1 ? "has" : "have"} no
              measured outcome and {cost.unmeasured === 1 ? "is" : "are"} not in the
              total — run <code>scripts/mt5_excursion.py --missed</code> to price them.{" "}
            </>
          )}
          {stalePlans > 0 && (
            <>
              {stalePlans} {stalePlans === 1 ? "plan is" : "plans are"} still unresolved
              after two weeks; until they are taken or marked missed, this figure
              measures how tidily you file plans rather than what hesitation cost.{" "}
            </>
          )}
          Counted over the whole book of the accounts in scope — a missed trade has no
          close day, so the report&apos;s dates cannot bound it.
        </p>
      </CardContent>
    </Card>
  );
}
