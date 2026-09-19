"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fmtR, pnlClass } from "@/lib/journal/format";
import { DAY_TIME, fmtInTz } from "@/lib/journal/time";
import type { PnlMode, RealizedTrade } from "@/lib/journal/analytics";

const MAX_ROWS = 8;

/**
 * The last trades closed in the period, newest first.
 *
 * Every other figure on the page is an aggregate; this is the way from one of
 * them back to the trades that made it — and the quickest route to the trade
 * you closed an hour ago and have not reviewed yet.
 */
export function RecentTradesWidget({
  trades,
  mode,
  tzOf,
  money,
}: {
  /** Realized trades in scope, as the dashboard holds them (oldest first). */
  trades: RealizedTrade[];
  mode: PnlMode;
  tzOf: (t: RealizedTrade) => string;
  /** The page's own money formatter, so privacy and % mode apply here too. */
  money: (v: number) => string;
}) {
  const recent = trades.slice(-MAX_ROWS).reverse();

  return (
    <Card className="h-full">
      <CardHeader className="flex-row items-baseline justify-between space-y-0 pb-2">
        <CardTitle className="text-base">Recent trades</CardTitle>
        <Link href="/journal" className="text-xs text-muted-foreground hover:text-foreground">
          View all →
        </Link>
      </CardHeader>
      <CardContent>
        {recent.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">No closed trades in this period.</p>
        ) : (
          <ul className="divide-y">
            {recent.map((t) => {
              const pnl = mode === "net" ? t.net : t.gross;
              const dir = String(t.row.direction ?? "");
              const short = dir.toLowerCase().startsWith("short");
              return (
                <li key={t.id}>
                  <Link
                    href={`/trades/${t.id}/edit`}
                    className="flex items-center gap-2 py-2 text-sm hover:bg-muted/40"
                  >
                    <span className="w-24 shrink-0 text-xs text-muted-foreground tabular-nums">
                      {t.closedAt ? fmtInTz(t.closedAt, tzOf(t), DAY_TIME) : "—"}
                    </span>
                    <span className="font-mono font-medium">
                      {(t.row.instrument as string) ?? "—"}
                    </span>
                    {dir && (
                      <Badge
                        variant="outline"
                        className={short ? "text-[var(--loss)]" : "text-[var(--profit)]"}
                      >
                        {dir}
                      </Badge>
                    )}
                    <span className={`ml-auto text-xs tabular-nums ${pnlClass(t.r)}`}>
                      {fmtR(t.r)}
                    </span>
                    <span className={`w-24 text-right font-medium tabular-nums ${pnlClass(pnl)}`}>
                      {money(pnl)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
