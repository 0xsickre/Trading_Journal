"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
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
import type { ReportResult } from "@/lib/journal/reports/engine";

/** Up to three metrics at once, per the spec. */
export const MAX_CHART_METRICS = 3;

export function ReportChart({
  result,
  metricKeys,
  chartType,
  viewMode,
  currency,
  equityBase,
  action,
}: {
  result: ReportResult;
  metricKeys: string[];
  chartType: "bar" | "line";
  viewMode: ViewMode;
  currency: string;
  equityBase: number | null;
  action?: React.ReactNode;
}) {
  const shown = result.metrics.filter((m) => metricKeys.includes(m.key));

  const data = result.rows.map((row) => {
    const point: Record<string, string | number | null | boolean> = {
      bucket: row.bucket,
      n: row.n,
      belowSample: row.belowSample,
    };
    for (const m of shown) point[m.key] = row.values[m.key];
    return point;
  });

  const fmt = (v: number | null, unit: (typeof shown)[number]["unit"]) =>
    formatMetric(metric(v, unit, { currency, equityBase }), viewMode);

  const empty =
    data.length === 0 || shown.length === 0 ? (
      <p className="py-10 text-center text-sm text-muted-foreground">
        No data to plot.
      </p>
    ) : undefined;

  return (
    <ChartShell
      title={`${result.dimension.label} — grafik`}
      subtitle={`Up to ${MAX_CHART_METRICS} metrics at once. Dimmed columns have fewer than ${result.minSample} trades.`}
      action={action}
      empty={empty}
    >
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          {chartType === "bar" ? (
            <BarChart data={data} margin={{ left: 4, right: 8, top: 8 }}>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis dataKey="bucket" {...AXIS_PROPS} interval={0} angle={-20} textAnchor="end" height={60} />
              <YAxis {...AXIS_PROPS} width={64} />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                formatter={(v, name) => {
                  const m = shown.find((x) => x.key === name);
                  return [m ? fmt(Number(v), m.unit) : String(v), m?.label ?? name];
                }}
                labelFormatter={(label, payload) => {
                  const n = payload?.[0]?.payload?.n;
                  return n != null ? `${label} · n=${n}` : String(label);
                }}
              />
              {shown.length > 1 && <Legend />}
              <ReferenceLine y={0} stroke="var(--border)" />
              {shown.map((m, i) => (
                <Bar key={m.key} dataKey={m.key} fill={SERIES_COLORS[i]}>
                  {/* Sample size is expressed as opacity so a thin bar cannot
                      be read with the same confidence as a solid one. */}
                  {data.map((d, idx) => (
                    <Cell
                      key={idx}
                      fillOpacity={d.belowSample ? 0.35 : 1}
                      fill={
                        shown.length === 1 && m.unit === "money"
                          ? Number(d[m.key]) < 0
                            ? "var(--loss)"
                            : "var(--profit)"
                          : SERIES_COLORS[i]
                      }
                    />
                  ))}
                </Bar>
              ))}
            </BarChart>
          ) : (
            <LineChart data={data} margin={{ left: 4, right: 8, top: 8 }}>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis dataKey="bucket" {...AXIS_PROPS} interval={0} angle={-20} textAnchor="end" height={60} />
              <YAxis {...AXIS_PROPS} width={64} />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                formatter={(v, name) => {
                  const m = shown.find((x) => x.key === name);
                  return [m ? fmt(Number(v), m.unit) : String(v), m?.label ?? name];
                }}
                labelFormatter={(label, payload) => {
                  const n = payload?.[0]?.payload?.n;
                  return n != null ? `${label} · n=${n}` : String(label);
                }}
              />
              {shown.length > 1 && <Legend />}
              <ReferenceLine y={0} stroke="var(--border)" />
              {shown.map((m, i) => (
                <Line
                  key={m.key}
                  type="monotone"
                  dataKey={m.key}
                  stroke={SERIES_COLORS[i]}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
    </ChartShell>
  );
}
