"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { fmtPct } from "@/lib/journal/format";
import { MIN_SAMPLE_DAYS, type SurvivalResult } from "@/lib/journal/survival";

/**
 * What the same behaviour is likely to do next.
 *
 * Every other figure on this page is historical. This one replays the book's
 * own daily results a few thousand times and counts how often it ends badly —
 * so it is the only card whose assumptions have to be on screen beside the
 * number. A probability with a hidden assumption reads as a measurement.
 */
export function SurvivalCard({
  result,
  horizonDays,
  blockDays,
  limitLabel,
  onBlockChange,
}: {
  result: SurvivalResult | null;
  horizonDays: number;
  blockDays: number;
  /** Where the floor came from: the challenge's rules, or the trader's own. */
  limitLabel: string;
  onBlockChange?: (next: number) => void;
}) {
  if (!result) {
    return (
      <Card className="h-full">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Survival</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="py-2 text-sm text-muted-foreground">
            Needs at least {MIN_SAMPLE_DAYS} days of trading before a simulation says anything.
            Fewer than that is noise about noise.
          </p>
        </CardContent>
      </Card>
    );
  }

  const p = result.percentiles;
  const risky = (result.pMaxLoss ?? 0) >= 10;

  return (
    <Card className="h-full">
      <CardHeader className="flex-row items-baseline justify-between space-y-0 pb-2">
        <CardTitle className="text-base">
          Survival
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            next {horizonDays} trading days
          </span>
        </CardTitle>
        {onBlockChange && (
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={() => onBlockChange(blockDays === 1 ? 5 : 1)}
            title="Draw single days, or whole weeks — a run of losses is what ends an account"
          >
            {blockDays === 1 ? "Single days" : "Weekly blocks"}
          </button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          {result.pMaxLoss != null && (
            <Figure
              label={`Hits ${limitLabel}`}
              value={fmtPct(result.pMaxLoss)}
              tone={risky ? "bad" : undefined}
            />
          )}
          {result.pDailyLoss != null && (
            <Figure label="Breaks a daily limit" value={fmtPct(result.pDailyLoss)} />
          )}
          {result.pTarget != null && (
            <Figure label="Reaches the target" value={fmtPct(result.pTarget)} tone="good" />
          )}
          <Figure label="Ends below today" value={fmtPct(result.pNegative)} />
        </div>

        <div>
          <p className="text-xs text-muted-foreground">Where equity lands</p>
          <div className="mt-1 flex items-baseline justify-between text-sm tabular-nums">
            <span className="text-[var(--loss)]">{signed(p.p5)}</span>
            <span className="text-muted-foreground">{signed(p.p25)}</span>
            <span className="font-medium">{signed(p.p50)}</span>
            <span className="text-muted-foreground">{signed(p.p75)}</span>
            <span className="text-[var(--profit)]">{signed(p.p95)}</span>
          </div>
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>5th</span>
            <span>25th</span>
            <span>median</span>
            <span>75th</span>
            <span>95th</span>
          </div>
        </div>

        {/* The assumptions, stated. The reader is entitled to know that this is
            their own book replayed and not a forecast of the market. */}
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {result.iters.toLocaleString()} runs drawn from your own {result.sampleDays} trading days,
          in {blockDays === 1 ? "single days" : "blocks of five days"}. A typical bad patch in these
          runs is {fmtPct(result.medianWorstDrawdownPct)}. This replays the book you have traded; it
          does not predict a market that has not happened.
        </p>
      </CardContent>
    </Card>
  );
}

const signed = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;

function Figure({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "good" | "bad";
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          "text-lg font-semibold tabular-nums",
          tone === "bad" && "text-[var(--loss)]",
          tone === "good" && "text-[var(--profit)]",
        )}
      >
        {value}
      </p>
    </div>
  );
}
