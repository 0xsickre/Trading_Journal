"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { fmtMoney, fmtNum, fmtR, pnlClass } from "@/lib/journal/format";
import type { Stats } from "@/lib/journal/analytics";
import type { CostStats } from "@/lib/journal/costs";

export type DayTradeRow = {
  id: string;
  label: string;
  symbol: string | null;
  net: number;
  r: number | null;
  qty: number;
};

function Figure({
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
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("text-lg font-semibold tabular-nums", cls)}>{value}</p>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/**
 * The day's numbers, above the process journal.
 *
 * Scoped to trades CLOSED on this day, matching the calendar cell and
 * `dailyPnl` — money belongs to the day it was realized. A position opened today
 * and still running is therefore absent, which is the same rule the whole app
 * uses for P&L; the tracker's decision rules are the ones that look at the open
 * day instead.
 */
export function DayStatsCard({
  stats,
  costs,
  volume,
  trades,
  currency,
}: {
  stats: Stats;
  costs: CostStats;
  volume: number;
  trades: DayTradeRow[];
  /** Null when the accounts' currencies differ — money is then not summed. */
  currency: string | null;
}) {
  const [open, setOpen] = useState(false);
  const money = (v: number, sign = true) => (currency ? fmtMoney(v, currency, { sign }) : "—");

  if (stats.count === 0) {
    return (
      <Card>
        <CardContent className="py-4 text-sm text-muted-foreground">
          Nijedan trejd nije zatvoren ovog dana. Dnevnik ispod i dalje vredi
          pisati — disciplina se meri i na dane kada se ne trguje.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
          <span>Dan u brojkama</span>
          <span className={cn("tabular-nums", currency && pnlClass(stats.netSum))}>
            {money(stats.netSum)}
          </span>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-4 sm:grid-cols-5">
          {/* Net sits in the heading above; it used to be repeated here as the
              first figure. The slot shows the day's range of outcomes instead. */}
          <Figure
            label="Najbolji / najgori"
            value={stats.count > 0 ? `${money(stats.best)} / ${money(stats.worst)}` : "—"}
          />
          <Figure
            label="Gross"
            value={money(stats.grossSum)}
            cls={currency ? pnlClass(stats.grossSum) : undefined}
          />
          <Figure label="Trejdovi" value={String(stats.count)} />
          <Figure
            label="Win rate"
            value={
              stats.wins + stats.losses === 0
                ? "—"
                : `${fmtNum(stats.winRate, 0)}%`
            }
            hint={
              stats.breakeven > 0
                ? `${stats.breakeven} breakeven van imenioca`
                : undefined
            }
          />
          <Figure
            label="Profit factor"
            // Infinity is a real, maximal value — winners and no losers — and
            // must not render as a dash next to "no data".
            value={
              stats.profitFactor == null
                ? "—"
                : stats.profitFactor === Infinity
                  ? "∞"
                  : fmtNum(stats.profitFactor, 2)
            }
          />
          <Figure
            label="Dobitni"
            value={String(stats.wins)}
            cls="text-[var(--profit)]"
          />
          <Figure
            label="Gubitni"
            value={String(stats.losses)}
            cls="text-[var(--loss)]"
          />
          <Figure label="Volumen" value={fmtNum(volume, 2)} hint="kontrakata" />
          <Figure
            label="Provizije"
            value={money(costs.totalFees, false)}
            // Without this a day of trades logged with no fee data shows a
            // confident $0 and implies the trading was free.
            hint={
              costs.withCostData === 0
                ? "nijedan trejd ne nosi taj podatak"
                : costs.withCostData < stats.count
                  ? `${costs.withCostData} od ${stats.count} trejdova`
                  : undefined
            }
          />
          <Figure
            label="R"
            value={stats.expectancySample === 0 ? "—" : fmtR(stats.totalR)}
            hint={
              stats.expectancySample < stats.count
                ? `${stats.expectancySample} sa stopom`
                : undefined
            }
          />
        </div>
        {currency == null && (
          <p className="text-xs text-muted-foreground">
            Novac se ne sabira: nalozi su u različitim valutama.
          </p>
        )}

        <div>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            aria-expanded={open}
          >
            {open ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronRight className="size-3.5" />
            )}
            {open ? "Sakrij" : "Prikaži"} trejdove zatvorene ovog dana
          </button>

          {open && (
            <div className="mt-2 space-y-1">
              {trades.map((t) => (
                <Link
                  key={t.id}
                  href={`/trades/${t.id}/edit`}
                  className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm hover:border-primary"
                >
                  <Badge variant="outline" className="shrink-0">
                    {t.label}
                  </Badge>
                  <span className="min-w-0 flex-1 truncate">
                    {t.symbol ?? "—"}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {fmtNum(t.qty, 2)}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {t.r == null ? "—" : fmtR(t.r)}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 tabular-nums",
                      pnlClass(t.net),
                    )}
                  >
                    {money(t.net)}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
