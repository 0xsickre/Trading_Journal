"use client";

import { Card, CardContent } from "@/components/ui/card";
import { formatMetric, metric, type ViewMode } from "@/lib/journal/units";
import { getMetric, type MetricContext } from "@/lib/journal/reports/metrics";
import type { EnrichedTrade } from "@/lib/journal/enriched-trade";

/**
 * The whole book in scope, before any split.
 *
 * Every other panel answers "which group wins"; this one answers "how is the
 * book doing". Six headline figures, then the risk-adjusted and execution
 * figures in a quieter second row — those go blank for reasons of their own
 * (too few trading days, no plan on the trade), and their hints say which.
 *
 * Every value goes through `formatMetric`, so Privacy hides these too.
 */

const HEADLINE = ["net_pnl", "win_rate", "profit_factor", "expectancy", "max_drawdown"] as const;
const SECONDARY = [
  "sharpe",
  "sortino",
  "calmar",
  "recovery_factor",
  "avg_hold",
  "avg_entry_slip",
  "target_attainment",
] as const;

export function BookOverviewPanel({
  trades,
  metricContext,
  viewMode,
  currency,
  equityBase,
}: {
  /** The book in scope, filtered and undivided. */
  trades: EnrichedTrade[];
  metricContext: MetricContext;
  viewMode: ViewMode;
  currency: string;
  equityBase: number | null;
}) {
  const cell = (key: string) => {
    const m = getMetric(key);
    if (!m) return null;
    const raw = m.compute(trades, metricContext);
    return {
      key,
      label: m.label,
      hint: m.hint,
      raw,
      unit: m.unit,
      value: formatMetric(metric(raw, m.unit, { currency, equityBase }), viewMode),
    };
  };

  const headline = HEADLINE.map(cell).filter((c) => c != null);
  const secondary = SECONDARY.map(cell).filter((c) => c != null);
  const signed = (c: (typeof headline)[number]) =>
    viewMode !== "privacy" && (c.unit === "money" || c.unit === "r") && c.raw != null && c.raw !== 0
      ? c.raw > 0
        ? "text-[var(--profit)]"
        : "text-[var(--loss)]"
      : "";

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <div>
            <div className="text-xs text-muted-foreground">Trades</div>
            <div className="mt-0.5 text-xl font-semibold tabular-nums">{trades.length}</div>
          </div>
          {headline.map((c) => (
            <div key={c.key} title={c.hint}>
              <div className="text-xs text-muted-foreground">{c.label}</div>
              <div className={`mt-0.5 text-xl font-semibold tabular-nums ${signed(c)}`}>
                {c.value}
              </div>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3 border-t pt-3 sm:grid-cols-4 lg:grid-cols-7">
          {secondary.map((c) => (
            <div key={c.key} title={c.hint}>
              <div className="text-[11px] text-muted-foreground">{c.label}</div>
              <div className="text-sm font-medium tabular-nums">{c.value}</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
