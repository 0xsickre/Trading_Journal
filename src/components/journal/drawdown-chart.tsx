"use client";

import { useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtMoney, fmtPct } from "@/lib/journal/format";
import type { DrawdownPoint, DrawdownStats } from "@/lib/journal/balance";

/**
 * Underwater curve.
 *
 * The `$` and `%` toggle is not cosmetic — the two series have different
 * denominators. Money is measured against peak cumulative P&L; percent is
 * measured against peak equity including deposits and withdrawals. A deposit
 * moves one line and not the other, which is the point.
 */
export function DrawdownChart({
  series,
  stats,
  currency,
}: {
  series: DrawdownPoint[];
  stats: DrawdownStats;
  currency: string;
}) {
  const [basis, setBasis] = useState<"money" | "pct">("money");

  const data = series.map((p, i) => ({
    i,
    label: p.at ? p.at.slice(0, 10) : String(i),
    value: basis === "money" ? p.ddMoney : p.ddPct,
  }));

  const fmt = (v: number) =>
    basis === "money" ? fmtMoney(v, currency) : fmtPct(v, 2);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <div>
          <CardTitle className="text-base">Drawdown</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            {basis === "money"
              ? "Pad ispod vrha kumulativnog P&L-a. Uplate i isplate nisu gubitak."
              : "Pad ispod vrha equity-ja, uključujući uplate i isplate."}
          </p>
        </div>
        <div className="flex rounded-md border p-0.5">
          {(["money", "pct"] as const).map((b) => (
            <button
              key={b}
              onClick={() => setBasis(b)}
              className={`rounded px-2 py-0.5 text-xs ${
                basis === b
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground"
              }`}
            >
              {b === "money" ? currency : "%"}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {data.length <= 1 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nema dovoljno zatvorenih trejdova.
          </p>
        ) : (
          <>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data}>
                  <defs>
                    <linearGradient id="ddFill" x1="0" y1="0" x2="0" y2="1">
                      <stop
                        offset="0%"
                        stopColor="var(--loss)"
                        stopOpacity={0.05}
                      />
                      <stop
                        offset="100%"
                        stopColor="var(--loss)"
                        stopOpacity={0.35}
                      />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} minTickGap={40} />
                  <YAxis tick={{ fontSize: 11 }} width={70} tickFormatter={fmt} />
                  <Tooltip
                    formatter={(v) => fmt(Number(v))}
                    labelFormatter={(l) => String(l)}
                  />
                  <Area
                    type="monotone"
                    dataKey="value"
                    stroke="var(--loss)"
                    fill="url(#ddFill)"
                    strokeWidth={1.5}
                    dot={false}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <Figure
                label="Max"
                value={
                  basis === "money"
                    ? fmtMoney(stats.maxMoney, currency)
                    : fmtPct(stats.maxPctOfEquity, 2)
                }
              />
              <Figure
                label="Datum dna"
                value={stats.maxAt ? stats.maxAt.slice(0, 10) : "—"}
              />
              <Figure
                label="Prosečan"
                value={fmtMoney(stats.avgMoney, currency)}
              />
              <Figure
                label="Trenutni"
                value={
                  basis === "money"
                    ? fmtMoney(stats.currentMoney, currency)
                    : fmtPct(-stats.currentPctOfEquity, 2)
                }
              />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-medium tabular-nums">{value}</div>
    </div>
  );
}
