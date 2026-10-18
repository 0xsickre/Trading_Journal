"use client";

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS_PROPS, GRID_PROPS, SERIES_COLORS, TOOLTIP_PROPS } from "@/components/journal/chart-shell";
import type { BiasCurvePoint } from "@/lib/journal/daily-bias";

/** Bias dana: cumulative points of my forecast and of always-long, on the same graded days. Drawing only. */
export function BiasChart({ data }: { data: BiasCurvePoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ left: 4, right: 8, top: 8 }}>
        <CartesianGrid {...GRID_PROPS} />
        <XAxis dataKey="day" {...AXIS_PROPS} tick={{ fontSize: 10 }} />
        <YAxis {...AXIS_PROPS} width={56} domain={["auto", "auto"]} />
        <Tooltip {...TOOLTIP_PROPS} formatter={(v) => `${Math.round(Number(v))} poena`} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line type="monotone" dataKey="mine" name="Moj bias" stroke={SERIES_COLORS[0]} strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="long" name="Uvek long" stroke={SERIES_COLORS[1]} strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
