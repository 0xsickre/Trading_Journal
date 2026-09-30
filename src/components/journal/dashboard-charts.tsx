"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AXIS_PROPS,
  BAR_CURSOR,
  GRID_PROPS,
  TOOLTIP_PROPS,
} from "@/components/journal/chart-shell";
import { fmtMoney, fmtR } from "@/lib/journal/format";

/**
 * The dashboard's four recharts plots, moved out of `dashboard.tsx`.
 *
 * WHY THEY LEFT. recharts is ~840 KB across two chunks in the production
 * build, and `dashboard.tsx` imported it at module scope. Because the dashboard
 * IS the `/` route, that made recharts part of the first bundle every visitor
 * downloads and parses — including a visitor who has switched every chart
 * widget off, and including the trip to `/settings` that never draws a plot.
 *
 * Split out, each of these is behind a `next/dynamic` boundary at the call
 * site, so the library arrives when a chart is actually rendered.
 *
 * These are deliberately dumb: every one takes the finished series and the few
 * scalars it prints, and holds no state. The memos that produce those series
 * stay in `dashboard.tsx`, where the controls that invalidate them live — this
 * file is the drawing, not the arithmetic.
 *
 * `ChartShell` is NOT used here. It is the card, title and empty-state chrome,
 * it does not pull in recharts, and keeping it on the dashboard side means the
 * heading and the box paint immediately while only the plot inside waits for
 * the library.
 */

export type EquityPoint = { i: number; value: number };

export function EquityChart({
  data,
  metric,
  currency,
}: {
  data: EquityPoint[];
  /** Money or R — decides the tooltip's unit, nothing else. */
  metric: "money" | "r";
  currency: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={data} margin={{ left: 4, right: 8, top: 8 }}>
        <defs>
          <linearGradient id="eq" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.4} />
            <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid {...GRID_PROPS} />
        <XAxis dataKey="i" {...AXIS_PROPS} />
        {/* Fitted to the curve: from zero, a $500 swing on a $50,000 balance is a flat line. */}
        <YAxis {...AXIS_PROPS} width={56} domain={["auto", "auto"]} />
        <Tooltip
          {...TOOLTIP_PROPS}
          formatter={(v) =>
            metric === "money" ? fmtMoney(Number(v), currency) : fmtR(Number(v))
          }
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke="var(--chart-1)"
          strokeWidth={2}
          fill="url(#eq)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export type RHistBucket = { bucket: string; count: number };

export function RDistributionChart({ data }: { data: RHistBucket[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ left: 4, right: 8, top: 8 }}>
        <CartesianGrid {...GRID_PROPS} />
        <XAxis dataKey="bucket" {...AXIS_PROPS} tick={{ fontSize: 10 }} />
        <YAxis allowDecimals={false} {...AXIS_PROPS} width={28} />
        <ReferenceLine x="-1..0" stroke="var(--border)" />
        <Tooltip {...TOOLTIP_PROPS} cursor={BAR_CURSOR} />
        <Bar dataKey="count" radius={[3, 3, 0, 0]}>
          {data.map((b, i) => (
            <Cell
              key={i}
              fill={
                b.bucket.startsWith("-") || b.bucket === "<-3"
                  ? "var(--loss)"
                  : "var(--profit)"
              }
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export type SlippageWeek = {
  week: string;
  avgSlipR: number;
  tradeCount: number;
};

export function SlippageChart({ weeks }: { weeks: SlippageWeek[] }) {
  // Sign flipped for display: positive slippage is a worse fill, and a bar
  // pointing down reads as "worse" to everyone. The colour below keys off the
  // ORIGINAL sign so the two never disagree.
  const data = weeks.map((w) => ({
    week: w.week.slice(5),
    avgDisplayR: -w.avgSlipR,
    tradeCount: w.tradeCount,
  }));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ left: 4, right: 8, top: 8 }}>
        <CartesianGrid {...GRID_PROPS} />
        <XAxis dataKey="week" {...AXIS_PROPS} tick={{ fontSize: 10 }} />
        {/* Zero always in range: with every week on one side, recharts fitted the
            axis to the data and the bars grew from -0.01R instead of from zero.
            Ends rounded out to 0.05R and six ticks, so each tick is a round
            hundredth instead of two labels reading the same after rounding. */}
        <YAxis
          {...AXIS_PROPS}
          width={40}
          domain={[
            (min: number) => Math.min(0, Math.floor(min * 20) / 20),
            (max: number) => Math.max(0, Math.ceil(max * 20) / 20),
          ]}
          tickCount={6}
          tickFormatter={(v) => `${Number(v).toFixed(2)}R`}
        />
        <ReferenceLine y={0} stroke="var(--border)" />
        <Tooltip
          {...TOOLTIP_PROPS}
          cursor={BAR_CURSOR}
          formatter={(v, _name, item) => {
            const payload = item.payload as {
              avgDisplayR: number;
              tradeCount: number;
            };
            return [
              `${Number(v).toFixed(2)}R avg (${payload.tradeCount} trades)`,
              "Slippage",
            ];
          }}
          labelFormatter={(label) => `Week ${label}`}
        />
        <Bar dataKey="avgDisplayR" radius={[3, 3, 0, 0]}>
          {weeks.map((w, i) => (
            <Cell
              key={i}
              fill={
                w.avgSlipR > 0
                  ? "var(--loss)"
                  : w.avgSlipR < 0
                    ? "var(--profit)"
                    : "var(--muted-foreground)"
              }
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export type ExitEffWeek = { week: string; avgPct: number; tradeCount: number };

export function ExitEfficiencyChart({ weeks }: { weeks: ExitEffWeek[] }) {
  const data = weeks.map((w) => ({
    week: w.week.slice(5),
    avgPct: w.avgPct,
    tradeCount: w.tradeCount,
  }));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ left: 4, right: 8, top: 8 }}>
        <CartesianGrid {...GRID_PROPS} />
        <XAxis dataKey="week" {...AXIS_PROPS} tick={{ fontSize: 10 }} />
        <YAxis
          {...AXIS_PROPS}
          width={44}
          tickFormatter={(v) => `${Number(v).toFixed(0)}%`}
        />
        <ReferenceLine y={50} stroke="var(--border)" strokeDasharray="4 4" />
        <Tooltip
          {...TOOLTIP_PROPS}
          cursor={BAR_CURSOR}
          formatter={(v, _name, item) => {
            const payload = item.payload as {
              avgPct: number;
              tradeCount: number;
            };
            return [
              `${Number(v).toFixed(0)}% avg (${payload.tradeCount} trades)`,
              "Target attainment",
            ];
          }}
          labelFormatter={(label) => `Week ${label}`}
        />
        <Bar dataKey="avgPct" radius={[3, 3, 0, 0]}>
          {weeks.map((w, i) => (
            <Cell
              key={i}
              fill={
                w.avgPct >= 50
                  ? "var(--profit)"
                  : w.avgPct >= 0
                    ? "var(--chart-4)"
                    : "var(--loss)"
              }
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
