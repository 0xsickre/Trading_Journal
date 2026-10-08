"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DateField } from "@/components/ui/date-field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { createTrade, saveTradeReview } from "@/app/(app)/trades/actions";
import { fmtMoney } from "@/lib/journal/format";
import {
  autoExitReason,
  GRADE_RATING,
  GRADES,
  gradeFromRating,
  isOpenLog,
  minutesAgo,
  NO_MISTAKE,
  QUICK_ENTRY_AGO_MIN,
  quickLogProblem,
  quickLogToTradeInput,
  quickLogWarnings,
  type Grade,
  type QuickLogInput,
} from "@/lib/journal/quick-log";
import { getTradeFormPrefs, setTradeFormPrefs } from "@/lib/journal/trade-form-prefs";
import { utcToZonedInput, zonedInputToUtc } from "@/lib/journal/time";
import type { Account, Instrument, OptionsMap } from "@/lib/journal/types";
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
  /** The entry chart already on the trade. */
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
 * Log a trade AFTER it closed (`/trades/log`), or review one the export brought
 * in (`/trades/[id]/review`). Four numbers, then only the answers the mentor
 * pack reads: setup, A/B/C, what went wrong, one sentence, the exit chart.
 * Everything else lives in the full form and stays optional.
 */
export function QuickLogForm({
  accounts,
  instruments,
  playbooks,
  optionsMap,
  review,
  topstepFailedAccountIds = [],
}: {
  accounts: Account[];
  instruments: Instrument[];
  playbooks: Playbook[];
  optionsMap: OptionsMap;
  review?: ReviewTrade;
  /**
   * Topstep accounts past their MLL. A warning, never a block: a trade that
   * already closed is the record, and refusing it would refuse the very trade
   * that took the account through its limit. Only a new plan is refused
   * (`createTrade`).
   */
  topstepFailedAccountIds?: string[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const open = accounts.filter((a) => a.archived_at == null);

  const [accountId, setAccountId] = useState<string | null>(
    open.find((a) => a.topstep_mode)?.id ?? open[0]?.id ?? null,
  );
  const account = open.find((a) => a.id === accountId) ?? null;
  const blownWarning =
    accountId == null || review
      ? null
      : topstepFailedAccountIds.includes(accountId)
        ? "This Topstep account hit its Maximum Loss Limit. The trade is logged as a record — no new plan until the account is reset in Settings."
        : null;
  const tz = account?.timezone ?? "UTC";
  const [symbol, setSymbol] = useState<string>(instruments[0]?.symbol ?? "");
  const instrument = instruments.find((i) => i.symbol === symbol) ?? null;

  const nowLocal = () => utcToZonedInput(new Date().toISOString(), tz);
  const [direction, setDirection] = useState<"Long" | "Short">("Long");
  const [contracts, setContracts] = useState("1");
  const [entry, setEntry] = useState("");
  const [stop, setStop] = useState("");
  const [target, setTarget] = useState("");
  const [exit, setExit] = useState("");
  const [day, setDay] = useState("");
  const [entryTime, setEntryTime] = useState("");
  const [exitTime, setExitTime] = useState("");

  // The browser's own clock and storage, after mount: the server renders with
  // neither, and a time or a remembered symbol in the first render would not
  // match what it sent.
  useEffect(() => {
    const prefs = getTradeFormPrefs();
    /* eslint-disable react-hooks/set-state-in-effect -- external-store init */
    if (prefs.accountId && open.some((a) => a.id === prefs.accountId)) setAccountId(prefs.accountId);
    if (prefs.instrument && instruments.some((i) => i.symbol === prefs.instrument)) setSymbol(prefs.instrument);
    const now = utcToZonedInput(new Date().toISOString(), tz);
    setDay(now.slice(0, 10));
    setEntryTime(utcToZonedInput(minutesAgo(5), tz).slice(11, 16));
    setExitTime(now.slice(11, 16));
    /* eslint-enable react-hooks/set-state-in-effect */
    // Once, on mount — later account changes keep the times the trader typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [playbookId, setPlaybookId] = useState<string | null>(review?.playbookId ?? null);
  const [grade, setGrade] = useState<Grade | null>(gradeFromRating(review?.rating));
  const [mistakes, setMistakes] = useState<string[]>((review?.mistake ?? []).filter((m) => m !== NO_MISTAKE));
  const [emotions, setEmotions] = useState<string[]>(review?.psychology ?? []);
  const [note, setNote] = useState(review?.notes ?? "");
  // From the recording (phase O): the stop and target as they stood in the
  // platform at the entry, and what was said before the click.
  const [recStop, setRecStop] = useState(review?.stop != null ? String(review.stop) : "");
  const [recTarget, setRecTarget] = useState(review?.target != null ? String(review.target) : "");
  const [said, setSaid] = useState(review?.thesis ?? "");
  // One empty field to paste into; "+" adds more.
  const [images, setImages] = useState<string[]>([""]);

  const mistakeItems = (optionsMap.mistake ?? []).filter((o) => o.value !== NO_MISTAKE);
  const emotionItems = optionsMap.emotion ?? [];
  const exitReasons = (optionsMap.exit_reason ?? []).map((o) => o.value);
  const hasNoMistake = (optionsMap.mistake ?? []).some((o) => o.value === NO_MISTAKE);
  const toggle = (set: (f: (p: string[]) => string[]) => void) => (v: string) =>
    set((p) => (p.includes(v) ? p.filter((x) => x !== v) : [...p, v]));

  // A clean trade records NO_MISTAKE ("Bez greške") — so a clean week is counted, not just empty.
  const mistakesToSave = grade === "A" ? (hasNoMistake ? [NO_MISTAKE] : []) : mistakes;
  const emotionsToSave = grade === "A" ? [] : emotions;

  const input: QuickLogInput = {
    accountId,
    instrument,
    direction,
    contracts: num(contracts),
    entry: num(entry),
    stop: num(stop),
    target: num(target),
    exit: num(exit),
    enteredAt: zonedInputToUtc(`${day}T${entryTime}`, tz),
    exitedAt: zonedInputToUtc(`${day}T${exitTime}`, tz),
    playbookId,
    grade,
    mistakes: mistakesToSave,
    emotions: emotionsToSave,
    note,
    images,
  };
  const problem = review ? null : quickLogProblem(input);
  const warnings = review
    ? [!playbookId && "No setup — this trade will not count toward any setup's numbers.", !grade && "No grade — was it by plan?"].filter(
        (w): w is string => Boolean(w),
      )
    : quickLogWarnings(input);

  // What the entered numbers mean, before saving: points, ticks, money, R.
  const preview = (() => {
    if (review || !instrument || input.entry == null || input.exit == null || !input.contracts) return null;
    const dir = direction === "Long" ? 1 : -1;
    const pts = (input.exit - input.entry) * dir;
    const money = pts * instrument.point_value * input.contracts;
    const risk = input.stop != null ? Math.abs(input.entry - input.stop) : null;
    return { pts, money, r: risk ? pts / risk : null };
  })();

  function resetAfterSave() {
    setEntry("");
    setStop("");
    setTarget("");
    setExit("");
    setPlaybookId(null);
    setGrade(null);
    setMistakes([]);
    setEmotions([]);
    setNote("");
    setImages([""]);
    setEntryTime(utcToZonedInput(minutesAgo(5), tz).slice(11, 16));
    setExitTime(nowLocal().slice(11, 16));
  }

  function submit() {
    if (problem) {
      toast.error(problem);
      return;
    }
    start(async () => {
      if (review) {
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
        return;
      }
      const res = await createTrade(quickLogToTradeInput(input, exitReasons));
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setTradeFormPrefs({ accountId: accountId ?? undefined, instrument: symbol });
      toast.success(
        isOpenLog(input)
          ? "Trade logged as open — the day's TopstepX import adds the exit and closes it."
          : "Trade logged — the day's TopstepX export will correct the numbers.",
      );
      resetAfterSave();
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {blownWarning && (
        <p
          role="alert"
          className="flex items-start gap-1.5 rounded-md border border-[var(--loss)]/40 bg-[var(--loss)]/10 p-3 text-sm text-[var(--loss)]"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {blownWarning}
        </p>
      )}
      {review ? (
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
      ) : null}
      {review ? (
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
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">The trade — off the platform, rough is fine</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {open.length > 1 && (
              <Chips
                items={open.map((a) => ({ value: a.id, label: a.name }))}
                selected={accountId ? [accountId] : []}
                onToggle={setAccountId}
              />
            )}
            <div className="flex flex-wrap items-center gap-3">
              <Chips
                items={instruments.map((i) => ({ value: i.symbol, label: i.symbol }))}
                selected={[symbol]}
                onToggle={setSymbol}
              />
              <div className="flex overflow-hidden rounded-md border" role="group" aria-label="Direction">
                {(["Long", "Short"] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={direction === d}
                    onClick={() => setDirection(d)}
                    className={cn(
                      "px-3 py-1 text-sm",
                      direction === d
                        ? d === "Long"
                          ? "bg-[var(--profit)]/20 font-medium"
                          : "bg-[var(--loss)]/20 font-medium"
                        : "text-muted-foreground",
                    )}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {(
                [
                  ["ql-contracts", "Contracts", contracts, setContracts],
                  ["ql-entry", "Entry", entry, setEntry],
                  ["ql-stop", "Stop", stop, setStop],
                  ["ql-target", "Target (optional)", target, setTarget],
                  ["ql-exit", "Exit (empty = still open)", exit, setExit],
                ] as const
              ).map(([id, label, value, set]) => (
                <div key={id} className="space-y-1">
                  <Label htmlFor={id} className="text-xs">
                    {label}
                  </Label>
                  <Input id={id} inputMode="decimal" value={value} onChange={(e) => set(e.target.value)} />
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label htmlFor="ql-day" className="text-xs">
                  Day
                </Label>
                <DateField id="ql-day" value={day} onChange={setDay} className="w-40" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ql-in" className="text-xs">
                  Entered at
                </Label>
                <Input id="ql-in" type="time" value={entryTime} onChange={(e) => setEntryTime(e.target.value)} className="w-28" />
              </div>
              <div className="flex gap-1 pb-1">
                {QUICK_ENTRY_AGO_MIN.map((m) => (
                  <Button
                    key={m}
                    type="button"
                    size="xs"
                    variant="outline"
                    onClick={() => {
                      setDay(nowLocal().slice(0, 10));
                      setEntryTime(utcToZonedInput(minutesAgo(m), tz).slice(11, 16));
                    }}
                  >
                    {m} min ago
                  </Button>
                ))}
              </div>
              {!isOpenLog(input) && (
                <div className="space-y-1">
                  <Label htmlFor="ql-out" className="text-xs">
                    Exited at
                  </Label>
                  <Input id="ql-out" type="time" value={exitTime} onChange={(e) => setExitTime(e.target.value)} className="w-28" />
                </div>
              )}
            </div>
            {isOpenLog(input) && (
              <p className="text-xs text-muted-foreground">
                No exit: the trade is saved open, and the day&apos;s TopstepX import adds the exit and closes it.
              </p>
            )}
            {preview && (
              <p className="text-xs text-muted-foreground">
                {preview.pts >= 0 ? "+" : ""}
                {preview.pts.toFixed(2)} pts ·{" "}
                <span className={preview.money >= 0 ? "text-[var(--profit)]" : "text-[var(--loss)]"}>
                  {fmtMoney(preview.money, account?.currency ?? "USD", { sign: true })}
                </span>{" "}
                before commission{preview.r != null ? ` · ${preview.r.toFixed(2)} R` : ""}
              </p>
            )}
          </CardContent>
        </Card>
      )}

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
            {review && review.images.length > 0 && (
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

      {(problem || warnings.length > 0) && (
        <div className="space-y-1 text-xs">
          {problem && <p className="text-[var(--loss)]">{problem}</p>}
          {warnings.map((w) => (
            <p key={w} className="flex items-center gap-1.5 text-muted-foreground">
              <AlertTriangle className="size-3.5 shrink-0" /> {w}
            </p>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={submit} disabled={pending || problem != null}>
          {review ? "Save review" : "Log trade"}
        </Button>
        <Link
          href={review ? `/trades/${review.id}/edit` : "/trades/new"}
          className="text-xs text-muted-foreground underline"
        >
          {review ? "Open the full form" : "Plan a trade before entry instead"}
        </Link>
      </div>
    </div>
  );
}
