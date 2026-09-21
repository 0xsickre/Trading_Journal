"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScoreBar } from "@/components/journal/viz/tile-visuals";
import {
  MIN_SAMPLE,
  RELIABLE_SAMPLE,
  UNDER_WATER_FLOOR_DAYS,
  type Scorecard,
} from "@/lib/journal/scorecard";

/**
 * Three numbers, side by side, that do not share a denominator.
 *
 * WHAT THIS REPLACES. One composite with a radar, a coverage percentage and a
 * folded list of seven weighted components — a card whose own structure was an
 * admission that the headline had to be taken apart before it could be read.
 * A reader could not tell whether it moved because they traded differently or
 * because more of the data arrived.
 *
 * So there is no headline. Process says whether you did what you said you
 * would, Survival says how close the account came to not continuing, and Edge
 * says what a trade is worth — with its interval, because on this book that
 * interval usually still contains zero and the card's job is to say so rather
 * than to round it away.
 *
 * Each axis carries its own parts underneath, and a missing part is an em dash:
 * a gated figure is never a zero and never a hundred.
 */
export function ScorecardCard({ card }: { card: Scorecard }) {
  const { process: proc, survival, edge } = card;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Process · Survival · Edge</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Axis
            label="Process"
            score={proc.score}
            hint="Tracker compliance and the playbook follow rate, blended 60/40. The only figure here that is entirely yours to move."
            parts={[
              ["Tracker", pct(proc.trackerPct)],
              ["Follow rate", pct(proc.followRatePct)],
            ]}
          />
          <Axis
            label="Survival"
            score={survival.score}
            hint={`How deep the worst fall was, how long the account has been under water, and the room left against a prop-firm limit. The time part reaches zero at ${UNDER_WATER_FLOOR_DAYS} days.`}
            parts={[
              ["Max DD", pct(survival.drawdownPct)],
              [
                "Under water",
                survival.underWaterDays == null ? "—" : `${survival.underWaterDays} d`,
              ],
              ["FTMO room", pct(survival.ftmoHeadroomPct)],
            ]}
          />
          <div className="space-y-1" role="group" aria-label="Edge">
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-muted-foreground">Edge</span>
              {edge.n > 0 && (
                <span className="text-[11px] text-muted-foreground">n={edge.n}</span>
              )}
            </div>
            {/* NOT a 0–100 score, and that is the point: squeezing an interval
                onto a band throws away the only thing that makes a small-sample
                expectancy readable. */}
            <div
              className={`text-2xl font-semibold tabular-nums ${
                edge.expectancyR == null || edge.inconclusive
                  ? "text-muted-foreground"
                  : edge.expectancyR > 0
                    ? "text-[var(--profit)]"
                    : "text-[var(--loss)]"
              }`}
            >
              {edge.expectancyR == null ? "—" : `${fmtR(edge.expectancyR)}R`}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {edge.interval
                ? `95 %: ${fmtR(edge.interval.lo)} – ${fmtR(edge.interval.hi)}`
                : `needs ${MIN_SAMPLE} decided trades`}
            </div>
          </div>
        </div>

        <ScoreBar score={proc.score} />

        <p className="text-xs text-muted-foreground">
          {edge.inconclusive && edge.expectancyR != null ? (
            <>
              The interval around your expectancy still includes zero, so this
              book has not yet shown an edge one way or the other. On forty to
              seventy trades a year that is the usual answer, and it is not a
              verdict against the strategy — it is the sample speaking.{" "}
            </>
          ) : null}
          {card.provisional && (
            <>
              {card.trades} closed {card.trades === 1 ? "trade" : "trades"} —
              Survival will still swing noticeably; it settles around{" "}
              {RELIABLE_SAMPLE}.{" "}
            </>
          )}
          {survival.score == null && card.trades < MIN_SAMPLE && (
            <>
              Survival needs {MIN_SAMPLE} closed trades: below that a drawdown of
              zero would score a perfect hundred, and no evidence must not read
              as flawless.
            </>
          )}
        </p>
      </CardContent>
    </Card>
  );
}

function Axis({
  label,
  score,
  hint,
  parts,
}: {
  label: string;
  score: number | null;
  hint: string;
  parts: [string, string][];
}) {
  return (
    <div className="space-y-1" role="group" aria-label={label} title={hint}>
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className={`text-2xl font-semibold tabular-nums ${scoreClass(score)}`}>
        {score == null ? "—" : Math.round(score)}
        {score != null && (
          <span className="ml-1 text-xs font-normal text-muted-foreground">/ 100</span>
        )}
      </div>
      <div className="space-y-0.5">
        {parts.map(([name, value]) => (
          <div
            key={name}
            className="flex justify-between text-[11px] text-muted-foreground"
          >
            <span>{name}</span>
            <span className="tabular-nums">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const pct = (v: number | null): string => (v == null ? "—" : `${Math.round(v)}%`);
const fmtR = (v: number): string => `${v > 0 ? "+" : ""}${v.toFixed(2)}`;

function scoreClass(v: number | null): string {
  if (v == null) return "text-muted-foreground";
  if (v >= 70) return "text-[var(--profit)]";
  if (v >= 40) return "";
  return "text-[var(--loss)]";
}
