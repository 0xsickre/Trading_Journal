"use client";

import { useState, useTransition } from "react";
import { Compass } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { addDailyBias } from "@/app/(app)/daily/bias-actions";
import { BIAS_ROOTS, type BiasRoot } from "@/lib/journal/default-instruments";
import {
  BIAS_DIRS,
  BIAS_LABEL,
  BIAS_MIN_SAMPLE,
  biasLateText,
  biasesOf,
  outcomeText,
  rateText,
  type BiasDir,
  type BiasSummary,
  type DailyBias,
} from "@/lib/journal/daily-bias";
import { DEFAULT_TZ, fmtInTz } from "@/lib/journal/time";

const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.round(Math.abs(n)).toLocaleString("sr-Latn-RS")}`;

/**
 * „Bias dana" (faza D) — the forecast set before the session, per root (MNQ/MES/MGC trade on
 * the NQ/ES/GC price), and what the exchange's prices made of it.
 *
 * The first forecast of the day is the one graded; a change is written as a new one and shown
 * under it. The grade arrives from futures-trading after 18:00 Belgrade. Under the roots, the
 * running score: my winrate and always-long's on the same days.
 */
export function DailyBiasCard({
  day,
  biases,
  firstEntryOf,
  canWrite,
  summary,
  tz = DEFAULT_TZ,
}: {
  day: string;
  /** The forecasts of this day. */
  biases: DailyBias[];
  /** The day's first entry per root (ISO), for the forecast set after it. */
  firstEntryOf: Partial<Record<BiasRoot, string | null>>;
  /** Today's page and an unlocked day. */
  canWrite: boolean;
  summary: BiasSummary;
  tz?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Compass className="size-4" /> Bias dana
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-xs text-muted-foreground">
          Upiši pre prvog ulaza. Meri se od 09:00 (ili od upisa, ako je kasnije) do 18:00 po Beogradu; meri se prvi
          upis dana. Mikro ugovor (MNQ, MES, MGC) ima bias svog mini ugovora.
        </p>
        {BIAS_ROOTS.map((root) => (
          <RootRow
            key={root}
            day={day}
            root={root}
            list={biasesOf(biases, day, root)}
            firstEntryAt={firstEntryOf[root] ?? null}
            canWrite={canWrite}
            tz={tz}
          />
        ))}
        <ScoreLine summary={summary} />
      </CardContent>
    </Card>
  );
}

function RootRow({
  day,
  root,
  list,
  firstEntryAt,
  canWrite,
  tz,
}: {
  day: string;
  root: BiasRoot;
  list: DailyBias[];
  firstEntryAt: string | null;
  canWrite: boolean;
  tz: string;
}) {
  const [pending, start] = useTransition();
  const [reason, setReason] = useState("");
  const first = list[0] ?? null;
  const late = first ? biasLateText(first, firstEntryAt, tz) : null;

  function save(bias: BiasDir) {
    start(async () => {
      const res = await addDailyBias(day, { root, bias, reason: reason.trim() || undefined });
      if (res.ok) {
        setReason("");
        toast.success(`${root}: ${BIAS_LABEL[bias]} upisan`);
      } else toast.error(res.error);
    });
  }

  return (
    <div className="space-y-2 border-t pt-3 first-of-type:border-t-0 first-of-type:pt-0">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="w-8 font-medium">{root}</span>
        {first ? (
          <>
            <span className="font-medium">{BIAS_LABEL[first.bias]}</span>
            <span className="text-xs text-muted-foreground">upisano {fmtInTz(first.setAt, tz, "HH:mm")}</span>
            <span className="text-xs">{outcomeText(first)}</span>
            {late && <span className="text-xs font-medium text-[var(--loss)]">{late}, ne ocenjuje se</span>}
          </>
        ) : (
          <span className="text-xs text-muted-foreground">nije upisan</span>
        )}
      </div>
      {first?.reason && <p className="pl-11 text-xs text-muted-foreground">{first.reason}</p>}
      {list.length > 1 && (
        <ul className="pl-11 text-xs text-muted-foreground">
          {list.slice(1).map((b) => (
            <li key={b.id}>
              promena u {fmtInTz(b.setAt, tz, "HH:mm")}: {BIAS_LABEL[b.bias]}
              {b.reason ? ` — ${b.reason}` : ""} (meri se prvi, {fmtInTz(first!.setAt, tz, "HH:mm")})
            </li>
          ))}
        </ul>
      )}
      {canWrite && (
        <div className="flex flex-wrap items-center gap-2 pl-11">
          {BIAS_DIRS.map((d) => (
            <Button key={d} type="button" size="sm" variant="outline" disabled={pending} onClick={() => save(d)}>
              {first ? `Promeni: ${BIAS_LABEL[d]}` : BIAS_LABEL[d]}
            </Button>
          ))}
          <Input
            aria-label={`${root} — zašto`}
            className="h-8 min-w-48 flex-1"
            maxLength={500}
            placeholder="Zašto (jedna rečenica, nije obavezno)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
      )}
    </div>
  );
}

function ScoreLine({ summary }: { summary: BiasSummary }) {
  const { total } = summary;
  if (total.n === 0)
    return <p className="border-t pt-3 text-xs text-muted-foreground">Još nema ocenjenih dana za poređenje sa uvek long.</p>;
  const points = BIAS_ROOTS.filter((r) => summary.byRoot[r].n > 0).map(
    (r) => `${r} ${signed(summary.byRoot[r].points)} / ${signed(summary.byRoot[r].longPoints)} poena`,
  );
  return (
    <div className="space-y-1 border-t pt-3 text-xs">
      <p>
        <span className="font-medium">Moj {rateText(total.hits, total.n)}</span>
        <span className="text-muted-foreground"> · Uvek long {rateText(total.longHits, total.n)}</span>
        {points.length > 0 && <span className="text-muted-foreground"> · {points.join(" · ")}</span>}
      </p>
      {total.n < BIAS_MIN_SAMPLE && (
        <p className="text-muted-foreground">Mali uzorak: {total.n} od {BIAS_MIN_SAMPLE} dana, još nije zaključak.</p>
      )}
    </div>
  );
}
