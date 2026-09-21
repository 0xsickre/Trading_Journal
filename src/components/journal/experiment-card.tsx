"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatMetric, metric as toMetric } from "@/lib/journal/units";
import { getMetric } from "@/lib/journal/reports/metrics";
import {
  EXPERIMENT_METRIC_KEYS,
  MIN_WINDOW_TRADES,
  type ExperimentSummary,
} from "@/lib/journal/experiments";
import { startExperiment, endExperiment } from "@/app/(app)/weekly/actions";

/**
 * "Jednu stvar menjam" — sa ishodom.
 *
 * Kartica postoji da bi ODBILA presudu. Dok interval razlike obuhvata nulu,
 * piše da ne znaš, i to je na knjizi od 40–70 trejdova godišnje najčešći
 * odgovor. Merenje se radi na serveru (`experiments.ts`); ovde se samo
 * ispisuje, zajedno sa onim što ne kontroliše.
 */

const VERDICT: Record<ExperimentSummary["verdict"], { label: string; className: string }> = {
  thin: { label: "premalo trejdova", className: "text-muted-foreground" },
  unknown: { label: "još ne znaš", className: "text-muted-foreground" },
  better: { label: "bolje", className: "text-[var(--chart-2)]" },
  worse: { label: "gore", className: "text-destructive" },
};

const METRIC_LABEL: Record<string, string> = Object.fromEntries(
  EXPERIMENT_METRIC_KEYS.map((k) => [k, getMetric(k)?.label ?? k]),
);

export function ExperimentCard({
  weekStart,
  summaries,
  oneChange,
  /** A sealed week is read-only, like every other control on this page. */
  disabled,
}: {
  weekStart: string;
  summaries: ExperimentSummary[];
  /** This week's "one thing I am changing", to prefill the hypothesis. */
  oneChange: string | null;
  disabled: boolean;
}) {
  const running = summaries.filter((s) => s.experiment.status === "running");
  const finished = summaries.filter((s) => s.experiment.status !== "running");
  const startedThisWeek = summaries.some((s) => s.experiment.started_week === weekStart);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Eksperiment</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {running.map((s) => (
          <RunningExperiment key={s.experiment.id} summary={s} disabled={disabled} />
        ))}

        {!startedThisWeek && (
          <StartForm weekStart={weekStart} oneChange={oneChange} disabled={disabled} />
        )}

        {finished.length > 0 && (
          <div className="space-y-2 border-t pt-3">
            {finished.map((s) => (
              <p key={s.experiment.id} className="text-xs text-muted-foreground">
                <span className="text-foreground">{s.experiment.hypothesis}</span> ·{" "}
                {s.experiment.started_week} → {s.experiment.ended_week} ·{" "}
                {s.experiment.status === "kept" ? "zadržano" : "odbačeno"} ·{" "}
                {VERDICT[s.verdict].label}
              </p>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RunningExperiment({
  summary,
  disabled,
}: {
  summary: ExperimentSummary;
  disabled: boolean;
}) {
  const [pending, start] = useTransition();
  const fmt = (v: number | null) =>
    formatMetric(toMetric(v, summary.unit, { currency: "USD", equityBase: null }), "dollars");

  const finish = (status: "kept" | "dropped") =>
    start(async () => {
      const res = await endExperiment(summary.experiment.id, status);
      if (!res.ok) toast.error(res.error);
    });

  return (
    <div className="space-y-2">
      <p className="rounded-md border-l-2 border-primary/50 bg-muted/40 px-3 py-2">
        {summary.experiment.hypothesis}
      </p>

      <div className="grid grid-cols-3 gap-2 text-center">
        <Figure
          label={`Pre (${summary.window.beforeFrom} → ${summary.window.beforeTo})`}
          value={fmt(summary.before)}
          note={`${summary.beforeN} trejdova`}
        />
        <Figure
          label={`Posle (${summary.window.afterFrom} →)`}
          value={fmt(summary.after)}
          note={`${summary.afterN} trejdova`}
        />
        <Figure
          label={`Razlika · ${METRIC_LABEL[summary.experiment.metric_key] ?? summary.metricLabel}`}
          value={summary.delta == null ? "—" : `${summary.delta > 0 ? "+" : summary.delta < 0 ? "−" : ""}${fmt(Math.abs(summary.delta))}`}
          note={
            summary.interval
              ? `${fmt(summary.interval.lo)} – ${fmt(summary.interval.hi)}`
              : `treba ${MIN_WINDOW_TRADES}+ sa obe strane`
          }
          className={VERDICT[summary.verdict].className}
        />
      </div>

      <p className={`text-sm font-medium ${VERDICT[summary.verdict].className}`}>
        {VERDICT[summary.verdict].label}
        {summary.verdict === "unknown" &&
          ` — interval razlike i dalje obuhvata nulu (n=${Math.min(summary.beforeN, summary.afterN)})`}
        {summary.verdict === "thin" &&
          ` — ${summary.beforeN} pre i ${summary.afterN} posle`}
      </p>

      {/* Rečeno jednom, i uvek: ovo nije kontrolisan eksperiment. */}
      <p className="text-xs text-muted-foreground">
        Nekontrolisano: instrument, volatilnost tržišta i sama svest da se meri.
        Dva prozora iste knjige su najbolje poređenje koje ovi podaci nose, ne
        dokaz uzroka. Tvoj odgovor „jesam li ispoštovao” stoji odvojeno — to je
        tvoja reč o tvom ponašanju, a ovo je broj iz knjige.
      </p>

      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={disabled || pending} onClick={() => finish("kept")}>
          Zadrži
        </Button>
        <Button size="sm" variant="ghost" disabled={disabled || pending} onClick={() => finish("dropped")}>
          Odbaci
        </Button>
      </div>
    </div>
  );
}

function Figure({
  label,
  value,
  note,
  className = "",
}: {
  label: string;
  value: string;
  note: string;
  className?: string;
}) {
  return (
    <div className="rounded-md border px-2 py-1.5">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={`tabular-nums ${className}`}>{value}</div>
      <div className="text-[11px] text-muted-foreground">{note}</div>
    </div>
  );
}

function StartForm({
  weekStart,
  oneChange,
  disabled,
}: {
  weekStart: string;
  oneChange: string | null;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(oneChange ?? "");
  const [metricKey, setMetricKey] = useState<string>(EXPERIMENT_METRIC_KEYS[0]);
  const [pending, start] = useTransition();

  if (!open) {
    return (
      <Button size="sm" variant="outline" disabled={disabled} onClick={() => setOpen(true)}>
        Prati ovo kao eksperiment
      </Button>
    );
  }

  const submit = () =>
    start(async () => {
      const res = await startExperiment(weekStart, {
        hypothesis: text,
        metric_key: metricKey as (typeof EXPERIMENT_METRIC_KEYS)[number],
      });
      if (res.ok) setOpen(false);
      else toast.error(res.error);
    });

  return (
    <div className="space-y-2">
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        placeholder="Šta tačno menjaš od ove nedelje?"
      />
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Meri se sa</span>
        <Select value={metricKey} onValueChange={setMetricKey}>
          <SelectTrigger className="h-9 w-48" aria-label="Metrika eksperimenta">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {EXPERIMENT_METRIC_KEYS.map((k) => (
              <SelectItem key={k} value={k}>
                {METRIC_LABEL[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" disabled={pending || text.trim() === ""} onClick={submit}>
          Pokreni
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => setOpen(false)}>
          Otkaži
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Bira se samo metrika koja nosi interval — eksperiment bez intervala je
        anegdota sa datumom. Prozor „pre” je četiri nedelje pre ove.
      </p>
    </div>
  );
}
