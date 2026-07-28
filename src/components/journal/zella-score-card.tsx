"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtNum } from "@/lib/journal/format";
import type { ZellaScore } from "@/lib/journal/zella-score";

/**
 * Composite score with its components exposed.
 *
 * The breakdown is shown rather than just the headline number: a single 0–100
 * figure invites you to chase the number, while the component list says which
 * input is dragging and is therefore actionable. Components that could not be
 * computed are shown as dropped, not as zero — a book with no drawdown yet
 * should not be scored as if it had a terrible one.
 */
export function ZellaScoreCard({ score }: { score: ZellaScore }) {
  const value = score.score;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Composite score</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-baseline gap-3">
          <span
            className={`text-4xl font-semibold tabular-nums ${scoreClass(value)}`}
          >
            {value == null ? "—" : Math.round(value)}
          </span>
          <span className="text-sm text-muted-foreground">/ 100</span>
          {score.coverage < 100 && score.coverage > 0 && (
            <span className="ml-auto text-xs text-muted-foreground">
              {score.coverage}% pondera pokriveno
            </span>
          )}
        </div>

        <div className="space-y-2">
          {score.components.map((c) => (
            <div key={c.key} className="flex items-center gap-3 text-sm">
              <span className="w-36 shrink-0 text-muted-foreground">
                {c.label}
              </span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                {c.counted && c.score != null && (
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${Math.max(0, Math.min(100, c.score))}%` }}
                  />
                )}
              </div>
              <span className="w-10 shrink-0 text-right tabular-nums">
                {c.counted && c.score != null ? Math.round(c.score) : "—"}
              </span>
              <span className="w-9 shrink-0 text-right text-xs text-muted-foreground">
                {c.weight}%
              </span>
            </div>
          ))}
        </div>

        {score.components.some((c) => !c.counted) && (
          <p className="text-xs text-muted-foreground">
            Komponente bez podataka su izbačene, a preostali ponderi
            renormalizovani — mlad track record se ne kažnjava za račun koji
            nema šta da podeli.
          </p>
        )}

        <p className="text-xs text-muted-foreground">
          Max drawdown komponenta koristi TZ osnovu (pad / vrh kumulativnog
          P&amp;L-a), ne procenat iz equity-ja koji je prikazan gore — inače skor
          ne bi bio uporediv sa TradeZella brojem.
        </p>
      </CardContent>
    </Card>
  );
}

function scoreClass(v: number | null): string {
  if (v == null) return "text-muted-foreground";
  if (v >= 70) return "text-[var(--profit)]";
  if (v >= 40) return "";
  return "text-[var(--loss)]";
}

export function fmtScoreValue(n: number | null): string {
  return n == null ? "—" : fmtNum(n, 2);
}
