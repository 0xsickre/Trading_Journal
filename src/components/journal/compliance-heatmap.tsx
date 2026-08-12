"use client";

import { useMemo } from "react";
import { HeatmapGrid } from "@/components/journal/heatmap-grid";
import type { DayCompliance } from "@/lib/journal/tracker/compliance";

/**
 * Process compliance calendar.
 *
 * Two deliberate differences from the P&L heatmap:
 *
 *   - **Fixed 0–100 scale**, not normalized to the best day in view. 60 % has to
 *     look the same in a good month and a bad one; normalizing would repaint a
 *     month of 60 %s as dark green simply because nothing better happened.
 *   - **One hue, and not the profit/loss pair.** Green-for-good next to the P&L
 *     calendar would read as money, which is the one thing this chart is not
 *     about.
 *
 * A 0 % day is the faintest visible primary rather than muted: a day you blew
 * through every rule must not look like a day off.
 */
export function ComplianceHeatmap({
  series,
  endDay,
  weeks = 26,
}: {
  series: readonly DayCompliance[];
  endDay: string;
  weeks?: number;
}) {
  const { values, byDay } = useMemo(() => {
    const values = new Map<string, number>();
    const byDay = new Map<string, DayCompliance>();
    for (const d of series) {
      byDay.set(d.date, d);
      // Null pct means no rule applied — a weekend, or before any rule existed.
      // Left out of the map so it renders as no data rather than as zero.
      if (d.pct != null) values.set(d.date, d.pct);
    }
    return { values, byDay };
  }, [series]);

  return (
    <HeatmapGrid
      values={values}
      endDay={endDay}
      weeks={weeks}
      color={(v) => {
        if (v == null) return "var(--muted)";
        const intensity = (Math.min(100, Math.max(0, v)) / 100) * 0.85 + 0.15;
        return `color-mix(in oklch, var(--primary) ${intensity * 100}%, transparent)`;
      }}
      title={(c) => {
        const d = byDay.get(c.key);
        if (!d || d.pct == null) return `${c.key}: no rules`;
        return `${c.key}: ${Math.round(d.pct)}% (${d.satisfied}/${d.applicable})`;
      }}
    />
  );
}
