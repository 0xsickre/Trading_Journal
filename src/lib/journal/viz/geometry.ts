/**
 * Geometry for the tile visuals — gauges, rings, split bars, sparklines.
 *
 * Pure arithmetic, deliberately separated from the SVG that consumes it. The
 * components in `components/journal/viz/tile-visuals.tsx` are a thin shell over
 * these functions precisely so the interesting part is testable in the fast
 * `node` project rather than through jsdom, which has no layout engine and
 * would measure every one of those shapes as zero.
 *
 * ONE RULE RUNS THROUGH ALL OF IT: `null` in, `null` out. A gauge with no data
 * must draw an empty track, and an empty track must not look like a gauge
 * sitting at zero. That is the same distinction `sickre-score.ts` was rewritten
 * to make — a dropped component reading "—" instead of a confident 0 — and it
 * matters more here, not less: a reader takes in a shape before they read a
 * number, so a shape that says "nothing" while the data says "no evidence" is
 * the one lie the eye cannot catch.
 */

/**
 * Where `value` sits in `min…max`, as 0…1. Clamped at both ends.
 *
 * `Infinity` answers 1 rather than null. A profit factor with no losing trades
 * IS the maximum — `scoreFromBands` in `sickre-score.ts` already settled this
 * argument for the score ("a maximal result, not missing data"), and a ring
 * that emptied itself on a flawless book would say the opposite of the truth.
 */
export function fraction(
  value: number | null | undefined,
  min: number,
  max: number,
): number | null {
  if (value == null || Number.isNaN(value)) return null;
  if (value === Infinity) return 1;
  if (value === -Infinity) return 0;
  // A zero-width range has no position to report. Returning 0 would draw an
  // empty gauge for a value that may be at the top of its (degenerate) range.
  if (!(max > min)) return null;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

export type Arc = {
  /** SVG path `d` for the track. */
  d: string;
  /** Length along the path, for `stroke-dasharray`. */
  length: number;
  /** Height the arc needs in its viewBox, stroke included. */
  height: number;
};

/**
 * A semicircular arc spanning `width`, drawn left to right over the top.
 *
 * Returns the path, its length and the height it occupies together, because
 * all three fall out of one radius and splitting them across call sites is how
 * a gauge ends up with a fill that does not match its track.
 */
export function semiArc(width: number, stroke: number): Arc {
  // Inset by half a stroke on each side, or the cap is clipped by the viewBox.
  const r = Math.max(0, (width - stroke) / 2);
  const cx = width / 2;
  const cy = stroke / 2 + r;
  return {
    d: `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`,
    length: Math.PI * r,
    height: r + stroke,
  };
}

export type Dash = { dash: number; gap: number };

/**
 * `stroke-dasharray` pair that fills `fraction` of a path of `length`.
 *
 * One dash and one gap rather than a second path: the fill traces the very same
 * geometry as the track, so the two cannot drift apart no matter what the
 * radius is.
 */
export function dashArc(
  fractionOfPath: number | null,
  length: number,
): Dash {
  // No data draws no fill — the track alone. See the module note.
  if (fractionOfPath == null) return { dash: 0, gap: length };
  const clamped = Math.max(0, Math.min(1, fractionOfPath));
  const dash = clamped * length;
  return { dash, gap: length - dash };
}

export type Split = { left: number; right: number };

/**
 * Two magnitudes as percentages of their sum, always adding to 100.
 *
 * `null` when either side is missing or both are zero. A bar drawn from one
 * side only is a bar that lies about a ratio: with no average loss to compare
 * against, a full green bar reads as "all winners" when it actually means "not
 * enough trades to say".
 */
export function splitShares(
  a: number | null | undefined,
  b: number | null | undefined,
): Split | null {
  if (a == null || b == null) return null;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const left = Math.abs(a);
  const right = Math.abs(b);
  const total = left + right;
  if (!(total > 0)) return null;
  return { left: (left / total) * 100, right: (right / total) * 100 };
}

/**
 * `points` for a `<polyline>` over `values`, normalized to its own window.
 *
 * Min/max within the series, not against any absolute scale: a sparkline says
 * "this is the shape of the move", and the number beside it says how big the
 * move was. Two jobs, and trying to make the shape carry magnitude as well
 * flattens every series that does not happen to straddle zero.
 *
 * `inset` keeps a stroke of that half-width from clipping at the extremes.
 */
export function sparkPoints(
  values: readonly number[],
  w: number,
  h: number,
  inset = 0,
): string {
  const usable = values.filter((v) => Number.isFinite(v));
  if (usable.length === 0) return "";

  const top = inset;
  const bottom = Math.max(inset, h - inset);
  const mid = (top + bottom) / 2;

  // One point is a position, not a trend. A flat line across the full width is
  // the honest drawing of it — a single dot would read as a scale the reader
  // cannot place, and stretching one value into a slope would invent one.
  if (usable.length === 1) return `0,${mid} ${w},${mid}`;

  let min = usable[0];
  let max = usable[0];
  for (const v of usable) {
    if (v < min) min = v;
    if (v > max) max = v;
  }

  // A flat series has no range to divide by, and is genuinely flat — draw it so
  // rather than dividing by zero or spiking to one edge.
  const span = max - min;
  const step = w / (usable.length - 1);

  return usable
    .map((v, i) => {
      const x = i * step;
      // SVG y grows downward, so the largest value sits at the smallest y.
      const y = span > 0 ? bottom - ((v - min) / span) * (bottom - top) : mid;
      return `${round(x)},${round(y)}`;
    })
    .join(" ");
}

/** Two decimals is under a tenth of a pixel at these sizes, and keeps the
 *  attribute short enough to read in devtools. */
function round(n: number): number {
  return Math.round(n * 100) / 100;
}
