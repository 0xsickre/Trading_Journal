"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";
import { ChartShell } from "@/components/journal/chart-shell";
import { runReport } from "@/lib/journal/reports/engine";
import { playbookDimension, type PlaybookLookup } from "@/lib/journal/reports/playbook-dimensions";
import type { MetricContext } from "@/lib/journal/reports/metrics";
import { getMetric } from "@/lib/journal/reports/metrics";
import { HEADER_METRICS } from "@/lib/journal/playbook-types";
import { buildEquity } from "@/lib/journal/analytics";
import { formatMetric, metric as mkMetric } from "@/lib/journal/units";
import type { EnrichedTrade } from "@/lib/journal/enriched-trade";

const chartLoading = () => (
  <div className="h-full w-full animate-pulse rounded-md bg-muted/40" />
);

const EquityChart = dynamic(
  () => import("@/components/journal/dashboard-charts").then((m) => m.EquityChart),
  { ssr: false, loading: chartLoading },
);

/**
 * The Stats tab of a playbook's detail page: the same header metrics the old
 * card showed (trade count, win rate, expectancy, profit factor, avg R, follow
 * rate), plus Missed, plus a cumulative P&L chart for just this playbook's
 * trades.
 */
export function PlaybookStatsTab({
  trades,
  lookup,
  computeCtx,
  currency,
  missedCount,
}: {
  /** Already filtered to this one playbook. */
  trades: EnrichedTrade[];
  lookup: PlaybookLookup;
  computeCtx: MetricContext;
  currency: string;
  missedCount: number;
}) {
  const row = useMemo(() => {
    const result = runReport({
      trades,
      dimension: playbookDimension(lookup.names),
      dimensionContext: { reportByDate: new Map() },
      metricContext: computeCtx,
      metricKeys: HEADER_METRICS,
    });
    return result?.rows[0];
  }, [trades, lookup, computeCtx]);

  const n = row?.n ?? 0;

  const equity = useMemo(
    () => buildEquity(trades.map((t) => t.trade), "net", "money", 0),
    [trades],
  );

  return (
    <div className="space-y-4">
      {n === 0 ? (
        <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          No trade has used this playbook yet. Numbers appear once it does —
          and stay counts, not verdicts, until real observations pile up.
        </p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-7">
            {HEADER_METRICS.map((key) => {
              const m = getMetric(key);
              if (!m) return null;
              return (
                <div key={key}>
                  <dt className="text-xs text-muted-foreground">{m.label}</dt>
                  <dd className="text-lg font-semibold tabular-nums">
                    {formatMetric(
                      mkMetric(row?.values[key] ?? null, m.unit, { currency }),
                    )}
                  </dd>
                </div>
              );
            })}
            <div>
              <dt className="text-xs text-muted-foreground">Missed</dt>
              <dd className="text-lg font-semibold tabular-nums">
                {formatMetric(mkMetric(missedCount > 0 ? missedCount : null, "count"))}
              </dd>
            </div>
          </dl>

          <ChartShell title="Cumulative P&L" subtitle={`${n} trade${n === 1 ? "" : "s"}`}>
            <EquityChart data={equity} metric="money" currency={currency} />
          </ChartShell>
        </>
      )}
    </div>
  );
}
