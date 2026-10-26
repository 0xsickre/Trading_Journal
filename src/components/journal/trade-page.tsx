"use client";

import Link from "next/link";
import { useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Chips } from "@/components/journal/chips";
import { CategoryField, type CategoryValue } from "@/components/journal/category-field";
import { PlaybookChecklist } from "@/components/journal/playbook-checklist";
import { ExcursionBar } from "@/components/journal/viz/tile-visuals";
import { deleteTrade, saveTradeReview, updateMissedSetup } from "@/app/(app)/trades/actions";
import { classifyOutcome, type BreakevenRange } from "@/lib/journal/breakeven";
import { fmtMoney, fmtPrice, fmtR, pnlClass } from "@/lib/journal/format";
import { GRADE_RATING, GRADES, gradeFromRating, NO_MISTAKE, type Grade } from "@/lib/journal/quick-log";
import { offeredRuleAnswers } from "@/lib/journal/offered-rule-answers";
import { utcToZonedInput, zonedInputToUtc } from "@/lib/journal/time";
import type { FieldDef } from "@/lib/journal/field-def-types";
import type { AutoMistake } from "@/lib/journal/auto-mistakes";
import type { Playbook } from "@/lib/journal/playbook-types";
import type { OptionsMap } from "@/lib/journal/types";
import { cn } from "@/lib/utils";

/** Everything the page shows about one trade, assembled on the server. */
export type TradePageTrade = {
  id: string;
  label: string;
  missed: boolean;
  accountName: string | null;
  currency: string;
  direction: string | null;
  qty: number | null;
  avgEntry: number | null;
  avgExit: number | null;
  /** Already formatted, Belgrade time. */
  opened: string | null;
  closed: string | null;
  durationSeconds: number | null;
  netPl: number | null;
  realizedR: number | null;
  fees: number | null;
  maeR: number | null;
  mfeR: number | null;
  pointValue: number | null;
  fxRate: number | null;
  tickSize: number | null;
  stop: number | null;
  target: number | null;
  /** The stop order's last price from the orders export (phase O). */
  finalStop: number | null;
  /** Set when the stop was moved — the original is asked for. */
  stopNote: string | null;
  thesis: string | null;
  playbookId: string | null;
  ruleAnswers: Record<string, boolean>;
  rating: number | null;
  notes: string | null;
  /** Every category's current value, by definition key. */
  categories: Record<string, CategoryValue>;
  /** Missed setup only: the planned entry and when it was seen. */
  plannedEntry: number | null;
  seenAt: string | null;
  timezone: string;
};

const GRADE_HINT: Record<Grade, string> = {
  A: "Po planu — ulaz, stop, veličina i izlaz kako je rečeno",
  B: "Manja odstupanja",
  C: "Prekršeno pravilo",
};

const num = (s: string) => {
  const v = Number(s.replace(",", "."));
  return s.trim() === "" || !Number.isFinite(v) ? null : v;
};
const str = (n: number | null) => (n == null ? "" : String(n));

function duration(sec: number | null): string {
  if (sec == null) return "—";
  const m = Math.round(sec / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

function Fact({ label, children, cls }: { label: string; children: ReactNode; cls?: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("font-medium tabular-nums", cls)}>{children}</div>
    </div>
  );
}

/**
 * One page per trade (phase P), in the order the recording is watched: the trade
 * as the import brought it, what stood in the platform and what was said before
 * the click, the setup and its checklist, the context, the review. Fills are the
 * exchange's and are never typed here (P-1); the original stop is, because a stop
 * moved to breakeven leaves only its last price in the export.
 */
export function TradePage({
  trade,
  playbooks,
  contextDefs,
  biasNote = null,
  autoMistakes = [],
  reviewDefs,
  optionsMap,
  breakevenRange,
  backHref,
  images,
  scenario,
}: {
  trade: TradePageTrade;
  playbooks: Playbook[];
  /** Categories asked about the setup (phase `always`, or `missed` on a missed setup). */
  contextDefs: FieldDef[];
  /** Bias dana from the /daily card (phase D) — said here instead of asked. */
  biasNote?: string | null;
  /** Mistakes the journal found by itself (phase B4) — shown, never picked. */
  autoMistakes?: AutoMistake[];
  /** Categories asked in the review (phase `active`). */
  reviewDefs: FieldDef[];
  optionsMap: OptionsMap;
  breakevenRange: BreakevenRange;
  backHref: string;
  images: ReactNode;
  scenario: ReactNode;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [dirty, setDirty] = useState(false);
  const touch = <T,>(set: (v: T) => void) => (v: T) => {
    setDirty(true);
    set(v);
  };

  const [stop, setStop] = useState(str(trade.stop));
  const [target, setTarget] = useState(str(trade.target));
  const [said, setSaid] = useState(trade.thesis ?? "");
  const [entry, setEntry] = useState(str(trade.plannedEntry));
  const [direction, setDirection] = useState<"Long" | "Short">(trade.direction === "Short" ? "Short" : "Long");
  const [seenAt, setSeenAt] = useState(utcToZonedInput(trade.seenAt, trade.timezone));
  const [playbookId, setPlaybookId] = useState<string | null>(trade.playbookId);
  const [answers, setAnswers] = useState<Record<string, boolean>>(trade.ruleAnswers);
  const [grade, setGrade] = useState<Grade | null>(gradeFromRating(trade.rating));
  const [cats, setCats] = useState<Record<string, CategoryValue>>(trade.categories);
  const [note, setNote] = useState(trade.notes ?? "");

  const hasNoMistake = (optionsMap.mistake ?? []).some((o) => o.value === NO_MISTAKE);
  function pickGrade(g: Grade) {
    const next = grade === g ? null : g;
    setGrade(next);
    setDirty(true);
    // A clean trade records "Bez greške", so a clean week is counted, not just empty;
    // a B or C cannot keep it.
    if (!hasNoMistake) return;
    setCats((c) => {
      const list = Array.isArray(c.mistake) ? c.mistake.filter((m) => m !== NO_MISTAKE) : [];
      return { ...c, mistake: next === "A" ? [NO_MISTAKE] : list };
    });
  }

  const stopN = num(stop);
  const targetN = num(target);
  const refEntry = trade.missed ? num(entry) : trade.avgEntry;
  const dir = (trade.missed ? direction : trade.direction) === "Short" ? -1 : 1;
  const riskPts = refEntry != null && stopN != null ? dir * (refEntry - stopN) : null;
  const rewardPts = refEntry != null && targetN != null ? dir * (targetN - refEntry) : null;
  const plannedRR = riskPts != null && riskPts > 0 && rewardPts != null && rewardPts > 0 ? rewardPts / riskPts : null;

  // Risk to the stop in money at the size taken: the breakeven band is a share of it.
  const riskMoney =
    riskPts != null && riskPts > 0 && trade.qty && trade.pointValue && trade.fxRate
      ? riskPts * trade.qty * trade.pointValue * trade.fxRate
      : null;
  const outcome = trade.netPl == null ? null : classifyOutcome(trade.netPl, breakevenRange, riskMoney);
  const book = useMemo(() => playbooks.find((p) => p.id === playbookId) ?? null, [playbooks, playbookId]);
  // Entry TF from the playbook when the trade has none (phase B3) — shown as "auto",
  // saved with the trade, and overridden by any TF picked by hand.
  const tfOwn = typeof cats.entry_tf === "string" && cats.entry_tf !== "" ? cats.entry_tf : null;
  const tfAuto = !trade.missed && tfOwn == null ? (book?.default_entry_tf ?? null) : null;
  const catsToSave = tfAuto ? { ...cats, entry_tf: tfAuto } : cats;

  function save() {
    start(async () => {
      if (trade.missed) {
        const at = seenAt ? zonedInputToUtc(seenAt, trade.timezone) : null;
        if (num(entry) == null || stopN == null || targetN == null || !at) {
          toast.error("Propušten setup traži ulaz, stop, cilj i vreme.");
          return;
        }
        const lv = await updateMissedSetup(trade.id, {
          direction,
          entry_price: num(entry)!,
          stop_price: stopN,
          target_price: targetN,
          seen_at: at,
        });
        if (!lv.ok) {
          toast.error(lv.error);
          return;
        }
      }
      const res = await saveTradeReview(trade.id, {
        playbook_id: playbookId,
        execution_rating: trade.missed ? null : grade ? GRADE_RATING[grade] : null,
        trade_journal_notes: note,
        images: [],
        ...(trade.missed ? {} : { stop_price: stopN, target_price: targetN, thesis: said.trim() || null }),
        categories: catsToSave as Record<string, string | string[] | null>,
        rule_answers: offeredRuleAnswers(book, answers, outcome),
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`${trade.label} sačuvan`);
      setDirty(false);
      router.push(backHref);
    });
  }

  function remove() {
    if (!window.confirm("Obrisati ovaj trejd? Fill-ovi, odgovori i slike idu sa njim. Ne može da se vrati.")) return;
    start(async () => {
      const res = await deleteTrade(trade.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`${trade.label} obrisan`);
      router.push(backHref);
    });
  }

  // Manual mistakes are asked only when the trade was not by plan (phase B2): an A
  // records "Bez greške" itself. An old trade that already carries one keeps it on screen.
  const ownMistakes = Array.isArray(cats.mistake) ? cats.mistake.filter((m) => m !== NO_MISTAKE) : [];
  const askMistakes = grade === "B" || grade === "C" || ownMistakes.length > 0;
  const reviewShown = reviewDefs.filter((d) => d.key !== "mistake" || askMistakes);

  const warnings = [
    !trade.missed && !playbookId && "Bez setupa — trejd ne ulazi u brojeve nijednog playbook-a.",
    !trade.missed && !grade && "Bez ocene — da li je bilo po planu?",
    stopN == null && "Bez stopa — trejd nema R, a pregled meri u R.",
  ].filter((w): w is string => Boolean(w));

  return (
    <div className="space-y-4 pb-24">
      {/* 1 · The trade as the import brought it */}
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-baseline gap-x-3 text-base">
            <span>{trade.missed ? `Propušten setup ${trade.label}` : trade.label}</span>
            {trade.accountName && <span className="text-sm font-normal text-muted-foreground">{trade.accountName}</span>}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {trade.missed ? (
            <p className="text-muted-foreground">Nije uzet — ishod iz sveća računa futures-trading (Šta bi bilo).</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Fact label="Smer · ugovori">
                {trade.direction ?? "—"} · {trade.qty ?? "—"}
              </Fact>
              <Fact label="Ulaz → izlaz">
                {fmtPrice(trade.avgEntry, trade.tickSize)} → {fmtPrice(trade.avgExit, trade.tickSize)}
              </Fact>
              <Fact label="Vreme (Beograd)">
                {trade.opened ?? "—"}
                {trade.closed ? ` → ${trade.closed.slice(-5)}` : " · otvoren"}
              </Fact>
              <Fact label="Trajanje">{duration(trade.durationSeconds)}</Fact>
              <Fact label="Net P/L" cls={pnlClass(trade.netPl)}>
                {fmtMoney(trade.netPl, trade.currency, { sign: true })}
              </Fact>
              <Fact label="R" cls={pnlClass(trade.realizedR)}>
                {fmtR(trade.realizedR)}
              </Fact>
              <Fact label="MAE / MFE">
                {trade.maeR != null ? `−${trade.maeR.toFixed(2)}R` : "—"} … {trade.mfeR != null ? `+${trade.mfeR.toFixed(2)}R` : "—"}
                <div className="mt-1 w-28">
                  <ExcursionBar maeR={trade.maeR} mfeR={trade.mfeR} realizedR={trade.realizedR} />
                </div>
              </Fact>
              <Fact label="Provizije · rizik do stopa">
                {fmtMoney(trade.fees, trade.currency)} · {fmtMoney(riskMoney, trade.currency)}
              </Fact>
            </div>
          )}
          {trade.finalStop != null && (
            <p className="text-muted-foreground">Poslednji stop u platformi: {fmtPrice(trade.finalStop, trade.tickSize)}</p>
          )}
        </CardContent>
      </Card>

      {/* 2 · Off the recording */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{trade.missed ? "Nivoi setupa" : "Sa snimka"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {trade.stopNote && (
            <p role="alert" className="flex items-start gap-1.5 text-sm text-[var(--loss)]">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {trade.stopNote}
            </p>
          )}
          {trade.missed && (
            <Chips
              items={[
                { value: "Long", label: "Long" },
                { value: "Short", label: "Short" },
              ]}
              selected={[direction]}
              onToggle={(v) => touch(setDirection)(v as "Long" | "Short")}
            />
          )}
          <div className="flex flex-wrap items-end gap-3">
            {trade.missed && (
              <label className="space-y-1 text-sm">
                <span className="text-xs text-muted-foreground">Ulaz</span>
                <Input inputMode="decimal" value={entry} onChange={(e) => touch(setEntry)(e.target.value)} className="w-36" />
              </label>
            )}
            <label className="space-y-1 text-sm">
              <span className="text-xs text-muted-foreground">{trade.missed ? "Stop" : "Originalni stop (na ulazu)"}</span>
              <Input inputMode="decimal" value={stop} onChange={(e) => touch(setStop)(e.target.value)} className="w-36" />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-xs text-muted-foreground">Cilj</span>
              <Input inputMode="decimal" value={target} onChange={(e) => touch(setTarget)(e.target.value)} className="w-36" />
            </label>
            {trade.missed && (
              <label className="space-y-1 text-sm">
                <span className="text-xs text-muted-foreground">Viđeno ({trade.timezone})</span>
                <Input type="datetime-local" value={seenAt} onChange={(e) => touch(setSeenAt)(e.target.value)} className="w-52" />
              </label>
            )}
            <div className="pb-2 text-sm">
              <span className="text-xs text-muted-foreground">Planirani R:R </span>
              <span className="font-semibold tabular-nums">{plannedRR != null ? `${plannedRR.toFixed(2)}R` : "—"}</span>
            </div>
          </div>
          {!trade.missed && (
            <label className="block space-y-1 text-sm">
              <span className="text-xs text-muted-foreground">Šta sam rekao pre klika (prazno = ništa nisam rekao)</span>
              <Textarea value={said} onChange={(e) => touch(setSaid)(e.target.value)} rows={2} />
            </label>
          )}
        </CardContent>
      </Card>

      {/* 3 · Setup */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Setup</CardTitle>
        </CardHeader>
        <CardContent>
          <PlaybookChecklist
            playbooks={playbooks}
            playbookId={playbookId}
            onPlaybookChange={touch(setPlaybookId)}
            answers={answers}
            onAnswerChange={(ruleId, followed) => {
              setDirty(true);
              setAnswers((prev) => {
                const next = { ...prev };
                if (followed == null) delete next[ruleId];
                else next[ruleId] = followed;
                return next;
              });
            }}
            netPl={trade.missed ? null : trade.netPl}
            riskMoney={riskMoney}
            breakevenRange={breakevenRange}
          />
        </CardContent>
      </Card>

      {/* 4 · Context: the trader's own categories, in the order of Settings */}
      {(contextDefs.length > 0 || biasNote) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Kontekst</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            {biasNote && <p className="text-sm text-muted-foreground sm:col-span-2">{biasNote}</p>}
            {contextDefs.map((def) => (
              <div key={def.key} className={cn(def.field_type !== "number" && "sm:col-span-2")}>
                <CategoryField
                  def={def}
                  value={def.key === "entry_tf" && tfAuto ? tfAuto : (cats[def.key] ?? null)}
                  onChange={(v) => touch(setCats)({ ...cats, [def.key]: v })}
                  optionsMap={optionsMap}
                />
                {def.key === "entry_tf" && tfAuto && (
                  <p className="mt-1 text-xs text-muted-foreground">auto — iz playbook-a „{book?.name}“</p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* 5 · Review */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{trade.missed ? "Beleška" : "Review"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!trade.missed && (
            <div className="space-y-1">
              <Label className="text-xs">Greške koje journal nalazi sam</Label>
              {autoMistakes.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nijedna — iz podataka koje journal ima.</p>
              ) : (
                <ul className="space-y-1">
                  {autoMistakes.map((m) => (
                    <li key={m.key} className="flex flex-wrap items-baseline gap-2 text-sm">
                      <span className="rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                        auto
                      </span>
                      <span className="font-medium">{m.label}</span>
                      <span className="text-xs text-muted-foreground">{m.reason}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {!trade.missed && (
            <div className="space-y-1.5">
              <Label className="text-xs">Po planu?</Label>
              <div className="grid grid-cols-3 gap-2">
                {GRADES.map((g) => (
                  <button
                    key={g}
                    type="button"
                    aria-pressed={grade === g}
                    onClick={() => pickGrade(g)}
                    className={cn(
                      "rounded-md border p-2 text-left transition-colors",
                      grade === g
                        ? g === "A"
                          ? "border-[var(--profit)] bg-[var(--profit)]/15"
                          : "border-[var(--loss)] bg-[var(--loss)]/10"
                        : "hover:bg-accent",
                    )}
                  >
                    <div className="text-lg font-semibold">{g}</div>
                    <div className="text-xs text-muted-foreground">{GRADE_HINT[g]}</div>
                  </button>
                ))}
              </div>
            </div>
          )}
          {reviewShown.length > 0 && (
            <div className="grid gap-4 sm:grid-cols-2">
              {reviewShown.map((def) => (
                <CategoryField
                  key={def.key}
                  def={def}
                  value={cats[def.key] ?? null}
                  onChange={(v) => touch(setCats)({ ...cats, [def.key]: v })}
                  optionsMap={optionsMap}
                />
              ))}
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="tp-note" className="text-xs">
              {trade.missed ? "Šta si video, šta te je zaustavilo" : "Jedna rečenica"}
            </Label>
            <Textarea id="tp-note" rows={2} value={note} onChange={(e) => touch(setNote)(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      {/* 6 · Charts, 7 · What would have happened */}
      {images}
      {scenario}

      <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 p-3 backdrop-blur md:left-(--sidebar-offset)">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3">
          <div className="space-y-0.5 text-xs text-muted-foreground">
            {warnings.map((w) => (
              <p key={w} className="flex items-center gap-1.5">
                <AlertTriangle className="size-3.5 shrink-0" /> {w}
              </p>
            ))}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={remove} disabled={pending}>
              <Trash2 className="size-4" /> Obriši
            </Button>
            <Button variant="outline" asChild>
              <Link
                href={backHref}
                onClick={(e) => {
                  if (dirty && !window.confirm("Odbaciti nesačuvane izmene?")) e.preventDefault();
                }}
              >
                Nazad
              </Link>
            </Button>
            <Button onClick={save} disabled={pending}>
              {pending ? "Čuvam…" : "Sačuvaj"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
