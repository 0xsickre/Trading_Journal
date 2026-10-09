"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtMoney, fmtNum, fmtPct, fmtR, pnlClass } from "@/lib/journal/format";
import { formatDuration } from "@/lib/journal/units";
import type { HoldTimeStats } from "@/lib/journal/hold-time";
import type { TimeStopStats } from "@/lib/journal/time-stop";
import type { CostStats } from "@/lib/journal/costs";
import type { PeriodSummary } from "@/lib/journal/period-stats";
import type { PlannedRStats } from "@/lib/journal/risk-metrics";
import type { ExcursionStats } from "@/lib/journal/excursion";
import type { DirectionSplit } from "@/lib/journal/activity";

function sideWinPct(side: { wins: number; losses: number; winRate: number }): string {
  return side.wins + side.losses === 0 ? "—" : fmtPct(side.winRate, 0);
}

function Row({
  label,
  value,
  cls,
  hint,
}: {
  label: string;
  value: string;
  cls?: string;
  hint?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-sm text-muted-foreground" title={hint}>
        {label}
      </span>
      <span className={`text-sm font-medium tabular-nums ${cls ?? ""}`}>
        {value}
      </span>
    </div>
  );
}

export function HoldTimeCard({ stats }: { stats: HoldTimeStats }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Hold time</CardTitle>
        <p className="text-xs text-muted-foreground">
          {stats.count} trades with a known duration
        </p>
      </CardHeader>
      <CardContent>
        <Row label="Average — all" value={formatDuration(stats.avgSeconds)} />
        <Row
          label="Average — winners"
          value={formatDuration(stats.avgWinnerSeconds)}
        />
        <Row
          label="Average — losers"
          value={formatDuration(stats.avgLoserSeconds)}
        />
        <Row
          label="Average — breakeven"
          value={formatDuration(stats.avgBreakevenSeconds)}
          hint="Empty until you set a breakeven range per account in Settings."
        />
        <Row label="Longest" value={formatDuration(stats.longestSeconds)} />
        <Row
          label="Average in minutes"
          value={stats.avgMinutes != null ? `${fmtNum(stats.avgMinutes, 1)} min` : "—"}
        />
      </CardContent>
    </Card>
  );
}

export function TimeStopCard({ stats }: { stats: TimeStopStats }) {
  const pctOrDash = (v: number | null) => (v != null ? fmtPct(v, 0) : "—");
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Time stop</CardTitle>
        <p className="text-xs text-muted-foreground">
          {stats.winners} winners and {stats.losers} losers measured from the exchange candles
        </p>
      </CardHeader>
      <CardContent>
        <Row
          label="Winners — median time to green"
          value={formatDuration(stats.medianToGreenSeconds)}
          hint="From the first entry until the trade went into profit and never came back below the entry."
        />
        <Row label="Winners — 75 % green by" value={formatDuration(stats.p75ToGreenSeconds)} />
        <Row label="Winners — 90 % green by" value={formatDuration(stats.p90ToGreenSeconds)} />
        <Row
          label="Winners never in the red"
          value={stats.winners > 0 ? `${stats.winnersNeverRed} of ${stats.winners}` : "—"}
        />
        <Row
          label="Losers — average time in the red"
          value={formatDuration(stats.avgLoserRedSeconds)}
          hint="Share of the trade spent below zero × its length, before it was closed."
        />
        <Row
          label="Losers — median time in the red"
          value={formatDuration(stats.medianLoserRedSeconds)}
        />
        <Row label="Losers — average length" value={formatDuration(stats.avgLoserSeconds)} />
        <table className="mt-3 w-full text-sm tabular-nums">
          <thead>
            <tr className="text-xs text-muted-foreground">
              <th className="py-1 text-left font-normal">Cut at</th>
              <th
                className="py-1 text-right font-normal"
                title="Winners already green for good at that minute. The rest a cut there would have killed."
              >
                Winners green
              </th>
              <th
                className="py-1 text-right font-normal"
                title="Losers still open at that minute — the most a cut there could have closed before the stop. Whether each was in the red at that minute is not measured."
              >
                Losers still open
              </th>
            </tr>
          </thead>
          <tbody>
            {stats.ladder.map((r) => (
              <tr key={r.minutes}>
                <td className="py-0.5">{r.minutes} min</td>
                <td className="py-0.5 text-right">{pctOrDash(r.winnersGreenPct)}</td>
                <td className="py-0.5 text-right">{pctOrDash(r.losersOpenPct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

export function CostReportCard({
  costs,
  currency,
}: {
  costs: CostStats;
  currency: string;
}) {
  const noData = costs.count > 0 && costs.withCostData === 0;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Costs</CardTitle>
        <p className="text-xs text-muted-foreground">
          {noData
            ? `None of the ${costs.count} trades carries a cost — this zero means "no data", not "free".`
            : `${costs.withCostData} of ${costs.count} trades carry a cost`}
        </p>
      </CardHeader>
      <CardContent>
        <Row
          label="Commissions and fees"
          value={fmtMoney(costs.totalFees, currency)}
          cls={costs.totalFees !== 0 ? "text-[var(--loss)]" : undefined}
        />
        <Row
          label="Total cost"
          value={fmtMoney(costs.totalCosts, currency)}
          cls={costs.totalCosts !== 0 ? "text-[var(--loss)]" : undefined}
        />
        <Row
          label="Cost as % of gross profit"
          value={costs.costPctOfGross != null ? fmtPct(costs.costPctOfGross) : "—"}
          hint="The denominator is the winners' gross profit — cost measured against what the edge actually produced."
        />
      </CardContent>
    </Card>
  );
}

export function PlanVsRealityCard({
  plannedR,
  excursion,
  direction,
}: {
  plannedR: PlannedRStats;
  excursion: ExcursionStats;
  direction: DirectionSplit;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Plan vs reality</CardTitle>
        <p className="text-xs text-muted-foreground">
          {plannedR.count} trades with both planned and realized R
        </p>
      </CardHeader>
      <CardContent>
        <Row label="Avg planned R" value={fmtR(plannedR.avgPlannedR)} />
        <Row label="Avg realized R" value={fmtR(plannedR.avgRealizedR)} />
        <Row
          label="Difference"
          value={fmtR(plannedR.deltaR)}
          cls={pnlClass(plannedR.deltaR)}
          hint="How much of the planned reward you actually take. Negative is normal; the trend is what to watch."
        />
        <Row
          label="Avg MAE in R"
          value={
            excursion.avgMaeR != null ? `−${fmtNum(excursion.avgMaeR, 2)}R` : "—"
          }
          hint={`How deep trades went against you before the outcome. Sample: ${excursion.maeCount}.`}
        />
        <Row
          label="No drawdown"
          value={
            excursion.maeCount > 0
              ? `${excursion.noDrawdownCount} / ${excursion.maeCount}`
              : "—"
          }
          hint="Trades that were never underwater."
        />
        <Row
          label="Long / Short"
          value={`${direction.longs.count} / ${direction.shorts.count}`}
        />
        <Row
          label="Win % long / short"
          // "—" for a side with nothing decided. `winRate` answers 0 there, and
          // "0%" beside a book with no shorts read as every short lost.
          value={`${sideWinPct(direction.longs)} / ${sideWinPct(direction.shorts)}`}
        />
      </CardContent>
    </Card>
  );
}

export function PeriodPerformanceCard({
  summary,
  label,
  currency,
}: {
  summary: PeriodSummary;
  label: string;
  currency: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{label}</CardTitle>
        <p className="text-xs text-muted-foreground">
          {summary.periods} {summary.periods === 1 ? "period" : "periods"}
        </p>
      </CardHeader>
      <CardContent>
        <Row
          label="Win %"
          // `summary.winPct` is 0, not null, when nothing was decided (all
          // periods flat) — same contract as trade win rate, same guard as
          // `day-stats-card.tsx` and the Dashboard KPI tile (`W1`). This card
          // shared the underlying `summary` with that tile but read the
          // number directly, so it kept showing "0.0%" here after `W1` fixed
          // the tile.
          value={
            summary.winning + summary.losing === 0 ? "—" : fmtPct(summary.winPct)
          }
          cls={summary.winPct >= 50 ? "text-[var(--profit)]" : undefined}
          hint="Share of periods with a positive total P&L. Flat periods stay out of the denominator."
        />
        <Row
          label="Winning / losing"
          value={`${summary.winning} / ${summary.losing}`}
        />
        <Row label="Average" value={fmtMoney(summary.avgPnl, currency)} cls={pnlClass(summary.avgPnl)} />
        <Row
          label="Best"
          value={
            summary.largest
              ? `${summary.largest.key} · ${fmtMoney(summary.largestPnl, currency)}`
              : "—"
          }
          // By sign, not by position: in a losing stretch the BEST week can
          // still be red, and painting it green said otherwise.
          cls={pnlClass(summary.largestPnl)}
        />
        <Row
          label="Worst"
          value={
            summary.smallest
              ? `${summary.smallest.key} · ${fmtMoney(summary.smallestPnl, currency)}`
              : "—"
          }
          cls={pnlClass(summary.smallestPnl)}
        />
        <Row
          label="Max streak W / L"
          value={`${summary.maxConsecutiveWinning} / ${summary.maxConsecutiveLosing}`}
        />
      </CardContent>
    </Card>
  );
}
