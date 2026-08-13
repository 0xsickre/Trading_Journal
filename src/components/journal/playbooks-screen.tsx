"use client";

import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { PlaybookManager } from "@/components/journal/playbook-manager";
import { runReport, type ReportRow } from "@/lib/journal/reports/engine";
import { getMetric } from "@/lib/journal/reports/metrics";
import type { MetricContext } from "@/lib/journal/reports/metrics";
import {
  RULE_SAMPLE,
  playbookDimension,
  type PlaybookLookup,
} from "@/lib/journal/reports/playbook-dimensions";
import { ruleScorecard, type RuleScore } from "@/lib/journal/reports/rule-scorecard";
import { formatMetric, metric as mkMetric } from "@/lib/journal/units";
import {
  RULE_CATEGORY_LABELS,
  rulesByCategory,
  type Playbook,
  type PlaybookRule,
} from "@/lib/journal/playbook-types";
import type { EnrichedTrade } from "@/lib/journal/enriched-trade";
import type { BreakevenRange } from "@/lib/journal/breakeven";

/** Header metrics per playbook — the TradeZella set, computed by our engine. */
const HEADER_METRICS = [
  "trade_count",
  "win_rate",
  "expectancy",
  "profit_factor",
  "avg_r",
  "follow_rate",
] as const;

export function PlaybooksScreen({
  playbooks,
  library,
  trades,
  lookup,
  currency,
  breakevenRange,
}: {
  playbooks: Playbook[];
  library: PlaybookRule[];
  trades: EnrichedTrade[];
  lookup: PlaybookLookup;
  currency: string;
  breakevenRange: BreakevenRange;
}) {
  const metricCtx = useMemo<MetricContext>(
    () => ({
      pnlBasis: "net",
      range: breakevenRange,
      currency,
      rules: lookup.rules,
    }),
    [breakevenRange, currency, lookup],
  );

  /**
   * Header numbers per playbook, from `runReport`.
   *
   * The same function `/reports` calls, with the same dimension and the same
   * metric registry — so "Expectancy 0.34R" here and in a report grouped by
   * Playbook are the same computation, not two that agree today.
   */
  const byPlaybook = useMemo(() => {
    const result = runReport({
      trades,
      dimension: playbookDimension(lookup.names),
      dimensionContext: { reportByDate: new Map() },
      metricContext: metricCtx,
      metricKeys: [...HEADER_METRICS],
    });
    return new Map(
      (result?.rows ?? []).map((r) => [r.bucket, r] as const),
    );
  }, [trades, lookup, metricCtx]);

  return (
    <div className="space-y-6">
      {playbooks.length > 0 && (
        <div className="space-y-4">
          {playbooks.map((book) => (
            <PlaybookScorecard
              key={book.id}
              book={book}
              row={byPlaybook.get(book.name)}
              trades={trades}
              lookup={lookup}
              metricCtx={metricCtx}
            />
          ))}
        </div>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Define</CardTitle>
        </CardHeader>
        <CardContent>
          <PlaybookManager playbooks={playbooks} library={library} />
        </CardContent>
      </Card>
    </div>
  );
}

function PlaybookScorecard({
  book,
  row,
  trades,
  lookup,
  metricCtx,
}: {
  book: Playbook;
  row: ReportRow | undefined;
  trades: EnrichedTrade[];
  lookup: PlaybookLookup;
  metricCtx: MetricContext;
}) {
  const n = row?.n ?? 0;

  const scores = useMemo(
    () =>
      ruleScorecard(
        trades,
        lookup.rules,
        metricCtx,
        book.rules.map((r) => r.id),
      ),
    [trades, lookup, metricCtx, book.rules],
  );
  const scoreById = new Map(scores.map((s) => [s.ruleId, s]));
  const sections = rulesByCategory(book.rules);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-baseline gap-2">
          <CardTitle className="text-base">{book.name}</CardTitle>
          <span className="text-sm text-muted-foreground">
            {n} {n === 1 ? "trade" : "trades"}
          </span>
          {n > 0 && n < RULE_SAMPLE.MIN && (
            <Badge variant="secondary">counts only</Badge>
          )}
          {n >= RULE_SAMPLE.MIN && n < RULE_SAMPLE.USABLE && (
            <Badge variant="secondary">provisional</Badge>
          )}
          {!book.is_active && <Badge variant="outline">inactive</Badge>}
          {book.default_risk_pct != null && (
            <Badge variant="outline">{book.default_risk_pct}% risk</Badge>
          )}
        </div>
        {book.a_plus_criteria && (
          <p className="text-sm text-muted-foreground">
            <b>A+:</b> {book.a_plus_criteria}
          </p>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {n === 0 ? (
          <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
            No trade has used this playbook yet. Numbers appear once it does —
            and stay counts, not verdicts, until {RULE_SAMPLE.MIN} observations.
          </p>
        ) : (
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {HEADER_METRICS.map((key) => {
              const m = getMetric(key);
              if (!m) return null;
              return (
                <div key={key}>
                  <dt className="text-xs text-muted-foreground">{m.label}</dt>
                  <dd className="text-lg font-semibold tabular-nums">
                    {formatMetric(
                      mkMetric(row?.values[key] ?? null, m.unit, {
                        currency: metricCtx.currency,
                      }),
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
        )}

        {sections.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No rules linked yet. Add them below.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="py-1.5 text-left font-medium">Rule</th>
                  <th className="py-1.5 text-right font-medium">n</th>
                  <th className="py-1.5 text-right font-medium">Followed</th>
                  <th className="py-1.5 text-right font-medium">Broken</th>
                  <th className="py-1.5 text-right font-medium">Difference</th>
                </tr>
              </thead>
              <tbody>
                {sections.map((section) => (
                  <RuleSection
                    key={section.category}
                    label={RULE_CATEGORY_LABELS[section.category]}
                    rules={section.rules}
                    scoreById={scoreById}
                  />
                ))}
              </tbody>
            </table>
            {/* Said on the screen, not only in the plan. The alternative — a
                sorted list of rules by win rate — is exactly how a journal
                talks its owner into keeping whichever rule got lucky. */}
            <p className="mt-2 text-xs text-muted-foreground">
              Difference is win % when you kept the rule minus win % when you did
              not — the only comparison that holds the setup constant. It is
              withheld below {RULE_SAMPLE.MIN} observations, and blank when a rule
              has never been broken. Rules are never ranked by result.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RuleSection({
  label,
  rules,
  scoreById,
}: {
  label: string;
  rules: PlaybookRule[];
  scoreById: Map<string, RuleScore>;
}) {
  return (
    <>
      <tr>
        <td
          colSpan={5}
          className="pt-3 pb-1 text-xs font-semibold text-muted-foreground"
        >
          {label}
        </td>
      </tr>
      {rules.map((rule) => {
        const s = scoreById.get(rule.id);
        return (
          <tr key={rule.id} className="border-b last:border-0">
            <td className="py-1.5 pr-3">{rule.text}</td>
            <td className="py-1.5 text-right tabular-nums">{s?.n ?? 0}</td>
            <td className="py-1.5 text-right tabular-nums">
              <Side n={s?.followed.n ?? 0} winRate={s?.followed.winRate ?? null} />
            </td>
            <td className="py-1.5 text-right tabular-nums">
              <Side n={s?.broken.n ?? 0} winRate={s?.broken.winRate ?? null} />
            </td>
            <td
              className={cn(
                "py-1.5 text-right tabular-nums",
                s?.gapPp != null &&
                  (s.gapPp > 0
                    ? "text-emerald-600 dark:text-emerald-500"
                    : s.gapPp < 0
                      ? "text-red-600 dark:text-red-500"
                      : undefined),
              )}
            >
              {s?.gapPp != null
                ? `${s.gapPp > 0 ? "+" : ""}${s.gapPp.toFixed(0)} pp`
                : s && s.n > 0 && s.n < RULE_SAMPLE.MIN
                  ? "too few"
                  : "—"}
            </td>
          </tr>
        );
      })}
    </>
  );
}

/**
 * One side of the contrast.
 *
 * The count is shown even when the win rate is withheld, because "answered 4
 * times" is a fact worth seeing while "57 %" on four trades is not.
 */
function Side({ n, winRate }: { n: number; winRate: number | null }) {
  if (n === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <span>
      {n < RULE_SAMPLE.MIN || winRate == null ? (
        <span className="text-muted-foreground">n={n}</span>
      ) : (
        `${winRate.toFixed(0)}%`
      )}
    </span>
  );
}
