"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fmtMoney, fmtNum, fmtPrice } from "@/lib/journal/format";
import { heatByAccount, heatExceedsPerTradeLimit } from "@/lib/journal/portfolio-heat";
import { cn } from "@/lib/utils";
import { numberFieldValue } from "@/lib/journal/field-values";
import { formatDuration } from "@/lib/journal/units";
import { openQty } from "@/lib/journal/trade-lifecycle";
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
  equityOf,
  currency = "USD",
  perTradeLimitPct = null,
}: {
  rows: TradeRow[];
  tzOf: (t: TradeRow) => string;
  /** Injected for tests; the mount time otherwise. */
  now?: number;
  /** Current equity per account — the denominator of the heat figure. */
  equityOf?: (accountId: string) => number | null;
  currency?: string;
  /** The tracker's own per-trade ceiling, when one is configured. */
  perTradeLimitPct?: number | null;
}) {
  // Read once per mount: "held for" is a glance, not a ticking clock.
  const [now] = useState(() => nowProp ?? Date.now());
  const open = rows
    .filter((t) => t.status === "open" || t.status === "partial")
    .sort(
      (a, b) =>
        toEpoch(b.stats?.opened_at ?? b.created_at) - toEpoch(a.stats?.opened_at ?? a.created_at),
    );

  /**
   * Open risk, per account and never summed across them: 2 % of a 5,000
   * account and 2 % of a 100,000 one are not 4 % of anything that exists.
   */
  const heats = equityOf ? heatByAccount(open, equityOf) : [];

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
        {heats.length > 0 && (
          <div className="mb-2 space-y-0.5 border-b pb-2">
            {heats.map((h) => {
              const over = heatExceedsPerTradeLimit(h, perTradeLimitPct);
              return (
                <p key={h.accountId} className="flex items-baseline justify-between text-xs">
                  <span className="text-muted-foreground">
                    Open risk
                    {heats.length > 1 && ` · ${h.accountId.slice(0, 8)}`}
                  </span>
                  <span
                    className={cn("tabular-nums", over && "font-medium text-amber-600 dark:text-amber-500")}
                  >
                    {h.totalRiskPct != null ? `${h.totalRiskPct.toFixed(2)}%` : "—"}
                    <span className="ml-1 text-muted-foreground">
                      {fmtMoney(h.totalRiskMoney, currency)}
                      {/* Unmeasured is not safe: a position with no stop is
                          counted here rather than added as a zero. */}
                      {h.unpriced > 0 && ` · ${h.priced} of ${h.priced + h.unpriced} measured`}
                    </span>
                  </span>
                </p>
              );
            })}
          </div>
        )}
        {open.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">No open positions.</p>
        ) : (
          <ul className="divide-y">
            {open.slice(0, MAX_ROWS).map((t) => {
              const openedAt = t.stats?.opened_at ?? null;
              // The shared definition, so "size still open" here and the fills
              // editor's "Open" can never drift apart — including the clamp at
              // zero, which this copy did not have.
              const left =
                t.stats != null
                  ? openQty(t.stats.entry_qty ?? 0, t.stats.exit_qty ?? 0)
                  : null;
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
