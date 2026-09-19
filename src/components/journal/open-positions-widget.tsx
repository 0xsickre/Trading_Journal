"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fmtNum, fmtPrice } from "@/lib/journal/format";
import { numberFieldValue } from "@/lib/journal/field-values";
import { formatDuration } from "@/lib/journal/units";
import { DAY_TIME, fmtInTz, toEpoch } from "@/lib/journal/time";
import type { TradeRow } from "@/lib/journal/types";

/** How many rows fit before the card says "and N more". */
const MAX_ROWS = 6;

/**
 * Positions still on, in the dashboard's account scope.
 *
 * The page's figures are all REALIZED, so a trader holding three swings saw
 * nothing of them here. This is not money — an open position has no final P&L
 * and there is no live price to mark it against — it is exposure: what is on,
 * since when, how much is left, and where the stop sits.
 */
export function OpenPositionsWidget({
  rows,
  tzOf,
  now: nowProp,
}: {
  rows: TradeRow[];
  tzOf: (t: TradeRow) => string;
  /** Injected for tests; the mount time otherwise. */
  now?: number;
}) {
  // Read once per mount: "held for" is a glance, not a ticking clock.
  const [now] = useState(() => nowProp ?? Date.now());
  const open = rows
    .filter((t) => t.status === "open" || t.status === "partial")
    .sort(
      (a, b) =>
        toEpoch(b.stats?.opened_at ?? b.created_at) - toEpoch(a.stats?.opened_at ?? a.created_at),
    );

  return (
    <Card className="h-full">
      <CardHeader className="flex-row items-baseline justify-between space-y-0 pb-2">
        <CardTitle className="text-base">
          Open positions
          {open.length > 0 && (
            <span className="ml-2 text-sm font-normal text-muted-foreground">{open.length}</span>
          )}
        </CardTitle>
        <Link href="/journal" className="text-xs text-muted-foreground hover:text-foreground">
          All trades →
        </Link>
      </CardHeader>
      <CardContent>
        {open.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">No open positions.</p>
        ) : (
          <ul className="divide-y">
            {open.slice(0, MAX_ROWS).map((t) => {
              const openedAt = t.stats?.opened_at ?? null;
              const left =
                t.stats != null ? (t.stats.entry_qty ?? 0) - (t.stats.exit_qty ?? 0) : null;
              const tick = numberFieldValue(t, "tick_size_at_trade");
              const stop = numberFieldValue(t, "stop_price");
              const dir = (t.direction as string | null) ?? "";
              const short = dir.toLowerCase().startsWith("short");
              return (
                <li key={t.id}>
                  <Link
                    href={`/trades/${t.id}/edit`}
                    className="flex items-center gap-2 py-2 text-sm hover:bg-muted/40"
                  >
                    <span className="font-mono font-medium">{(t.instrument as string) ?? "—"}</span>
                    {dir && (
                      <Badge
                        variant="outline"
                        className={short ? "text-[var(--loss)]" : "text-[var(--profit)]"}
                      >
                        {dir}
                      </Badge>
                    )}
                    {t.status === "partial" && (
                      <Badge variant="secondary" title="Partly closed">
                        Partial
                      </Badge>
                    )}
                    <span className="ml-auto flex items-center gap-3 text-xs text-muted-foreground tabular-nums">
                      <span title="Size still open">{left != null ? fmtNum(left, 2) : "—"}</span>
                      <span title="Stop">SL {fmtPrice(stop, tick)}</span>
                      <span title={openedAt ? fmtInTz(openedAt, tzOf(t), DAY_TIME) : undefined}>
                        {openedAt ? formatDuration((now - toEpoch(openedAt)) / 1000) : "—"}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        {open.length > MAX_ROWS && (
          <p className="pt-2 text-xs text-muted-foreground">and {open.length - MAX_ROWS} more</p>
        )}
      </CardContent>
    </Card>
  );
}
