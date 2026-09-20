"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MIN_SHARED_DAYS, type InstrumentPair } from "@/lib/journal/co-exposure";

/**
 * Which instruments were held at the same time, and whether they moved
 * together.
 *
 * Two answers on purpose, because the familiar one is the weaker one here. The
 * OVERLAP is a fact about exposure: these two were open on the same days, so a
 * bad session hit both. The CORRELATION compares days on which both closed
 * something, which on a swing book is a much smaller set — two positions that
 * ran side by side for three weeks and closed on different days correlate at
 * nothing while having been one bet.
 *
 * So the coefficient is withheld below five shared days rather than printed
 * with a caveat, and shown with its interval above them.
 */
export function CoExposurePanel({ pairs }: { pairs: InstrumentPair[] }) {
  if (pairs.length === 0) return null;
  const shown = pairs.slice(0, 10);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Held at the same time</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-muted-foreground">
              <tr className="border-b text-left text-xs">
                <th className="py-2 pr-3 font-medium">Pair</th>
                <th className="py-2 pr-3 text-right font-medium">Days together</th>
                <th className="py-2 pr-3 text-right font-medium">Of each</th>
                <th className="py-2 text-right font-medium">Correlation</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => (
                <tr key={`${p.a}|${p.b}`} className="border-b last:border-0">
                  <td className="py-2 pr-3">
                    {p.a} · {p.b}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{p.overlapDays}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                    {p.aDays} / {p.bDays}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {p.correlation == null ? (
                      <span
                        className="text-muted-foreground"
                        title={`Needs ${MIN_SHARED_DAYS} days on which both closed a trade; this pair has ${p.sharedCloseDays}.`}
                      >
                        —
                      </span>
                    ) : (
                      <>
                        {p.correlation.toFixed(2)}
                        <span className="block text-[11px] font-normal text-muted-foreground">
                          {p.correlationLo!.toFixed(2)} – {p.correlationHi!.toFixed(2)}
                        </span>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Days together counts exposure — both positions open on the same day. The coefficient only
          compares days on which both closed a trade, so it answers a narrower question and is left
          blank under {MIN_SHARED_DAYS} of them.
        </p>
      </CardContent>
    </Card>
  );
}
