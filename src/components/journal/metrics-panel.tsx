"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtMoney, fmtNum, fmtPct, fmtR, pnlClass } from "@/lib/journal/format";
import { formatDuration } from "@/lib/journal/units";
import type { HoldTimeStats } from "@/lib/journal/hold-time";
import type { CostStats } from "@/lib/journal/costs";
import type { PeriodSummary } from "@/lib/journal/period-stats";
import type { PlannedRStats } from "@/lib/journal/risk-metrics";
import type { ExcursionStats } from "@/lib/journal/excursion";
import type { DirectionSplit } from "@/lib/journal/activity";

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
        <CardTitle className="text-base">Vreme držanja</CardTitle>
        <p className="text-xs text-muted-foreground">
          {stats.count} trejdova sa poznatim trajanjem
        </p>
      </CardHeader>
      <CardContent>
        <Row label="Prosek — svi" value={formatDuration(stats.avgSeconds)} />
        <Row
          label="Prosek — dobitnici"
          value={formatDuration(stats.avgWinnerSeconds)}
        />
        <Row
          label="Prosek — gubitnici"
          value={formatDuration(stats.avgLoserSeconds)}
        />
        <Row
          label="Prosek — breakeven"
          value={formatDuration(stats.avgBreakevenSeconds)}
          hint="TradeZella ovo zove 'scratch'. Prazno je dok ne podesiš breakeven opseg po nalogu."
        />
        <Row label="Najduži" value={formatDuration(stats.longestSeconds)} />
        <Row
          label="Prosek u danima"
          value={stats.avgDays != null ? `${fmtNum(stats.avgDays, 1)} d` : "—"}
        />
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
        <CardTitle className="text-base">Troškovi</CardTitle>
        <p className="text-xs text-muted-foreground">
          {noData
            ? `Nijedan od ${costs.count} trejdova nema unet trošak — nula ovde znači "nema podatka", ne "besplatno".`
            : `${costs.withCostData} od ${costs.count} trejdova nosi trošak`}
        </p>
      </CardHeader>
      <CardContent>
        <Row
          label="Komisije i takse"
          value={fmtMoney(costs.totalFees, currency)}
          cls={costs.totalFees !== 0 ? "text-[var(--loss)]" : undefined}
        />
        <Row
          label="Swap"
          value={fmtMoney(costs.totalSwap, currency)}
          cls={costs.totalSwap !== 0 ? "text-[var(--loss)]" : undefined}
        />
        <Row
          label="Ukupan trošak"
          value={fmtMoney(costs.totalCosts, currency)}
          cls={costs.totalCosts !== 0 ? "text-[var(--loss)]" : undefined}
        />
        <Row
          label="Trošak kao % bruto profita"
          value={costs.costPctOfGross != null ? fmtPct(costs.costPctOfGross) : "—"}
          hint="Imenilac je bruto profit dobitnika — trošak se meri prema onome što je edge stvarno proizveo."
        />
        <Row
          label="Swap po danu držanja"
          value={
            costs.avgSwapPerHoldingDay != null
              ? fmtMoney(costs.avgSwapPerHoldingDay, currency)
              : "—"
          }
          hint={`Ukupan swap raspoređen na ${fmtNum(costs.holdingDays, 1)} dana izloženosti.`}
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
        <CardTitle className="text-base">Plan vs stvarnost</CardTitle>
        <p className="text-xs text-muted-foreground">
          {plannedR.count} trejdova sa planiranim i ostvarenim R
        </p>
      </CardHeader>
      <CardContent>
        <Row label="Avg planned R" value={fmtR(plannedR.avgPlannedR)} />
        <Row label="Avg realized R" value={fmtR(plannedR.avgRealizedR)} />
        <Row
          label="Razlika"
          value={fmtR(plannedR.deltaR)}
          cls={pnlClass(plannedR.deltaR)}
          hint="Koliko planiranog reward-a stvarno uzimaš. Negativno je normalno; trend je ono što se prati."
        />
        <Row
          label="Avg MAE u R"
          value={
            excursion.avgMaeR != null ? `−${fmtNum(excursion.avgMaeR, 2)}R` : "—"
          }
          hint={`Koliko duboko su trejdovi išli protiv tebe pre ishoda. Uzorak: ${excursion.maeCount}.`}
        />
        <Row
          label="Bez drawdown-a"
          value={
            excursion.maeCount > 0
              ? `${excursion.noDrawdownCount} / ${excursion.maeCount}`
              : "—"
          }
          hint="Trejdovi koji nikad nisu bili u minusu."
        />
        <Row
          label="Long / Short"
          value={`${direction.longs.count} / ${direction.shorts.count}`}
        />
        <Row
          label="Win % long / short"
          value={`${fmtPct(direction.longs.winRate, 0)} / ${fmtPct(
            direction.shorts.winRate,
            0,
          )}`}
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
          {summary.periods} perioda · swing zamena za Day Win %
        </p>
      </CardHeader>
      <CardContent>
        <Row
          label="Win %"
          value={fmtPct(summary.winPct)}
          cls={summary.winPct >= 50 ? "text-[var(--profit)]" : undefined}
          hint="Udeo perioda sa pozitivnim ukupnim P&L-om. Ravni periodi su van imenioca."
        />
        <Row
          label="Dobitni / gubitni"
          value={`${summary.winning} / ${summary.losing}`}
        />
        <Row label="Prosek" value={fmtMoney(summary.avgPnl, currency)} cls={pnlClass(summary.avgPnl)} />
        <Row
          label="Najbolji"
          value={
            summary.largest
              ? `${summary.largest.key} · ${fmtMoney(summary.largest.net, currency)}`
              : "—"
          }
          cls="text-[var(--profit)]"
        />
        <Row
          label="Najgori"
          value={
            summary.smallest
              ? `${summary.smallest.key} · ${fmtMoney(summary.smallest.net, currency)}`
              : "—"
          }
          cls="text-[var(--loss)]"
        />
        <Row
          label="Max niz W / L"
          value={`${summary.maxConsecutiveWinning} / ${summary.maxConsecutiveLosing}`}
        />
      </CardContent>
    </Card>
  );
}
