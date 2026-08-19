import { Flame } from "lucide-react";
import { SemiGauge } from "@/components/journal/viz/tile-visuals";

/**
 * The run you are on, on the page where you either extend it or break it.
 *
 * A STRIP, not a card, and that is the whole design constraint.
 * `TrackerStreakCard` already answers this on the dashboard — but it answers it
 * with four figures and a 26-week heatmap, because the dashboard's question is
 * "how has my process been". This page's question is narrower: "am I on a run
 * right now, and how close to the line am I". Dropping the card here would put
 * the same heatmap on two screens and make the daily check-in look like a
 * report.
 *
 * So: no heatmap, and no "longest streak". The record belongs to the screen
 * that reviews history; today only has to know whether today matters.
 */
export function DailyStreakStrip({
  current,
  meanPct,
  scoredDays,
  hasRules,
}: {
  /** Consecutive compliant days ending on the day in view. */
  current: number;
  /** Mean compliance over the scored window, or null when nothing scored. */
  meanPct: number | null;
  /** How many days actually produced a verdict — the denominator behind `meanPct`. */
  scoredDays: number;
  /** False when no rule has ever been created; reads differently from zero. */
  hasRules: boolean;
}) {
  // "No rules yet" is not "a streak of zero". One is a setup step the reader has
  // not taken, the other is a judgement on days they did trade — the same
  // distinction `TrackerStreakCard` keeps, and the reason it takes `hasRules`.
  if (!hasRules) return null;

  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border px-4 py-3">
      <div className="flex items-baseline gap-2">
        <Flame className="size-4 shrink-0 self-center text-muted-foreground" />
        <span className="text-xl font-semibold tabular-nums">{current}</span>
        <span className="text-sm text-muted-foreground">
          {current === 1 ? "day in a row" : "days in a row"}
        </span>
      </div>

      <div className="flex items-center gap-3">
        <div className="text-right">
          <div className="text-xs text-muted-foreground">Consistency</div>
          {/* `null` prints an em dash rather than 0 %, matching the empty arc
              beside it: a window with nothing scored has no average, and
              writing 0 % would report a verdict nobody earned. */}
          <div className="text-sm font-semibold tabular-nums">
            {meanPct == null ? "—" : `${Math.round(meanPct)}%`}
          </div>
        </div>
        {/* Passing `null` straight through is deliberate: `SemiGauge` draws a
            track-only arc for it, which is visibly different from a filled arc
            at zero. */}
        <SemiGauge pct={meanPct} width={48} stroke={5} />
      </div>

      <span className="sr-only">
        {scoredDays === 0
          ? "No days scored yet."
          : `Averaged over ${scoredDays} scored days.`}
      </span>
    </div>
  );
}
