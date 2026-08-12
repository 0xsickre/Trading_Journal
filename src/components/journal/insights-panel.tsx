"use client";

import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { groupInsights, type InsightSeverity } from "@/lib/journal/insights/types";
import type { RunResult } from "@/lib/journal/insights/registry";
import { OMITTED_RULES } from "@/lib/journal/insights/registry";

const SEVERITY_LABEL: Record<InsightSeverity, string> = {
  critical: "Critical",
  warning: "Warning",
  info: "Observation",
  good: "Good",
};

const SEVERITY_CLASS: Record<InsightSeverity, string> = {
  critical: "border-[var(--loss)] text-[var(--loss)]",
  warning: "border-amber-500/60 text-amber-500",
  info: "border-border text-muted-foreground",
  good: "border-[var(--profit)] text-[var(--profit)]",
};

/**
 * Automatic feedback panel.
 *
 * Grouped by rule rather than listed flat: twelve separate "green to red"
 * lines is a wall, while one line saying it happened twelve times is a finding.
 * Rules that were skipped for lack of sample are surfaced too — knowing a
 * pattern could not yet be judged is itself information, and it stops the panel
 * from looking clean when it is merely uninformed.
 */
export function InsightsPanel({ result }: { result: RunResult }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showSkipped, setShowSkipped] = useState(false);

  const groups = useMemo(
    () => groupInsights(result.insights),
    [result.insights],
  );

  const counts = useMemo(() => {
    const c: Record<InsightSeverity, number> = {
      critical: 0,
      warning: 0,
      info: 0,
      good: 0,
    };
    for (const i of result.insights) c[i.severity]++;
    return c;
  }, [result.insights]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Automated insights</CardTitle>
          <div className="flex flex-wrap gap-1.5">
            {(["critical", "warning", "info", "good"] as const)
              .filter((s) => counts[s] > 0)
              .map((s) => (
                <span
                  key={s}
                  className={`rounded-full border px-2 py-0.5 text-xs ${SEVERITY_CLASS[s]}`}
                >
                  {SEVERITY_LABEL[s]} {counts[s]}
                </span>
              ))}
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          Deterministic rules over the data already here — no model, no guessing.
          A rule without a large enough sample does not run.
        </p>
      </CardHeader>

      <CardContent className="space-y-2">
        {groups.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            No pattern fired in the selected period.
          </p>
        ) : (
          groups.map((g) => {
            const open = expanded === g.ruleId;
            return (
              <div key={g.ruleId} className="rounded-md border">
                <button
                  onClick={() => setExpanded(open ? null : g.ruleId)}
                  className="flex w-full items-center gap-3 p-3 text-left"
                >
                  <span
                    className={`shrink-0 rounded-full border px-2 py-0.5 text-xs ${
                      SEVERITY_CLASS[g.severity]
                    }`}
                  >
                    {SEVERITY_LABEL[g.severity]}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {g.title}
                  </span>
                  <span className="shrink-0 text-sm text-muted-foreground">
                    {g.count}×
                  </span>
                  <ChevronDown
                    className={`size-4 shrink-0 text-muted-foreground transition-transform ${
                      open ? "rotate-180" : ""
                    }`}
                  />
                </button>

                {open && (
                  <div className="space-y-2 border-t px-3 py-2">
                    {g.insights.map((i, idx) => (
                      <div key={`${i.subjectId}-${idx}`} className="text-sm">
                        <span className="text-muted-foreground">
                          {i.subjectLabel ?? i.subjectId}
                        </span>
                        <span className="mx-1.5 text-muted-foreground">·</span>
                        <span>{i.detail}</span>
                        {i.sample != null && (
                          <span className="ml-1.5 text-xs text-muted-foreground">
                            (sample {i.sample})
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}

        {(result.skipped.length > 0 || OMITTED_RULES.length > 0) && (
          <div className="pt-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowSkipped((v) => !v)}
              className="h-7 px-2 text-xs text-muted-foreground"
            >
              {showSkipped ? "Hide" : "What was not assessed"} (
              {result.skipped.length + OMITTED_RULES.length})
            </Button>

            {showSkipped && (
              <div className="mt-2 space-y-2 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                {result.skipped.length > 0 && (
                  <div>
                    <div className="mb-1 font-medium">Sample too small</div>
                    <ul className="space-y-0.5">
                      {result.skipped.map((s) => (
                        <li key={s.id}>
                          <code>{s.id}</code> — needs {s.minSample}, has{" "}
                          {s.sample}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {OMITTED_RULES.length > 0 && (
                  <div>
                    <div className="mb-1 font-medium">
                      Deliberately not implemented
                    </div>
                    <ul className="space-y-1">
                      {OMITTED_RULES.map((o) => (
                        <li key={o.id}>
                          <code>{o.id}</code> — {o.reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
