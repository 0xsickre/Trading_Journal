"use client";

import dynamic from "next/dynamic";
import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BIAS_ROOTS } from "@/lib/journal/default-instruments";
import {
  BIAS_MIN_SAMPLE,
  firstEntryResolver,
  rateText,
  splitTradesByBias,
  summarizeBias,
  type BiasTradeGroup,
  type DailyBias,
} from "@/lib/journal/daily-bias";
import { fmtMoney } from "@/lib/journal/format";
import type { DayZone } from "@/lib/journal/time";
import type { TradeRow } from "@/lib/journal/types";

const BiasChart = dynamic(() => import("@/components/journal/reports/bias-chart").then((m) => m.BiasChart), {
  ssr: false,
  loading: () => <div className="h-[220px] w-full animate-pulse rounded-xl bg-muted/40" />,
});

const pts = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.round(Math.abs(n)).toLocaleString("sr-Latn-RS")}`;
const pp = (a: number, b: number, n: number) => {
  if (n === 0) return "—";
  const d = Math.round(((a - b) / n) * 100);
  return `${d > 0 ? "+" : d < 0 ? "−" : ""}${Math.abs(d)} p.p.`;
};

/**
 * Bias dana (faza D): moj bias against always-long, graded on the same days from the exchange's
 * prices — the two winrates, the points each earned per root, and the real money of the trades
 * that went with the day's forecast, against it, on a Neutral day or with none.
 *
 * Over the whole book in scope: a forecast belongs to a day, not to a trade the filters can drop,
 * so the winrates ignore the report's filters; the money uses the trades on screen.
 */
export function BiasPanel({
  biases,
  trades,
  zoneOf,
  currency,
}: {
  biases: DailyBias[];
  trades: TradeRow[];
  zoneOf: (t: TradeRow) => DayZone;
  currency: string;
}) {
  const summary = useMemo(() => summarizeBias(biases, firstEntryResolver(trades, zoneOf)), [biases, trades, zoneOf]);
  const split = useMemo(() => splitTradesByBias(trades, biases, zoneOf), [trades, biases, zoneOf]);
  if (biases.length === 0) return null;

  const roots = BIAS_ROOTS.filter((r) => summary.byRoot[r].n > 0);
  const { total } = summary;
  const group = (label: string, g: BiasTradeGroup) => (
    <tr key={label} className="border-t">
      <td className="py-1 pr-3">{label}</td>
      <td className="py-1 pr-3 text-right tabular-nums">{g.n}</td>
      <td className="py-1 pr-3 text-right tabular-nums">{g.n ? fmtMoney(g.net, currency) : "—"}</td>
      <td className="py-1 text-right tabular-nums">{g.rCount ? `${g.r > 0 ? "+" : ""}${g.r.toFixed(2)}R` : "—"}</td>
    </tr>
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Bias dana: moj bias prema uvek long</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {total.n === 0 ? (
          <p className="text-muted-foreground">
            Još nema ocenjenih dana. Bias se ocenjuje posle 18:00 po Beogradu, kad berza objavi cene.
          </p>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="pb-1 pr-3 text-left font-normal">Koren</th>
                <th className="pb-1 pr-3 text-right font-normal">Moj winrate</th>
                <th className="pb-1 pr-3 text-right font-normal">Uvek long</th>
                <th className="pb-1 pr-3 text-right font-normal">Prednost</th>
                <th className="pb-1 text-right font-normal">Poeni moj / uvek long</th>
              </tr>
            </thead>
            <tbody>
              {roots.map((r) => {
                const s = summary.byRoot[r];
                return (
                  <tr key={r} className="border-t">
                    <td className="py-1 pr-3 font-medium">{r}</td>
                    <td className="py-1 pr-3 text-right tabular-nums">{rateText(s.hits, s.n)}</td>
                    <td className="py-1 pr-3 text-right tabular-nums">{rateText(s.longHits, s.n)}</td>
                    <td className="py-1 pr-3 text-right tabular-nums">{pp(s.hits, s.longHits, s.n)}</td>
                    <td className="py-1 text-right tabular-nums">
                      {pts(s.points)} / {pts(s.longPoints)}
                    </td>
                  </tr>
                );
              })}
              {roots.length > 1 && (
                <tr className="border-t font-medium">
                  <td className="py-1 pr-3">Ukupno</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{rateText(total.hits, total.n)}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{rateText(total.longHits, total.n)}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{pp(total.hits, total.longHits, total.n)}</td>
                  <td className="py-1 text-right text-muted-foreground">poeni se ne sabiraju</td>
                </tr>
              )}
            </tbody>
          </table>
        )}

        {total.n > 0 && total.n < BIAS_MIN_SAMPLE && (
          <p className="text-xs text-muted-foreground">
            Mali uzorak: {total.n} od {BIAS_MIN_SAMPLE} ocenjenih dana. Razlika od uvek long još ništa ne dokazuje.
          </p>
        )}
        {(summary.late > 0 || summary.ungraded > 0) && (
          <p className="text-xs text-muted-foreground">
            {summary.late > 0 && `${summary.late} upisan posle prvog ulaza (ne broji se). `}
            {summary.ungraded > 0 && `${summary.ungraded} bez ocene (čeka cene ili nema cena/istorije).`}
          </p>
        )}

        {roots.map((r) =>
          summary.byRoot[r].curve.length > 1 ? (
            <div key={r} className="space-y-1">
              <p className="text-xs text-muted-foreground">{r} — poeni kroz vreme</p>
              <BiasChart data={summary.byRoot[r].curve} />
            </div>
          ) : null,
        )}

        <div className="space-y-1">
          <p className="text-xs font-medium">Pravi novac po biasu (zatvoreni trejdovi na ekranu)</p>
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="pb-1 pr-3 text-left font-normal">Trejd</th>
                <th className="pb-1 pr-3 text-right font-normal">Broj</th>
                <th className="pb-1 pr-3 text-right font-normal">Net</th>
                <th className="pb-1 text-right font-normal">R</th>
              </tr>
            </thead>
            <tbody>
              {group("U smeru biasa", split.with)}
              {group("Protiv biasa", split.against)}
              {group("Dan sa Neutral", split.neutral)}
              {group("Bez biasa pre ulaza", split.none)}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
