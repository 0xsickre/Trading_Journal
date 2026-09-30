"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScenarioGrid } from "@/components/journal/scenario-grid";
import { cn } from "@/lib/utils";
import type { EnrichedTrade } from "@/lib/journal/enriched-trade";
import type { Dimension, DimensionContext } from "@/lib/journal/reports/dimensions";
import { sealedNumber } from "@/lib/journal/plan-snapshot";
import {
  SCENARIO_MIN_SAMPLE,
  scenarioTrade,
  summarizeScenarios,
  type ScenarioSummary,
  type ScenarioTrade,
} from "@/lib/journal/scenario";

const r2 = (r: number | null) => (r == null ? "—" : `${r > 0 ? "+" : ""}${r.toFixed(2)}R`);
const WINDOWS = [
  ["15", "15 min"],
  ["30", "30 min"],
  ["60", "60 min"],
  ["eod", "to 15:10 CT"],
] as const;

function bestLabel(s: ScenarioSummary): string {
  if (!s.best) return "—";
  return `${s.sl[s.best.i]}× stop · ${s.tp[s.best.j]}R → ${r2(s.best.meanR)}`;
}

/** Best target on the real stop: the answer when the stop is set by the structure and only the target is a choice. */
function bestOnRealStop(s: ScenarioSummary): string {
  const row = s.cells[s.realRow];
  const j = row.reduce((b, c, k) => (c.meanR > row[b].meanR ? k : b), 0);
  return `${s.tp[j]}R → ${r2(row[j].meanR)}`;
}

/**
 * SL × TP — what the trades in scope would have made with other stops and
 * targets (phase L), grouped by the dimension the report is grouped by, so
 * "which stop and target for this setup / this entry TF / this session" is the
 * same click as every other report. Every group under `SCENARIO_MIN_SAMPLE`
 * trades is marked: its best cell is a hypothesis.
 */
export function ScenarioPanel({
  trades,
  dimension,
  dimensionContext,
}: {
  trades: EnrichedTrade[];
  dimension: Dimension;
  dimensionContext: DimensionContext;
}) {
  const [net, setNet] = useState(true);

  const { measured, unmeasured } = useMemo(() => {
    const m: { e: EnrichedTrade; s: ScenarioTrade }[] = [];
    let u = 0;
    for (const e of trades) {
      const s = scenarioTrade(e.trade.row);
      if (s) m.push({ e, s });
      else if (sealedNumber(e.trade.row, "stop_price") != null) u++;
    }
    return { measured: m, unmeasured: u };
  }, [trades]);

  const overall = useMemo(() => summarizeScenarios(measured.map((x) => x.s), net), [measured, net]);

  const groups = useMemo(() => {
    const by = new Map<string, ScenarioTrade[]>();
    for (const { e, s } of measured) {
      const v = dimension.valueOf(e, dimensionContext);
      if (v == null) continue;
      for (const b of Array.isArray(v) ? v : [v]) by.set(b, [...(by.get(b) ?? []), s]);
    }
    return [...by.entries()]
      .map(([bucket, ts]) => ({ bucket, label: dimension.labelOf?.(bucket) ?? bucket, sum: summarizeScenarios(ts, net) }))
      .filter((g): g is { bucket: string; label: string; sum: ScenarioSummary } => g.sum != null)
      .sort((a, b) => b.sum.n - a.sum.n);
  }, [measured, dimension, dimensionContext, net]);

  if (measured.length === 0 && unmeasured === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">SL × TP — what would have happened</CardTitle>
          <div className="flex gap-1 text-xs">
            {[true, false].map((v) => (
              <button
                key={String(v)}
                type="button"
                onClick={() => setNet(v)}
                className={cn(
                  "rounded border px-2 py-0.5",
                  net === v ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground",
                )}
              >
                {v ? "Net of commission" : "Gross"}
              </button>
            ))}
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          Each trade replayed from its average entry on the exchange candles to 15:10 CT with the stop at 0.5–2× the
          real one and targets of 1–5R of that stop. Same money at risk: a wider stop is fewer contracts, so every cell
          is in R of its own stop.
          {unmeasured > 0 &&
            ` ${unmeasured} trade${unmeasured === 1 ? " is" : "s are"} not measured yet — futures-trading measures a trade once its Topstep day is over and the exact data is out.`}
        </p>
      </CardHeader>

      {overall && (
        <CardContent className="space-y-5 text-sm">
          <div className="flex flex-wrap gap-x-6 gap-y-1">
            <span>
              <b>{overall.n}</b> measured
              {overall.n < SCENARIO_MIN_SAMPLE && (
                <span className="text-amber-600 dark:text-amber-500"> ⚠ under {SCENARIO_MIN_SAMPLE}: a hypothesis</span>
              )}
            </span>
            <span>
              As managed: <b>{r2(overall.actualMeanR)}</b> per trade
            </span>
            <span>
              Best cell: <b>{bestLabel(overall)}</b>
            </span>
            <span>
              Best target on your stop: <b>{bestOnRealStop(overall)}</b>
            </span>
          </div>

          <ScenarioGrid
            sl={overall.sl}
            tp={overall.tp}
            values={overall.cells.map((r) => r.map((c) => c.meanR))}
            hitRates={overall.cells.map((r) => r.map((c) => c.hitRate))}
            realRow={overall.realRow}
            best={overall.best}
            plannedTargetR={overall.plannedTargetR}
          />

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">After the exit (median, R of the trade)</div>
              <table className="w-full text-xs tabular-nums">
                <thead>
                  <tr className="text-muted-foreground">
                    <th className="py-1 text-left font-medium">Window</th>
                    <th className="py-1 text-right font-medium">Your way</th>
                    <th className="py-1 text-right font-medium">Against</th>
                  </tr>
                </thead>
                <tbody>
                  {WINDOWS.map(([w, label]) => (
                    <tr key={w} className="border-t">
                      <td className="py-1">{label}</td>
                      <td className="py-1 text-right text-[var(--profit)]">{r2(overall.afterExit[w].fav)}</td>
                      <td className="py-1 text-right text-[var(--loss)]">
                        {overall.afterExit[w].adv == null ? "—" : r2(-overall.afterExit[w].adv!)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="space-y-1 text-xs">
              <li>
                <b>Stops:</b> {overall.afterStop.n} with a planned target —{" "}
                <b>{overall.afterStop.targetAfter}</b> saw the target come after the stop
                {overall.afterStop.medianMinutes != null && ` (median ${Math.round(overall.afterStop.medianMinutes)} min later)`}.
              </li>
              <li>
                <b>Targets:</b> {overall.afterTarget.n} hit — <b>{overall.afterTarget.continuedOneR}</b> ran on 1R or more
                by 15:10 CT (median {r2(overall.afterTarget.medianFavEodR)} further).
              </li>
              <li>
                <b>Hand exits:</b> {overall.afterHand.n} with a planned target — held, <b>{overall.afterHand.wouldHitTarget}</b>{" "}
                would have reached it and <b>{overall.afterHand.stopFirst}</b> would have been stopped first.
              </li>
              <li>
                <b>Stop that lived to the target:</b> the target came in {overall.slForTarget.reached} of{" "}
                {overall.slForTarget.withTarget}; the stop it needed — median {r2(overall.slForTarget.medianR)}, 8 in 10 within{" "}
                {r2(overall.slForTarget.p80R)}.
              </li>
              <li>
                <b>Before the stop:</b> median {r2(overall.mfeBeforeStop.medianR)} your way, a quarter went beyond{" "}
                {r2(overall.mfeBeforeStop.p75R)}.
              </li>
            </ul>
          </div>

          {groups.length > 1 && (
            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">
                By {dimension.label.toLowerCase()} — change the grouping at the top of the report
                {dimension.multiValue ? " (a trade can sit in several rows)" : ""}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs tabular-nums">
                  <thead>
                    <tr className="text-muted-foreground">
                      <th className="py-1 text-left font-medium">{dimension.label}</th>
                      <th className="py-1 text-right font-medium">Trades</th>
                      <th className="py-1 text-right font-medium">As managed</th>
                      <th className="py-1 text-right font-medium">Best cell</th>
                      <th className="py-1 text-right font-medium">Best target, your stop</th>
                      <th className="py-1 text-right font-medium">Target after stop</th>
                      <th className="py-1 text-right font-medium">Stop for target (median)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map(({ bucket, label, sum }) => (
                      <tr key={bucket} className="border-t">
                        <td className="py-1">{label}</td>
                        <td className="py-1 text-right">
                          {sum.n}
                          {sum.n < SCENARIO_MIN_SAMPLE && <span className="text-amber-600 dark:text-amber-500"> ⚠</span>}
                        </td>
                        <td className="py-1 text-right">{r2(sum.actualMeanR)}</td>
                        <td className="py-1 text-right">{bestLabel(sum)}</td>
                        <td className="py-1 text-right">{bestOnRealStop(sum)}</td>
                        <td className="py-1 text-right">
                          {sum.afterStop.targetAfter}/{sum.afterStop.n}
                        </td>
                        <td className="py-1 text-right">{r2(sum.slForTarget.medianR)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            The grid ignores slippage through the stop and treats the whole position as one entry. A best cell that
            beats the managed result by a little on a small sample is noise; one that holds across groups and months is
            a rule worth testing.
          </p>
        </CardContent>
      )}
    </Card>
  );
}
