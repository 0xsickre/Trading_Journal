"use client";

import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Shared recharts chrome.
 *
 * The tooltip style below was copy-pasted verbatim into four charts in
 * `dashboard.tsx` and pointedly missing from a fifth, so tooltips did not all
 * look alike. Phase 3 adds more charts; one definition keeps them consistent.
 */
export const TOOLTIP_STYLE = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  fontSize: 12,
} as const;

/** Axis defaults, so every chart shares one tick size and colour. */
export const AXIS_PROPS = {
  tick: { fontSize: 11 },
  stroke: "var(--muted-foreground)",
} as const;

export const GRID_PROPS = {
  strokeDasharray: "3 3",
  stroke: "var(--border)",
} as const;

/** Ordered palette for multi-series charts. */
export const SERIES_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
] as const;

export function ChartShell({
  title,
  subtitle,
  action,
  children,
  empty,
}: {
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  /** Rendered instead of the chart when there is nothing to plot. */
  empty?: ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0 pb-2">
        <div className="min-w-0">
          <CardTitle className="text-base">{title}</CardTitle>
          {subtitle && (
            <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
          )}
        </div>
        {action}
      </CardHeader>
      <CardContent>{empty ?? children}</CardContent>
    </Card>
  );
}
