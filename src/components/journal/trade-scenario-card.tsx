import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScenarioGrid } from "@/components/journal/scenario-grid";
import { cn } from "@/lib/utils";
import { afterExitR, cellR, type ScenarioTrade } from "@/lib/journal/scenario";

const WINDOW_LABELS = { "15": "15 min", "30": "30 min", "60": "60 min", eod: "to 15:10 CT" } as const;
const EXIT_LABELS = { stop: "at the stop", target: "at the target", other: "by hand" } as const;
const r2 = (r: number) => `${r > 0 ? "+" : ""}${r.toFixed(2)}R`;

/**
 * What would have happened with this trade (phase L): the price after the exit,
 * what the stop was followed by, the stop that would have lived to the target,
 * and the SL × TP grid — from the exchange's own candles, measured by
 * futures-trading once the Topstep day was over.
 */
export function TradeScenarioCard({ trade }: { trade: ScenarioTrade }) {
  const s = trade.scenario;
  const after = afterExitR(s);
  const values = s.grid.map((row, i) => row.map((_, j) => cellR(trade, i, j, true)));
  const realRow = Math.max(0, s.sl.indexOf(1));
  let best = { i: 0, j: 0 };
  values.forEach((row, i) => row.forEach((v, j) => (v > values[best.i][best.j] ? (best = { i, j }) : null)));

  const verdict = (() => {
    if (s.exitKind === "stop" && s.target != null) {
      return s.afterExit.targetMinutes != null
        ? `The planned target came ${Math.round(s.afterExit.targetMinutes)} min after the stop.`
        : "The planned target did not come after the stop that day.";
    }
    if (s.exitKind === "other" && s.target != null) {
      if (s.afterExit.stopFirst) return "Held on, the old stop would have come before the target.";
      if (s.afterExit.targetMinutes != null)
        return `Held on, the target would have come ${Math.round(s.afterExit.targetMinutes)} min after the exit.`;
      return "Held on, neither the target nor the stop came by 15:10 CT.";
    }
    if (s.exitKind === "target") {
      const eod = after.eod;
      return eod ? `After the target it went another ${eod.fav.toFixed(2)}R your way by 15:10 CT.` : null;
    }
    return null;
  })();

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">What would have happened</CardTitle>
        <p className="text-sm text-muted-foreground">
          From the exchange candles{s.contract ? ` (${s.contract})` : ""} to the end of the Topstep day. Exit{" "}
          {EXIT_LABELS[s.exitKind]}; R = {+s.riskPts.toFixed(2)} pts from the average entry to the stop.
        </p>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {verdict && <p className="font-medium">{verdict}</p>}

        <div>
          <div className="mb-1 text-xs font-medium text-muted-foreground">After the exit</div>
          <table className="w-full max-w-md text-xs tabular-nums">
            <thead>
              <tr className="text-muted-foreground">
                <th className="py-1 text-left font-medium">Window</th>
                <th className="py-1 text-right font-medium">Your way</th>
                <th className="py-1 text-right font-medium">Against</th>
              </tr>
            </thead>
            <tbody>
              {(Object.keys(WINDOW_LABELS) as (keyof typeof WINDOW_LABELS)[]).map((w) => {
                const e = after[w];
                return (
                  <tr key={w} className="border-t">
                    <td className="py-1">{WINDOW_LABELS[w]}</td>
                    <td className="py-1 text-right text-[var(--profit)]">{e ? r2(e.fav) : "—"}</td>
                    <td className="py-1 text-right text-[var(--loss)]">{e ? r2(-e.adv) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
          <span>
            <span className="text-muted-foreground">Furthest your way before the stop: </span>
            <b>{r2(s.mfeBeforeStopR)}</b>
          </span>
          {s.target != null && (
            <span>
              <span className="text-muted-foreground">Stop that would have lived to the target: </span>
              <b className={cn(s.slForTargetR != null && s.slForTargetR > 1 && "text-[var(--loss)]")}>
                {s.slForTargetR != null
                  ? `${s.slForTargetR.toFixed(2)}R (${(s.slForTargetR * s.riskPts).toFixed(2)} pts)`
                  : "the target never came that day"}
              </b>
            </span>
          )}
        </div>

        <div>
          <div className="mb-1 text-xs font-medium text-muted-foreground">
            Stop × target — R of each variant (same money at risk), net of commission
          </div>
          <ScenarioGrid
            sl={s.sl}
            tp={s.tp}
            values={values}
            realRow={realRow}
            best={best}
            riskPts={s.riskPts}
            plannedTargetR={s.targetR}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            One trade is an anecdote: the grid means something over many — Reports › SL × TP.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
