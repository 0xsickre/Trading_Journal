"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Flame } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ComplianceHeatmap } from "@/components/journal/compliance-heatmap";
import {
  computeStreak,
  meanCompliance,
  type DayCompliance,
} from "@/lib/journal/tracker/compliance";

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/**
 * Consistency streak and compliance calendar.
 *
 * The streak steps over days no rule applied to — a weekend you deliberately
 * excluded neither breaks it nor extends it. Breaking would cap every
 * weekday-only trader at 5; extending would let the streak be inflated by
 * narrowing a rule down to Mondays.
 */
export function TrackerStreakCard({
  series,
  endDay,
  hasRules,
}: {
  series: readonly DayCompliance[];
  endDay: string;
  /** False when the tracker has never been set up, which reads differently from zero. */
  hasRules: boolean;
}) {
  const streak = useMemo(() => computeStreak(series), [series]);
  const mean = useMemo(() => meanCompliance(series), [series]);
  const scored = useMemo(() => series.filter((d) => d.pct != null).length, [series]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Flame className="size-4" />
          Doslednost procesa
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!hasRules ? (
          <p className="text-sm text-muted-foreground">
            Nema pravila. Postavi ih u{" "}
            <Link href="/settings" className="underline underline-offset-2">
              Settings › Tracker
            </Link>
            , pa ih čekiraj u dnevnom izveštaju.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat
                label="Trenutni niz"
                value={`${streak.current}`}
                hint={streak.current === 1 ? "dan" : "dana"}
              />
              <Stat
                label="Najduži niz"
                value={`${streak.longest}`}
                hint={streak.longest === 1 ? "dan" : "dana"}
              />
              <Stat
                label="Prosečna doslednost"
                value={mean == null ? "—" : `${Math.round(mean)}%`}
                // Mean of DAYS, not of pooled rule counts: a Monday with 12
                // rules must not outweigh a Wednesday with 3, because the unit
                // of process is the day.
                hint={`${scored} ocenjenih dana`}
              />
              <Stat
                label="Poslednji prekid"
                value={streak.lastBrokenOn ?? "—"}
              />
            </div>

            <ComplianceHeatmap series={series} endDay={endDay} />
            <p className="text-xs text-muted-foreground">
              Poslednjih 26 nedelja — jača boja je veća doslednost. Dan bez
              ijednog pravila (vikend, ili pre nego što je pravilo postojalo)
              stoji prazan i ne prekida niz.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
