/**
 * Which components the Sickre Score radar may draw, and when it may draw at all.
 *
 * THIS LIVES IN `lib` AND NOT IN THE CARD FOR A MEASURED REASON. Both dashboard
 * test files mock recharts' `ResponsiveContainer` with a fixed-size div that
 * does not clone width and height onto its child — and a spike against that
 * mock found recharts renders *nothing*: no `<svg>`, no polygon, no axis ticks,
 * just an empty `.recharts-wrapper`. So no render test can prove which axes a
 * radar drew. The rule therefore has to be provable somewhere a test can reach
 * it, which is here.
 *
 * The rule itself is about honesty rather than aesthetics. A radar's whole
 * claim is that its SHAPE means something — a dent on one axis is a weakness.
 * That claim only holds while the axes are the same ones every time and the
 * reader knows which are missing. Two failures follow, and both are guarded:
 *
 *   - **A dropped component gets no axis at all**, never a vertex at zero. It
 *     is the same distinction `sickre-score.ts` exists to make one level up
 *     (`counted: false` reads "—", not `0`) and the same one the tile gauges
 *     make one level down. A vertex pinned at the centre says "measured, and
 *     terrible"; absence says "not measured".
 *   - **Below `MIN_RADAR_AXES` there is no radar.** With three axes the outline
 *     is determined entirely by WHICH three survived, so the shape describes
 *     the gaps in the data rather than the trading. That is a picture of an
 *     absence wearing the name of a performance chart.
 */

import type { SickreScore } from "./sickre-score";

export type RadarAxis = {
  key: string;
  /** Short enough to sit around a 240px polar chart without colliding. */
  label: string;
  /** 0–100, never null: an axis exists only when there is a score for it. */
  score: number;
  weight: number;
};

/**
 * Fewest axes that still make a shape worth reading.
 *
 * Four, and not three: a triangle's outline is fixed by which three components
 * happened to survive, so it carries no information the legend does not already
 * give. Four is the first count where the polygon says something about the
 * trading rather than about the data's gaps.
 *
 * It also agrees with the gate one level up rather than fighting it. The four
 * heaviest components are 25 + 20 + 20 + 15 = 80 of 115 weights, comfortably
 * past `MIN_COVERAGE_SHARE`, so a score that survives `computeSickreScore` has
 * normally already earned enough axes to be drawn.
 */
export const MIN_RADAR_AXES = 4;

/**
 * Labels shortened for the polar axis only.
 *
 * Deliberately NOT changed in `sickre-score.ts`: those labels are quoted in the
 * mentor pack and shown in the component list, where there is room and where
 * the longer wording is clearer. This map exists because a 240px radar has
 * about eleven characters of room per corner, and it is the display that has to
 * bend, not the model.
 */
const SHORT_LABELS: Record<string, string> = {
  profitFactor: "Profit f.",
  avgWinLoss: "Win/loss",
  maxDrawdown: "Drawdown",
  winPct: "Win %",
  recovery: "Recovery",
  consistency: "Consistency",
  process: "Process",
};

/**
 * The axes to plot, in the score's own component order.
 *
 * Order matters and is inherited rather than chosen: `computeSickreScore` lists
 * components heaviest-first, so the polygon's corners stay in one arrangement
 * from render to render. Sorting here by score would make the same book draw a
 * different shape every time it improved, which is the one thing a shape must
 * not do.
 */
export function radarAxes(score: SickreScore): RadarAxis[] {
  return score.components
    .filter((c) => c.counted && c.score != null)
    .map((c) => ({
      key: c.key,
      label: SHORT_LABELS[c.key] ?? c.label,
      score: c.score as number,
      weight: c.weight,
    }));
}

/**
 * Whether a radar may be drawn at all.
 *
 * Both conditions, not either: enough axes AND a headline number. A withheld
 * score means the composite itself was judged unsafe to state, and drawing its
 * shape anyway would restate the same claim in a form the reader cannot argue
 * with.
 */
export function canDrawRadar(score: SickreScore): boolean {
  return score.score != null && radarAxes(score).length >= MIN_RADAR_AXES;
}
