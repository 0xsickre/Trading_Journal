"use client";

import { fmtMoney } from "@/lib/journal/format";
import { HeatmapGrid } from "@/components/journal/heatmap-grid";

/**
 * Daily P&L calendar.
 *
 * Intensity is relative to the largest absolute move in view, so a quiet period
 * still shows contrast. That is the right call for money — the question is
 * "which days moved the account", not "how big in absolute terms" — and it is
 * exactly the wrong call for compliance, which is why that heatmap does not
 * share this scale.
 */
export function CalendarHeatmap({
  daily,
  endDay,
  weeks = 26,
  currency = "USD",
}: {
  daily: Map<string, number>;
  endDay: string;
  weeks?: number;
  currency?: string;
}) {
  return (
    <HeatmapGrid
      values={daily}
      endDay={endDay}
      weeks={weeks}
      color={(v, max) => {
        // A flat day is not a win and not a loss; muted keeps it out of the
        // green/red reading entirely.
        if (v == null || v === 0) return "var(--muted)";
        const intensity = Math.min(1, Math.abs(v) / max) * 0.75 + 0.25;
        return v > 0
          ? `color-mix(in oklch, var(--profit) ${intensity * 100}%, transparent)`
          : `color-mix(in oklch, var(--loss) ${intensity * 100}%, transparent)`;
      }}
      title={(c) =>
        c.value == null
          ? c.key
          : `${c.key}: ${fmtMoney(c.value, currency, { sign: true })}`
      }
    />
  );
}
