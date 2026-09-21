"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMetric, metric, type ViewMode } from "@/lib/journal/units";
import { bucketLabel } from "@/lib/journal/reports/dimensions";
import {
  isDeltaInconclusive,
  parseSort,
  type CompareResult,
} from "@/lib/journal/reports/engine";
import type { ReportMetric } from "@/lib/journal/reports/metrics";

/**
 * Two books, bucket by bucket, and the gap between them.
 *
 * Three columns per metric — A, B, and B − A — because the gap is the whole
 * question and reading it off two tables by eye is how a fifty-point swing over
 * six trades becomes a decision.
 *
 * THE DELTA IS DIMMED WHENEVER ITS INTERVAL STILL HOLDS ZERO, which on this
 * book is most of the time and is the point: a difference that cannot be told
 * from no difference is not a finding. Neutral for a difference is always zero,
 * never the metric's own neutral — see `isDeltaInconclusive`.
 *
 * A bucket only one set traded shows an em dash on the other side and no delta
 * at all. Subtracting from nothing would invent a decline.
 */
export function CompareTable({
  result,
  viewMode,
  currency,
  equityBase,
  sortBy,
  onSort,
  labels,
}: {
  result: CompareResult;
  viewMode: ViewMode;
  currency: string;
  equityBase: number | null;
  sortBy?: string;
  onSort: (next: string) => void;
  /** What to call the two sets in the header. */
  labels: { a: string; b: string };
}) {
  const sort = parseSort(sortBy);
  const active = sort && result.metrics.some((m) => m.key === sort.key) ? sort : null;
  const fmt = (v: number | null | undefined, unit: ReportMetric["unit"]) =>
    formatMetric(metric(v ?? null, unit, { currency, equityBase }), viewMode);

  /** A delta of a percentage is points, not a percentage of anything. */
  const fmtDelta = (v: number | null, m: ReportMetric) => {
    if (v == null) return "—";
    const body = fmt(Math.abs(v), m.unit);
    return `${v > 0 ? "+" : v < 0 ? "−" : ""}${body}`;
  };

  // Said once, here, because the panels above this table were not doubled:
  // best/worst and the chart answer about set A, and a reader who has just
  // asked a two-sided question will otherwise read them as being about both.
  const notes: string[] = ["The cards and the chart above describe set A"];
  if (result.sharedTrades > 0) {
    notes.push(
      `${result.sharedTrades} ${result.sharedTrades === 1 ? "trade is" : "trades are"} in both sets — the intervals assume two independent samples, so a subset against its own superset is not a comparison`,
    );
  }
  if (result.rows.some((r) => result.metrics.some((m) => isDeltaInconclusive(r, m)))) {
    notes.push("Dimmed differences: the 95 % interval still includes no change");
  }
  if (result.rows.some((r) => r.a == null || r.b == null)) {
    notes.push("An em dash means that set never traded this group");
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          By {result.dimension.label.toLowerCase()} — {labels.a} against {labels.b}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="max-h-[32rem] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-card text-muted-foreground">
              <tr className="border-b">
                <th className="sticky left-0 z-10 bg-card py-2 pr-3 text-left font-medium">
                  {result.dimension.label}
                </th>
                <th className="py-2 pr-3 text-right font-medium">Trades</th>
                {result.metrics.map((m) => {
                  const on = active?.key === m.key;
                  const betterFirst = m.higherIsBetter === false ? "asc" : "desc";
                  const dir = on ? (active.dir ?? betterFirst) : null;
                  const next = `${m.key}:${on ? (dir === "asc" ? "desc" : "asc") : betterFirst}`;
                  return (
                    <th
                      key={m.key}
                      colSpan={3}
                      className="border-l py-2 pl-3 text-right font-medium"
                      aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none"}
                    >
                      <button
                        type="button"
                        onClick={() => onSort(next)}
                        title={m.hint}
                        className={`inline-flex items-center gap-1 hover:text-foreground ${on ? "text-foreground" : ""}`}
                      >
                        {m.label}
                        {dir === "desc" && <ArrowDown className="size-3" />}
                        {dir === "asc" && <ArrowUp className="size-3" />}
                      </button>
                    </th>
                  );
                })}
              </tr>
              <tr className="border-b text-[11px]">
                <th className="sticky left-0 z-10 bg-card py-1 pr-3" />
                <th className="py-1 pr-3 text-right font-normal">A / B</th>
                {result.metrics.flatMap((m) => [
                  <th key={`${m.key}-a`} className="border-l py-1 pl-3 text-right font-normal">
                    {labels.a}
                  </th>,
                  <th key={`${m.key}-b`} className="py-1 pl-3 text-right font-normal">
                    {labels.b}
                  </th>,
                  <th key={`${m.key}-d`} className="py-1 pl-3 text-right font-normal">
                    Δ
                  </th>,
                ])}
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row) => (
                <tr key={row.bucket} className="border-b last:border-0">
                  <td className="sticky left-0 bg-card py-2 pr-3">
                    {bucketLabel(result.dimension, row.bucket)}
                  </td>
                  <td
                    className="py-2 pr-3 text-right tabular-nums"
                    title={
                      row.shared > 0
                        ? `${row.shared} of these trades are in both sets`
                        : undefined
                    }
                  >
                    {row.a?.n ?? "—"} / {row.b?.n ?? "—"}
                  </td>
                  {result.metrics.flatMap((m) => {
                    const ci = row.deltaIntervals[m.key] ?? null;
                    const unsure = isDeltaInconclusive(row, m);
                    return [
                      <td key={`${m.key}-a`} className="border-l py-2 pl-3 text-right tabular-nums">
                        {row.a ? fmt(row.a.values[m.key], m.unit) : "—"}
                      </td>,
                      <td key={`${m.key}-b`} className="py-2 pl-3 text-right tabular-nums">
                        {row.b ? fmt(row.b.values[m.key], m.unit) : "—"}
                      </td>,
                      <td
                        key={`${m.key}-d`}
                        className={`py-2 pl-3 text-right tabular-nums ${unsure ? "text-muted-foreground/70" : "font-medium"}`}
                        title={ci ? `95 % interval over ${ci.n} trades, the thinner of the two` : undefined}
                      >
                        {fmtDelta(row.deltas[m.key], m)}
                        {ci && (
                          <span className="block text-[11px] font-normal text-muted-foreground">
                            {fmtDelta(ci.lo, m)} – {fmtDelta(ci.hi, m)}
                          </span>
                        )}
                      </td>,
                    ];
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {notes.length > 0 && (
          <p className="mt-3 text-xs text-muted-foreground">{notes.join(" · ")}.</p>
        )}
      </CardContent>
    </Card>
  );
}
