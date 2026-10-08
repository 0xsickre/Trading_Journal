"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { saveTradeReview } from "@/app/(app)/trades/actions";
import { fmtMoney } from "@/lib/journal/format";
import { autoExitReason, GRADE_RATING, GRADES, gradeFromRating, NO_MISTAKE, type Grade } from "@/lib/journal/quick-log";
import type { OptionsMap } from "@/lib/journal/types";
import type { Playbook } from "@/lib/journal/playbook-types";
import { ChartThumb } from "@/components/journal/chart-image-input";
import { ChartImageListInput, imageDraftsToPayload } from "@/components/journal/trade-image-drafts";

/** A trade the export already brought in: its numbers are fixed, only the review is asked for. */
export type ReviewTrade = {
  id: string;
  label: string;
  currency: string;
  direction: string | null;
  qty: number | null;
  avgEntry: number | null;
  avgExit: number | null;
  stop: number | null;
  target: number | null;
  /** The stop order's last price from TopstepX's orders export (phase O). */
  finalStop?: number | null;
  /** Why the original stop is asked for — the stop was moved. Null when it was not. */
  stopNote?: string | null;
  /** What the trader said before the click, off the recording. */
  thesis?: string | null;
  tickSize: number | null;
  netPl: number | null;
  realizedR: number | null;
  playbookId: string | null;
  rating: number | null;
  mistake: string[];
  psychology: string[];
  notes: string | null;
  /** The charts the trade already has, in order. */
  images: string[];
};

const GRADE_HINT: Record<Grade, string> = {
  A: "By plan — entry, stop, size and exit as intended",
  B: "Small deviations",
  C: "A rule broken",
};

const num = (s: string) => {
  const v = Number(s.replace(",", "."));
  return s.trim() === "" || !Number.isFinite(v) ? null : v;
};

export function Chips({
  items,
  selected,
  onToggle,
  tone = "default",
}: {
  items: { value: string; label: string }[];
  selected: string[];
  onToggle: (v: string) => void;
  tone?: "default" | "loss";
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((it) => {
        const on = selected.includes(it.value);
        return (
          <button
            key={it.value}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(it.value)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs transition-colors",
              on
                ? tone === "loss"
                  ? "border-[var(--loss)] bg-[var(--loss)]/15 text-foreground"
                  : "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background text-muted-foreground hover:bg-accent",
            )}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * "Dopuna iz snimka" (phase O): the review of a trade the import brought in
 * (`/trades/[id]/review`). Its fills are the exchange's and stay as they are;
 * asked for is what only the trader and the recording know — the stop and target
 * as they stood at the entry, what was said before the click, the setup, A/B/C,
 * what went wrong, one sentence, the charts. Everything else lives in the full
 * form. Logging a trade by hand after the close (`/trades/log`) left with the
 * plan form in phase O: the import is the only way a trade comes in.
 */
export function QuickLogForm({
  playbooks,
  optionsMap,
  review,
}: {
  playbooks: Playbook[];
  optionsMap: OptionsMap;
  review: ReviewTrade;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const [playbookId, setPlaybookId] = useState<string | null>(review.playbookId);
  const [grade, setGrade] = useState<Grade | null>(gradeFromRating(review.rating));
  const [mistakes, setMistakes] = useState<string[]>(review.mistake.filter((m) => m !== NO_MISTAKE));
  const [emotions, setEmotions] = useState<string[]>(review.psychology);
  const [note, setNote] = useState(review.notes ?? "");
  // One empty field to paste into; "+" adds more.
  const [images, setImages] = useState<string[]>([""]);
  // From the recording (phase O): the stop and target as they stood in the
  // platform at the entry, and what was said before the click.
  const [recStop, setRecStop] = useState(review.stop != null ? String(review.stop) : "");
  const [recTarget, setRecTarget] = useState(review.target != null ? String(review.target) : "");
  const [said, setSaid] = useState(review.thesis ?? "");

  const mistakeItems = (optionsMap.mistake ?? []).filter((o) => o.value !== NO_MISTAKE);
  const emotionItems = optionsMap.emotion ?? [];
  const exitReasons = (optionsMap.exit_reason ?? []).map((o) => o.value);
  const hasNoMistake = (optionsMap.mistake ?? []).some((o) => o.value === NO_MISTAKE);
  const toggle = (set: (f: (p: string[]) => string[]) => void) => (v: string) =>
    set((p) => (p.includes(v) ? p.filter((x) => x !== v) : [...p, v]));

  // A clean trade records NO_MISTAKE ("Bez greške") — so a clean week is counted, not just empty.
  const mistakesToSave = grade === "A" ? (hasNoMistake ? [NO_MISTAKE] : []) : mistakes;
  const emotionsToSave = grade === "A" ? [] : emotions;

  const warnings = [
    !playbookId && "No setup — this trade will not count toward any setup's numbers.",
    !grade && "No grade — was it by plan?",
    num(recStop) == null && "No stop — the trade gets no R, and R is what the review measures.",
  ].filter((w): w is string => Boolean(w));

  function submit() {
    start(async () => {
      const res = await saveTradeReview(review.id, {
        playbook_id: playbookId,
        execution_rating: grade ? GRADE_RATING[grade] : null,
        mistake: mistakesToSave,
        psychology_tags: emotionsToSave,
        trade_journal_notes: note,
        stop_price: num(recStop),
        target_price: num(recTarget),
        thesis: said.trim() || null,
        exit_reason: autoExitReason({
          direction: review.direction,
          entry: review.avgEntry,
          exit: review.avgExit,
          stop: num(recStop),
          target: num(recTarget),
          tickSize: review.tickSize,
          options: exitReasons,
        }),
        images: imageDraftsToPayload(images),
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`${review.label} reviewed`);
      router.push("/daily");
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{review.label}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span>{review.direction ?? "—"}</span>
          <span>{review.qty ?? "—"} contracts</span>
          <span>
            {review.avgEntry ?? "—"} → {review.avgExit ?? "—"}
          </span>
          <span>stop {review.stop ?? "—"}</span>
          {review.finalStop != null && <span>poslednji stop u platformi {review.finalStop}</span>}
          {review.netPl != null && (
            <span className={cn("font-medium", review.netPl >= 0 ? "text-[var(--profit)]" : "text-[var(--loss)]")}>
              {fmtMoney(review.netPl, review.currency, { sign: true })}
            </span>
          )}
          {review.realizedR != null && <span>{review.realizedR.toFixed(2)} R</span>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sa snimka</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {review.stopNote && (
            <p role="alert" className="flex items-start gap-1.5 text-sm text-[var(--loss)]">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {review.stopNote}
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <label className="space-y-1 text-sm">
              <span className="text-xs text-muted-foreground">Originalni stop (na ulazu)</span>
              <Input inputMode="decimal" value={recStop} onChange={(e) => setRecStop(e.target.value)} className="w-36" />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-xs text-muted-foreground">Cilj</span>
              <Input inputMode="decimal" value={recTarget} onChange={(e) => setRecTarget(e.target.value)} className="w-36" />
            </label>
          </div>
          <label className="block space-y-1 text-sm">
            <span className="text-xs text-muted-foreground">Šta sam rekao pre klika (prazno = ništa nisam rekao)</span>
            <Textarea value={said} onChange={(e) => setSaid(e.target.value)} rows={2} />
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Review — what only you know</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Setup</Label>
            {playbooks.length ? (
              <Chips
                items={playbooks.filter((p) => p.is_active || p.id === playbookId).map((p) => ({ value: p.id, label: p.name }))}
                selected={playbookId ? [playbookId] : []}
                onToggle={(v) => setPlaybookId((p) => (p === v ? null : v))}
              />
            ) : (
              <p className="text-xs text-muted-foreground">
                No playbooks yet — <Link href="/playbooks" className="underline">add your setups</Link>.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">By plan?</Label>
            <div className="grid grid-cols-3 gap-2">
              {GRADES.map((g) => (
                <button
                  key={g}
                  type="button"
                  aria-pressed={grade === g}
                  onClick={() => setGrade((p) => (p === g ? null : g))}
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

          {grade && grade !== "A" && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">What went wrong</Label>
                <Chips items={mistakeItems} selected={mistakes} onToggle={toggle(setMistakes)} tone="loss" />
              </div>
              {emotionItems.length > 0 && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Behind it (optional)</Label>
                  <Chips items={emotionItems} selected={emotions} onToggle={toggle(setEmotions)} tone="loss" />
                </div>
              )}
            </div>
          )}

          <div className="space-y-1">
            <Label htmlFor="ql-note" className="text-xs">
              One sentence (optional)
            </Label>
            <Textarea id="ql-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>

          <div className="space-y-1">
            <Label htmlFor="ql-chart-0" className="text-xs">
              Charts — entry, exit, as many as you like: a screenshot, or a TradingView snapshot link (optional, Alt+S on the chart)
            </Label>
            {review.images.length > 0 && (
              <div className="grid gap-2 pb-1 sm:grid-cols-3">
                {review.images.map((ref, i) => (
                  <ChartThumb key={`${ref}-${i}`} imageRef={ref} label={`Chart ${i + 1}`} />
                ))}
              </div>
            )}
            <ChartImageListInput value={images} onChange={setImages} idPrefix="ql-chart" />
          </div>
        </CardContent>
      </Card>

      {warnings.length > 0 && (
        <div className="space-y-1 text-xs">
          {warnings.map((w) => (
            <p key={w} className="flex items-center gap-1.5 text-muted-foreground">
              <AlertTriangle className="size-3.5 shrink-0" /> {w}
            </p>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={submit} disabled={pending}>
          Save review
        </Button>
        <Link href={`/trades/${review.id}/edit`} className="text-xs text-muted-foreground underline">
          Open the full form
        </Link>
      </div>
    </div>
  );
}
