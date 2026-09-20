"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ErrorBar,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AXIS_PROPS,
  ChartShell,
  GRID_PROPS,
  SERIES_COLORS,
  TOOLTIP_STYLE,
} from "@/components/journal/chart-shell";
import { formatMetric, metric, type ViewMode } from "@/lib/journal/units";
import { bucketLabel } from "@/lib/journal/reports/dimensions";
import type { ReportResult } from "@/lib/journal/reports/engine";
import type { ReportMetric } from "@/lib/journal/reports/metrics";

/**
 * One metric across the groups, as bars.
 *
 * Every number goes through `formatMetric`, the formatter the table uses — the
 * axis too. The axis used to print raw numbers, so Privacy mode hid the table
 * and still drew the amounts down the left edge, and % mode labelled dollars.
 *
 * A group with no value (a win rate of scratches, R without stops) has no bar
 * and reads "—", where `Number(null)` used to draw and label it 0. An infinite
 * value (a profit factor with no losing trade) is kept out of the axis range —
 * one ∞ would flatten every other bar to nothing — and reads "∞" in the tooltip.
 */
export function ReportChart({
  result,
  metric: m,
  viewMode,
  currency,
  equityBase,
  action,
}: {
  result: ReportResult;
  metric: ReportMetric;
  viewMode: ViewMode;
  currency: string;
  equityBase: number | null;
  action?: React.ReactNode;
}) {
  const fmt = (v: number | null) =>
    formatMetric(metric(v, m.unit, { currency, equityBase }), viewMode);

  const data = result.rows.map((row) => {
    const raw = row.values[m.key] ?? null;
    const value = raw != null && Number.isFinite(raw) ? raw : null;
    const ci = row.intervals?.[m.key] ?? null;
    return {
      bucket: bucketLabel(result.dimension, row.bucket),
      n: row.n,
      belowSample: row.belowSample,
      raw,
      value,
      /**
       * Recharts wants the whisker as a distance from the bar, not as bounds.
       * Dropped when either end is not finite — a profit factor whose upper
       * bound is infinite has no line that could be drawn honestly.
       */
      err:
        ci && value != null && Number.isFinite(ci.lo) && Number.isFinite(ci.hi)
          ? ([Math.max(0, value - ci.lo), Math.max(0, ci.hi - value)] as [number, number])
          : null,
    };
  });

  const hidden = viewMode === "privacy" && m.unit !== "count" && m.unit !== "ratio" && m.unit !== "seconds";
  const plottable = data.some((d) => d.value != null);
  const colorBySign = m.unit === "money" || m.unit === "r";

  return (
    <ChartShell
      title={`${m.label} by ${result.dimension.label.toLowerCase()}`}
      action={action}
      empty={
        plottable ? undefined : (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No {m.label.toLowerCase()} to plot for these groups.
          </p>
        )
      }
    >
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ left: 4, right: 8, top: 8 }}>
            <CartesianGrid {...GRID_PROPS} />
            <XAxis
              dataKey="bucket"
              {...AXIS_PROPS}
              interval="preserveStartEnd"
              angle={data.length > 6 ? -25 : 0}
              textAnchor={data.length > 6 ? "end" : "middle"}
              height={data.length > 6 ? 60 : 30}
            />
            <YAxis
              {...AXIS_PROPS}
              width={hidden ? 8 : 72}
              tick={hidden ? false : AXIS_PROPS.tick}
              tickFormatter={(v: number) => fmt(v)}
            />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              cursor={{ fill: "var(--muted)", opacity: 0.4 }}
              formatter={(_v, _name, item) => {
                const raw = (item?.payload as { raw?: number | null } | undefined)?.raw ?? null;
                return [raw === Infinity ? "∞" : fmt(raw), m.label];
              }}
              labelFormatter={(label, payload) => {
                const n = payload?.[0]?.payload?.n;
                return n != null ? `${label} · ${n} ${n === 1 ? "trade" : "trades"}` : String(label);
              }}
            />
            <ReferenceLine y={0} stroke="var(--border)" />
            <Bar dataKey="value" isAnimationActive={false} radius={[3, 3, 0, 0]}>
              {/* The 95 % interval, where the metric has one. A bar whose
                  whisker crosses the zero line has not established its sign. */}
              {data.some((d) => d.err != null) && (
                <ErrorBar dataKey="err" width={4} strokeWidth={1} stroke="var(--muted-foreground)" />
              )}
              {/* Sample size as opacity: a thin bar is not read with the same
                  confidence as a solid one. */}
              {data.map((d, idx) => (
                <Cell
                  key={idx}
                  fillOpacity={d.belowSample ? 0.35 : 1}
                  fill={
                    colorBySign
                      ? (d.value ?? 0) < 0
                        ? "var(--loss)"
                        : "var(--profit)"
                      : SERIES_COLORS[0]
                  }
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartShell>
  );
}
