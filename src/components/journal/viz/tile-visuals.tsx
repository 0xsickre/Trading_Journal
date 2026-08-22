"use client";

import { useId } from "react";
import {
  dashArc,
  excursionBarLayout,
  fraction,
  semiArc,
  sparkPoints,
  splitShares,
} from "@/lib/journal/viz/geometry";

/**
 * Redundant visual encodings for KPI tiles — a gauge beside the number, never
 * instead of it.
 *
 * WHY HAND-WRITTEN SVG AND NOT RECHARTS. Both dashboard test files mock
 * `ResponsiveContainer` to a fixed-size div WITHOUT cloning width and height
 * onto the child, which is the only thing the real one does — so a recharts
 * chart under that mock receives no dimensions and draws nothing assertable. A
 * `viewBox` behaves identically in jsdom and in a browser, so these shapes can
 * be PROVEN to track their numbers rather than merely looking right on the
 * machine of whoever last touched them. That is the same standard the rest of
 * this repo holds money to (`book.fixture.test.ts` → `lib/` → screen); a shape
 * a reader takes in before they read the digits deserves it too. The second
 * reason is cheaper: four tiles would otherwise mount four recharts trees, each
 * with a store and a `ResizeObserver`, to draw two `<path>` elements.
 *
 * TWO INVARIANTS, BOTH ASSERTED IN `tile-visuals.render.test.tsx`:
 *
 *   1. **No text nodes.** `Stat` locates its value as `children[1].textContent`
 *      of the card content, and nine dashboard assertions compare that string
 *      exactly. These render outside `CardContent` so they cannot reach it —
 *      but a `<title>` added here later would also be read aloud beside the
 *      number that already says the same thing, so the rule stands on its own.
 *   2. **`null` draws the track and no fill.** A gauge with no data and a gauge
 *      at zero must not look alike. See `geometry.ts`'s module note.
 *
 * Each export carries its own positioning, because there are exactly two
 * placements — a shape in the right gutter, or a line bleeding along the bottom
 * — and repeating those classes at four call sites is how they drift apart.
 */

/**
 * Profit factor that fills the ring completely.
 *
 * 3.0 rather than the 2.6 where `RATIO_BANDS` already tops out: the bands score
 * a *result*, and pinning the ring to the same point would leave every good
 * book drawing an identical full circle. A little headroom above "excellent"
 * keeps the shape informative exactly where the reader is doing best.
 */
export const PROFIT_FACTOR_FULL = 3;

/** Right-gutter wrapper. `Stat` reserves the space with `pr-14` / `pr-16`. */
function Gutter({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-end pr-3">{children}</div>
  );
}

/**
 * Semicircular gauge for a percentage.
 *
 * `pct` is 0–100, or `null` when the statistic has no denominator — an
 * all-breakeven book has no decided trades to have won, which is not a 0 % win
 * rate. The tile shows "—" in that case and this shows an empty arc.
 */
export function SemiGauge({
  pct,
  width = 56,
  stroke = 6,
  tone = "var(--chart-3)",
}: {
  pct: number | null;
  width?: number;
  stroke?: number;
  tone?: string;
}) {
  const arc = semiArc(width, stroke);
  const filled = fraction(pct, 0, 100);
  const { dash, gap } = dashArc(filled, arc.length);

  return (
    <Gutter>
      <svg
        width={width}
        height={arc.height}
        viewBox={`0 0 ${width} ${arc.height}`}
        fill="none"
        data-viz="semi-gauge"
      >
        <path
          d={arc.d}
          stroke="var(--muted)"
          strokeWidth={stroke}
          strokeLinecap="round"
        />
        {filled != null && (
          <path
            d={arc.d}
            stroke={tone}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${gap}`}
            data-viz-fill=""
          />
        )}
      </svg>
    </Gutter>
  );
}

/**
 * Closed ring for a ratio.
 *
 * `value` is the raw ratio and `full` the value that closes the circle, so the
 * scale lives at the call site where the metric is known. `Infinity` — a book
 * with winners and no losses — fills the ring completely, because that is the
 * maximum and not a gap in the data; `fraction` settles that.
 */
export function DonutRing({
  value,
  full,
  size = 44,
  stroke = 5,
  tone = "var(--chart-3)",
}: {
  value: number | null;
  full: number;
  size?: number;
  stroke?: number;
  tone?: string;
}) {
  const r = Math.max(0, (size - stroke) / 2);
  const circumference = 2 * Math.PI * r;
  const filled = fraction(value, 0, full);
  const { dash, gap } = dashArc(filled, circumference);
  const c = size / 2;

  return (
    <Gutter>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        fill="none"
        data-viz="donut-ring"
      >
        <circle cx={c} cy={c} r={r} stroke="var(--muted)" strokeWidth={stroke} />
        {filled != null && (
          <circle
            cx={c}
            cy={c}
            r={r}
            stroke={tone}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${gap}`}
            /* From twelve o'clock, like every dial the reader has ever seen. */
            transform={`rotate(-90 ${c} ${c})`}
            data-viz-fill=""
          />
        )}
      </svg>
    </Gutter>
  );
}

/**
 * Proportional two-sided bar — the asymmetry between two magnitudes, seen
 * before either number is read.
 *
 * Green and red here mean what they mean everywhere else on this page, and for
 * once that is correct rather than a collision: the two sides genuinely ARE an
 * average win and an average loss. Renders nothing when either side is missing,
 * since a bar drawn from one side alone lies about a ratio.
 *
 * FULL-BLEED ALONG THE BOTTOM EDGE, not an inset pill. Measured in the running
 * app: an inset bar sitting two units up overlaps the value's line box by a
 * pixel on a `text-lg` tile, and the tile has no room to give it without
 * handing back the vertical space `py-0` just won. Flush against the edge it
 * clears the text by eight, and it matches how `Sparkline` bleeds — one
 * treatment for "a shape along the bottom of a tile" rather than two.
 */
export function SplitBar({
  left,
  right,
  height = 4,
}: {
  left: number | null;
  right: number | null;
  height?: number;
}) {
  const shares = splitShares(left, right);
  if (shares == null) return null;

  return (
    <div
      className="absolute inset-x-0 bottom-0 flex"
      style={{ height }}
      data-viz="split-bar"
    >
      <div style={{ width: `${shares.left}%`, background: "var(--profit)" }} />
      <div style={{ width: `${shares.right}%`, background: "var(--loss)" }} />
    </div>
  );
}

/** A sparkline needs a path, and two points are the fewest that make one. */
const MIN_SPARK_POINTS = 2;

/**
 * The shape of a series, bleeding along the bottom of the tile.
 *
 * Deliberately unlabelled and unscaled: the number in the tile carries the
 * magnitude, this carries the path it took. Drawn at low opacity so it reads as
 * ground rather than as a chart competing with the figure above it.
 *
 * NOTHING IS DRAWN BELOW TWO POINTS, and that rule was written after looking at
 * the running app rather than at the code. `buildEquity` opens every series
 * with the account's starting balance, so a book with no trades arrives here as
 * exactly one point — which `sparkPoints` will honestly render as a flat line,
 * because one value genuinely has no slope. On screen that line says "equity
 * held steady" underneath a tile reading `$0.00` over `0` trades, and the truth
 * is that there is no history to have held steady. Same distinction the gauges
 * make one function up: no evidence is not a measurement of zero.
 */
export function Sparkline({
  values,
  tone = "var(--chart-3)",
  width = 120,
  height = 28,
}: {
  values: readonly number[];
  tone?: string;
  width?: number;
  height?: number;
}) {
  const stroke = 1.5;
  if (values.filter((v) => Number.isFinite(v)).length < MIN_SPARK_POINTS) {
    return null;
  }
  const points = sparkPoints(values, width, height, stroke);
  if (points === "") return null;

  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-0 opacity-40"
      data-viz="sparkline"
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="h-7 w-full"
        fill="none"
      >
        <polyline
          points={points}
          stroke={tone}
          strokeWidth={stroke}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}

/**
 * A 0–100 score placed on a bad-to-good scale.
 *
 * THE GRADIENT IS SVG AND NOT CSS, WHICH IS NOT A STYLE PREFERENCE. This app
 * ships a print stylesheet whose `* { background: transparent !important }`
 * resets `background-image` along with `background-color` — the shorthand takes
 * both — so a `bg-gradient-to-r` bar comes out of the printer blank. An SVG
 * `<linearGradient>` fill is untouched by that rule.
 *
 * Red through amber to green is the one place on this page where those colours
 * do NOT mean money direction, and it is deliberate: here the axis genuinely
 * runs bad to good, which is the meaning the reader already brings to a red-to-
 * green ramp. Everywhere else green means "up", which is why the gauges avoid
 * it.
 *
 * Renders nothing without a score. The bar's whole job is to place a number on
 * a scale, and there is no placing of a number that was withheld.
 */
export function ScoreBar({ score }: { score: number | null }) {
  // Scoped per instance. `drawdown-chart.tsx` learned this the hard way with a
  // hardcoded gradient id: two of the same chart on one page and the second
  // silently takes the first's fill.
  const gradientId = useId();
  if (score == null) return null;

  const at = Math.max(0, Math.min(100, score));

  return (
    <svg
      viewBox="0 0 100 8"
      preserveAspectRatio="none"
      className="h-2 w-full"
      data-viz="score-bar"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--loss)" />
          <stop offset="50%" stopColor="var(--chart-4)" />
          <stop offset="100%" stopColor="var(--profit)" />
        </linearGradient>
      </defs>
      <rect x="0" y="2" width="100" height="4" rx="2" fill={`url(#${gradientId})`} />
      {/* A bar rather than a dot: `preserveAspectRatio="none"` stretches the
          viewBox horizontally, which would flatten a circle into an ellipse of
          whatever width the card happens to be. */}
      <rect
        x={at - 0.5}
        y="0"
        width="1"
        height="8"
        rx="0.5"
        fill="var(--foreground)"
        data-viz-marker=""
      />
    </svg>
  );
}

/**
 * Sickre Scale — one trade's excursion, drawn as a range.
 *
 * −maeR on the left, +mfeR on the right, entry at wherever those two balance
 * (not the bar's midpoint — a trade that ran hard offside and only barely
 * favourable draws mostly red, not a bar split down the middle regardless of
 * what happened). The marker is the realized result inside that range: deep
 * in the green side means most of the favourable move was kept, near the red
 * edge means it gave most of it back.
 *
 * Renders nothing without both maeR and mfeR — see `excursionBarLayout`.
 */
export function ExcursionBar({
  maeR,
  mfeR,
  realizedR,
}: {
  maeR: number | null;
  mfeR: number | null;
  realizedR: number | null;
}) {
  const layout = excursionBarLayout(maeR, mfeR, realizedR);
  if (layout == null) return null;

  return (
    <svg
      viewBox="0 0 100 8"
      preserveAspectRatio="none"
      className="h-2 w-full"
      data-viz="excursion-bar"
    >
      <rect x="0" y="2" width={layout.zeroPct} height="4" rx="2" fill="var(--loss)" opacity="0.5" />
      <rect
        x={layout.zeroPct}
        y="2"
        width={100 - layout.zeroPct}
        height="4"
        rx="2"
        fill="var(--profit)"
        opacity="0.5"
      />
      {/* Entry reference line. */}
      <rect x={layout.zeroPct - 0.25} y="0" width="0.5" height="8" fill="var(--muted-foreground)" />
      {layout.markerPct != null && (
        <rect
          x={layout.markerPct - 0.5}
          y="0"
          width="1"
          height="8"
          rx="0.5"
          fill="var(--foreground)"
          data-viz-marker=""
        />
      )}
    </svg>
  );
}
