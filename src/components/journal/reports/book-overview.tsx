"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMetric, metric, type ViewMode } from "@/lib/journal/units";
import {
  getMetric,
  type MetricContext,
  type ReportMetric,
} from "@/lib/journal/reports/metrics";
import type { EnrichedTrade } from "@/lib/journal/enriched-trade";

/**
 * The whole book, undivided — the one thing this screen never said.
 *
 * Every other panel on `/reports` answers "which bucket wins": best setup,
 * worst session, most active instrument. Useful, and a different question from
 * "how is the account doing", which had no home here at all. It had one on the
 * dashboard, as eleven small tiles, and that was the wrong home for most of
 * them:
 *
 *   - Six were DUPLICATES of a card on the same page. `Avg hold` restated
 *     `HoldTimeCard`, `Total swap` restated `CostReportCard`, and the four
 *     execution tiles restated the two weekly charts directly below them.
 *     Moving those is deduplication, not relocation.
 *   - Five were annualized or long-horizon figures — Sharpe needs five trading
 *     days before it says anything at all, Calmar is scaled to a year — sitting
 *     on a screen whose default window is ninety days. A number that cannot
 *     move within the period it is displayed in is a number being read too
 *     often.
 *
 * They are grouped rather than listed because the two groups fail differently:
 * the risk ratios go quiet without enough days, the execution figures go quiet
 * without a plan recorded on the trade. A reader seeing five dashes wants to
 * know which of those two things happened.
 */

const RISK_KEYS = [
  "sharpe",
  "sortino",
  "calmar",
  "recovery_factor",
  "consistency",
] as const;

const EXECUTION_KEYS = [
  "avg_entry_slip",
  "total_slip_r",
  "target_attainment",
  "winner_target_attainment",
  "avg_hold",
  "total_swap",
] as const;

export function BookOverviewPanel({
  trades,
  metricContext,
  viewMode,
  currency,
  equityBase,
}: {
  /** Filter-scoped and undivided — the same set the report buckets, unbucketed. */
  trades: EnrichedTrade[];
  metricContext: MetricContext;
  viewMode: ViewMode;
  currency: string;
  equityBase: number | null;
}) {
  const cell = (key: string) => {
    const m: ReportMetric | undefined = getMetric(key);
    if (!m) return null;
    const raw = m.compute(trades, metricContext);
    return {
      key,
      label: m.label,
      hint: m.hint,
      // Through `formatMetric` like every value on this screen. Privacy mode
      // exists to blank the numbers, and this panel is new enough to be the
      // obvious place to forget that — `performance-summary.tsx` already
      // carries a fixed bug where a raw `.toFixed(1)` leaked the win rate.
      value: formatMetric(
        metric(raw, m.unit, { currency, equityBase }),
        viewMode,
      ),
    };
  };

  const risk = RISK_KEYS.map(cell).filter((c) => c != null);
  const execution = EXECUTION_KEYS.map(cell).filter((c) => c != null);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">This book, whole</CardTitle>
        <p className="text-xs text-muted-foreground">
          {trades.length} closed {trades.length === 1 ? "trade" : "trades"} in
          scope, not split by any dimension — the panels below answer which
          bucket wins, this one answers how the account is doing.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <Row title="Risk-adjusted" cells={risk} />
        <Row title="Execution" cells={execution} />
      </CardContent>
    </Card>
  );
}

function Row({
  title,
  cells,
}: {
  title: string;
  cells: { key: string; label: string; hint?: string; value: string }[];
}) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-medium text-muted-foreground">{title}</h3>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {cells.map((c) => (
          <div key={c.key} title={c.hint}>
            <div className="text-xs text-muted-foreground">{c.label}</div>
            <div className="mt-0.5 text-base font-semibold tabular-nums">
              {c.value}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
