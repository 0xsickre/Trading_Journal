"use client";

import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScoreBar } from "@/components/journal/viz/tile-visuals";
import { canDrawRadar, radarAxes } from "@/lib/journal/sickre-radar";
import {
  MIN_SAMPLE,
  RELIABLE_SAMPLE,
  type SickreScore,
} from "@/lib/journal/sickre-score";

/**
 * Composite score with its components exposed.
 *
 * THREE LAYERS, EACH ANSWERING A DIFFERENT QUESTION, IN THE ORDER A READER ASKS
 * THEM. The headline says how it is going. The radar says where the shape is
 * dented — which component to look at — and the bar under it says where that
 * number falls on a bad-to-good scale, because 64 means nothing to someone
 * seeing it for the first time. The component list, folded away, says exactly
 * how the number was built: every weight, every dropped component, every
 * renormalization.
 *
 * The list is FOLDED, NOT DROPPED, and that is the whole argument for keeping
 * it once a radar exists. A radar shows relative standing between components
 * but cannot show a weight — that profit factor is a quarter of the score and
 * recovery factor a tenth is not recoverable from any polygon. Nor can it say
 * that a component was dropped and the rest renormalized. Those are the two
 * facts that stop this number being a horoscope, so they stay one click away
 * rather than in a tooltip or a help page.
 *
 * It opens itself whenever the score is thin or partial, on the reasoning that
 * a reader who is being handed a shaky number should not have to go looking for
 * the reason it is shaky.
 */
export function SickreScoreCard({ score }: { score: SickreScore }) {
  const value = score.score;
  const { confidence } = score;
  const axes = radarAxes(score);
  const showRadar = canDrawRadar(score);
  const total = score.components.length;

  // Thin or partial data is exactly when the breakdown is worth reading.
  const detailsOpen = confidence.level !== "ok";

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Sickre Score</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-baseline gap-3">
          <span
            className={`text-4xl font-semibold tabular-nums ${scoreClass(value)}`}
          >
            {value == null ? "—" : Math.round(value)}
          </span>
          <span className="text-sm text-muted-foreground">/ 100</span>
          {/* The sample rides next to the number, not in a tooltip. A score off
              twelve trades is a real score and an unstable one, and the reader
              can only know which if the n is on screen with it. */}
          {confidence.level === "provisional" && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              provisional · {confidence.trades}{" "}
              {confidence.trades === 1 ? "trade" : "trades"}
            </span>
          )}
          {/* Against maxCoverage, not 100: the total is 115 once the process
              component is supplied, so a hardcoded 100 would render a partial
              score as fully covered. */}
          {score.coverage > 0 && score.coverage < score.maxCoverage && (
            <span className="ml-auto text-xs text-muted-foreground">
              {Math.round((score.coverage / score.maxCoverage) * 100)}% of weights covered
            </span>
          )}
        </div>

        {showRadar && (
          <div>
            <ResponsiveContainer width="100%" height={210}>
              <RadarChart data={axes} outerRadius="70%">
                <PolarGrid stroke="var(--border)" />
                <PolarAngleAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                />
                {/* FIXED 0–100, NOT AUTO-SCALED. Recharts would otherwise fit
                    the radius to whatever the data happens to span, and a book
                    scoring 20 across the board would draw the same polygon as
                    one scoring 90. The shape has to mean the same thing on
                    every account or it means nothing on any of them. */}
                <PolarRadiusAxis
                  domain={[0, 100]}
                  tick={false}
                  axisLine={false}
                />
                <Radar
                  dataKey="score"
                  /* Blue, not green: on this page green means money went up,
                     and the score is not money. */
                  stroke="var(--chart-3)"
                  fill="var(--chart-3)"
                  fillOpacity={0.28}
                />
              </RadarChart>
            </ResponsiveContainer>
            {/* The axis count, stated. A polygon with two corners missing looks
                like a shape, not like a gap, unless something says so. */}
            <p className="text-center text-xs text-muted-foreground">
              {axes.length} of {total} components · {score.coverage} of{" "}
              {score.maxCoverage} weights
            </p>
          </div>
        )}

        <ScoreBar score={value} />

        {!showRadar && value != null && (
          <p className="text-xs text-muted-foreground">
            {axes.length} of {total} components have data. A radar over{" "}
            {axes.length} {axes.length === 1 ? "axis" : "axes"} would describe
            the gaps rather than the book, so the breakdown is listed instead.
          </p>
        )}

        {confidence.level === "withheld" ? (
          // Said outright. A bare "—" over seven dashes reads as a broken card
          // rather than as an account with no history yet, and the countdown is
          // the one thing the trader can act on.
          <p className="text-xs text-muted-foreground">
            {confidence.reason === "sample" ? (
              <>
                No score yet — it needs{" "}
                <strong>
                  {confidence.tradesShort} more{" "}
                  {confidence.tradesShort === 1 ? "closed trade" : "closed trades"}
                </strong>
                . Below {MIN_SAMPLE} trades every component is an artefact of the sample:
                a single winner gives an infinite profit factor, zero drawdown and a
                100 % win rate — four maxima that mean nothing.
              </>
            ) : (
              <>
                The score is withheld because less than half the weights are covered.
                What is measured is shown below by component — but one
                component under a composite&apos;s name is not a composite.
              </>
            )}
          </p>
        ) : null}

        {confidence.level === "provisional" && (
          <p className="text-xs text-muted-foreground">
            The sample is still small, so the score will swing noticeably with every trade.
            It settles around {RELIABLE_SAMPLE} closed trades.
          </p>
        )}

        <details open={detailsOpen} className="group">
          <summary className="cursor-pointer text-xs text-muted-foreground marker:text-muted-foreground/60">
            Components ({axes.length} of {total} with data)
          </summary>

          {/* Labelled so a query for a component name can be scoped to this
              list. Nothing needs that today — recharts draws no axis ticks
              under this repo's test mock, so the names are unique on the page —
              but the day that mock gains dimensions, "Profit factor" would
              match twice and the failure would land on an assertion that has
              nothing to do with the change. */}
          <section
            aria-label="Score components"
            className="mt-3 space-y-2"
          >
            {score.components.map((c) => (
              <div key={c.key} className="flex items-center gap-3 text-sm">
                <span className="w-36 shrink-0 text-muted-foreground">
                  {c.label}
                </span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  {c.counted && c.score != null && (
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${Math.max(0, Math.min(100, c.score))}%` }}
                    />
                  )}
                </div>
                <span className="w-10 shrink-0 text-right tabular-nums">
                  {c.counted && c.score != null ? Math.round(c.score) : "—"}
                </span>
                <span className="w-9 shrink-0 text-right text-xs text-muted-foreground">
                  {c.weight}%
                </span>
              </div>
            ))}
          </section>

          {score.components.some((c) => !c.counted) && (
            <p className="mt-3 text-xs text-muted-foreground">
              Components without data are dropped and the remaining weights are
              renormalized — a young track record is not punished for arithmetic
              that has nothing to divide.
            </p>
          )}

          <p className="mt-3 text-xs text-muted-foreground">
            The max drawdown component divides the fall by the peak of <strong>cumulative P&amp;L</strong>,
            not the equity shown above. Two different denominators — this one is chosen
            so the score stays comparable with the same metric in other tools.
          </p>
        </details>
      </CardContent>
    </Card>
  );
}

function scoreClass(v: number | null): string {
  if (v == null) return "text-muted-foreground";
  if (v >= 70) return "text-[var(--profit)]";
  if (v >= 40) return "";
  return "text-[var(--loss)]";
}
