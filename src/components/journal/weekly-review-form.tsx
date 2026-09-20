"use client";

import { useEffect, useId, useMemo, useState, useTransition, type MouseEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Lock, Save } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StarRating } from "@/components/journal/star-rating";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { fmtMoney } from "@/lib/journal/format";
import {
  addWeeksToWeekStart,
  emptyWeeklyReview,
  formatWeekRange,
  isWeekComplete,
  type PreviousChangeKept,
  type WeeklyReview,
} from "@/lib/journal/weekly-review";
import {
  clearWeeklyDraft,
  draftDiffers,
  readWeeklyDraft,
  writeWeeklyDraft,
  type WeeklyDraftFields,
} from "@/lib/journal/weekly-draft";
import type { WeekRecap } from "@/lib/journal/week-recap";
import type { PeriodRow } from "@/lib/journal/period-stats";
import { DATE, DATE_TIME, DEFAULT_TZ, fmtInTz } from "@/lib/journal/time";
import {
  lockWeek,
  saveWeeklyReview,
  type SaveWeeklyReviewInput,
} from "@/app/(app)/weekly/actions";

type FormState = SaveWeeklyReviewInput;

function toFormState(review: WeeklyReview | null, weekStart: string): FormState {
  if (!review) {
    const { week_start: _, ...rest } = emptyWeeklyReview(weekStart);
    return rest;
  }
  return {
    week_grade: review.week_grade,
    went_well: review.went_well,
    went_badly: review.went_badly,
    one_pattern: review.one_pattern,
    one_change: review.one_change,
    next_week_catalysts: review.next_week_catalysts,
    previous_change_kept: review.previous_change_kept ?? null,
  };
}

/** The shape the local draft is stored in — text, never null, so it round-trips. */
function toDraft(form: FormState): WeeklyDraftFields {
  return {
    week_grade: form.week_grade ?? null,
    went_well: form.went_well ?? "",
    went_badly: form.went_badly ?? "",
    one_pattern: form.one_pattern ?? "",
    one_change: form.one_change ?? "",
    next_week_catalysts: form.next_week_catalysts ?? "",
  };
}

export function WeeklyReviewForm({
  review,
  previousReview,
  weekStart,
  currentWeekStart,
  earliestWeekStart,
  clamped = false,
  recap,
  days,
  currency,
  timezone = DEFAULT_TZ,
  accountId = "all",
  accountOptions = [],
  mixedFallback = false,
}: {
  review: WeeklyReview | null;
  /** The week before this one, for the commitment it left behind. */
  previousReview?: WeeklyReview | null;
  weekStart: string;
  /** The week containing today — the one that cannot be reviewed or sealed yet. */
  currentWeekStart: string;
  /** The oldest week worth opening; the back arrow stops here. */
  earliestWeekStart?: string;
  /** True when the URL asked for a week that has not happened. */
  clamped?: boolean;
  recap: WeekRecap;
  /** Exactly seven, Monday-first; `null` where the day saw no trade. */
  days: readonly (PeriodRow | null)[];
  currency: string;
  /** The account's zone — every timestamp on this page is read on that clock. */
  timezone?: string;
  accountId?: string;
  accountOptions?: { value: string; label: string }[];
  /** True when "all accounts" was refused because the currencies differ. */
  mixedFallback?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [form, setForm] = useState<FormState>(() => toFormState(review, weekStart));
  const [lastSaved, setLastSaved] = useState(review?.updated_at ?? null);
  /**
   * Typed and not yet saved. The week arrows navigate, which remounts this form
   * — everything unsaved used to be dropped without a word.
   */
  const [dirty, setDirty] = useState(false);
  const [draftAt, setDraftAt] = useState<string | null>(null);

  const locked = review?.locked_at != null;
  const isRunningWeek = weekStart === currentWeekStart;
  const lockedAt = review?.locked_at ? fmtInTz(review.locked_at, timezone, DATE_TIME) : null;
  const saved = useMemo(() => toDraft(toFormState(review, weekStart)), [review, weekStart]);

  /**
   * The badge reads the STORED review, not what is on screen.
   *
   * Typing the last answer used to flip it to "Završeno" while the database
   * still held nothing — a status that described the keyboard rather than the
   * journal. The live state belongs in the save bar, and that is where it is.
   */
  const complete = useMemo(
    () =>
      isWeekComplete({
        week_grade: review?.week_grade ?? null,
        one_pattern: review?.one_pattern ?? null,
        one_change: review?.one_change ?? null,
      }),
    [review],
  );

  // Mount-only: a draft is offered, never applied. Applying it during render
  // would both break hydration and overwrite a review saved from another device
  // with whatever this browser happened to keep.
  useEffect(() => {
    if (locked) return;
    const draft = readWeeklyDraft(weekStart);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- external-store init
    if (draft && draftDiffers(saved, draft.fields)) setDraftAt(draft.savedAt);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only, by design
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  /** Stops a week change that would throw away unsaved text, unless confirmed. */
  function guardLeave(e: MouseEvent) {
    if (dirty && !window.confirm("Imaš nesačuvane izmene. Napusti ovu nedelju bez čuvanja?"))
      e.preventDefault();
  }

  function patch<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      setDirty(true);
      writeWeeklyDraft(weekStart, toDraft(next));
      return next;
    });
  }

  function restoreDraft() {
    const draft = readWeeklyDraft(weekStart);
    if (!draft) return;
    setForm((prev) => ({
      ...prev,
      week_grade: draft.fields.week_grade,
      went_well: draft.fields.went_well || null,
      went_badly: draft.fields.went_badly || null,
      one_pattern: draft.fields.one_pattern || null,
      one_change: draft.fields.one_change || null,
      next_week_catalysts: draft.fields.next_week_catalysts || null,
    }));
    setDirty(true);
    setDraftAt(null);
  }

  function discardDraft() {
    clearWeeklyDraft(weekStart);
    setDraftAt(null);
  }

  /** Split out so locking can persist first — same contract as the daily form. */
  async function persist(): Promise<boolean> {
    const res = await saveWeeklyReview(weekStart, form);
    if (!res.ok) {
      toast.error(res.error);
      return false;
    }
    setLastSaved(res.updated_at);
    setDirty(false);
    clearWeeklyDraft(weekStart);
    setDraftAt(null);
    return true;
  }

  function save() {
    start(async () => {
      // No router.refresh(): the action revalidates /weekly itself.
      if (await persist()) toast.success("Nedeljni osvrt sačuvan");
    });
  }

  const canGoBack = earliestWeekStart == null || weekStart > earliestWeekStart;
  const canGoForward = weekStart < currentWeekStart;

  return (
    <div className="space-y-6 pb-24">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {canGoBack ? (
            <Button variant="outline" size="icon" className="size-8" asChild>
              <Link
                href={`/weekly?week=${addWeeksToWeekStart(weekStart, -1)}`}
                aria-label="Prethodna nedelja"
                onClick={guardLeave}
              >
                <ChevronLeft className="size-4" />
              </Link>
            </Button>
          ) : (
            // A real disabled button, not a link wearing the attribute: on an
            // <a> `disabled` is invalid and does nothing, so the arrow looked
            // and behaved enabled.
            <Button variant="outline" size="icon" className="size-8" disabled aria-label="Prethodna nedelja">
              <ChevronLeft className="size-4" />
            </Button>
          )}
          <p className="min-w-[13rem] text-center text-lg font-semibold">
            {formatWeekRange(weekStart)}
          </p>
          {canGoForward ? (
            <Button variant="outline" size="icon" className="size-8" asChild>
              <Link
                href={`/weekly?week=${addWeeksToWeekStart(weekStart, 1)}`}
                aria-label="Sledeća nedelja"
                onClick={guardLeave}
              >
                <ChevronRight className="size-4" />
              </Link>
            </Button>
          ) : (
            <Button variant="outline" size="icon" className="size-8" disabled aria-label="Sledeća nedelja">
              <ChevronRight className="size-4" />
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {accountOptions.length > 0 && (
            <Select
              value={accountId}
              onValueChange={(v) => {
                if (dirty && !window.confirm("Imaš nesačuvane izmene. Promeniti nalog bez čuvanja?"))
                  return;
                router.push(`/weekly?week=${weekStart}${v === "all" ? "" : `&account=${v}`}`);
              }}
            >
              <SelectTrigger className="h-8 w-44" aria-label="Nalog">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Svi nalozi</SelectItem>
                {accountOptions.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Badge variant={complete ? "default" : "secondary"}>
            {complete ? "Završeno" : "Nacrt"}
          </Badge>
        </div>
      </div>

      {clamped && (
        <p className="text-xs text-muted-foreground">
          Tražena nedelja još nije počela — prikazana je tekuća.
        </p>
      )}
      {mixedFallback && (
        <p className="text-xs text-muted-foreground">
          Nalozi su u različitim valutama, pa se ne mogu sabrati — prikazan je podrazumevani nalog.
        </p>
      )}

      {draftAt && (
        <Alert>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>
              Imaš nesačuvan nacrt za ovu nedelju od {fmtInTz(draftAt, timezone, DATE_TIME)}.
            </span>
            <span className="flex gap-2">
              <Button size="sm" variant="outline" onClick={restoreDraft}>
                Vrati nacrt
              </Button>
              <Button size="sm" variant="ghost" onClick={discardDraft}>
                Odbaci
              </Button>
            </span>
          </AlertDescription>
        </Alert>
      )}

      <WeekRecapCard recap={recap} days={days} currency={currency} timezone={timezone} />

      {previousReview?.one_change && (
        <PreviousWeekCard
          previous={previousReview}
          disabled={locked}
          kept={form.previous_change_kept ?? null}
          canAnswer={review == null || review.previous_change_kept !== undefined}
          onKept={(v) => patch("previous_change_kept", v)}
        />
      )}

      {isRunningWeek && (
        <Alert>
          <AlertDescription>
            Ova nedelja nije završena. Možeš pisati beleške sada, ali brojke
            iznad će se i dalje menjati i osvrt se ne može zapečatiti dok se
            nedelja ne završi.
          </AlertDescription>
        </Alert>
      )}

      {/* One `disabled` on the wrapper rather than threading it through every
          control — the same mechanism the daily form uses, and the database
          trigger refuses the write regardless. Links stay clickable: a sealed
          week is still readable. */}
      <fieldset
        disabled={locked}
        className="m-0 min-w-0 space-y-6 border-0 p-0 disabled:opacity-100"
      >
        {locked && (
          <Alert>
            <AlertDescription>
              {/* `{" "}` and not a plain space before `and`: the space that was
                  written there was swallowed on the way to the DOM, and the
                  banner read "…22:00)and no longer changes". Explicit is the
                  only spelling that survives both the JSX whitespace rules and
                  a reformat. */}
              Ova nedelja je zaključana {lockedAt && `(${lockedAt})`}{" "}
              i više se ne menja. Trejdovi ostaju izmenjivi — ispravka P&amp;L-a
              je i dalje ispravka činjenice, ali ne pomera ono što si ovde
              zaključio.
            </AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ocena nedelje</CardTitle>
            <p className="text-sm text-muted-foreground">
              Ocenjuj PROCES, ne P&amp;L. Nedelja u kojoj si se strogo držao
              plana, a ipak izgubio novac, zaslužuje pet zvezdica.
            </p>
          </CardHeader>
          <CardContent>
            {/* Stars instead of A–F: the same unit execution, conviction and
                mental state are already rated in. `StarRating` carries its own
                "Clear" too, so the separate button that used to stand here is
                no longer needed. */}
            <StarRating
              label="Ocena nedelje"
              value={form.week_grade}
              onChange={(next) => patch("week_grade", next)}
              texts={{ clear: "Obriši", valueLabel: (n) => `${n} od 5`, clearHint: "Klikni ponovo da obrišeš" }}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Nedelja, u pet odgovora</CardTitle>
            <p className="text-sm text-muted-foreground">
              Ovo se nekad pitalo svako veče, usred držanja pozicije. Jednom
              nedeljno iza njih stoji ishod.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field
              label="Šta je išlo dobro"
              value={form.went_well}
              onChange={(v) => patch("went_well", v)}
              hint="Proces, disciplina, odluka koju bi ponovo doneo — ne veličina dobitka."
            />
            <Field
              label="Šta je išlo loše"
              value={form.went_badly}
              onChange={(v) => patch("went_badly", v)}
              hint="Uključujući pravila koja si prekršio. Gubitnički trejd odrađen ispravno ne spada ovde."
            />
            <Field
              label="Jedan obrazac koji vidim"
              value={form.one_pattern}
              onChange={(v) => patch("one_pattern", v)}
              hint="Jedan. Osvrt koji nabraja šest obrazaca ne donosi nikakvu promenu."
            />
            <Field
              label="Jedna stvar koju menjam sledeće nedelje"
              value={form.one_change}
              onChange={(v) => patch("one_change", v)}
              hint="Dovoljno konkretno da postane tracker pravilo. Ako se ne može čekirati, to je želja."
            />
            <Field
              label="Šta je na kalendaru sledeće nedelje"
              value={form.next_week_catalysts}
              onChange={(v) => patch("next_week_catalysts", v)}
              hint="Objave, earnings, praznici — prozor držanja je izložen svemu tome."
            />
          </CardContent>
        </Card>
      </fieldset>

      <div
        className={cn(
          "fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 p-4 backdrop-blur",
          "md:left-(--sidebar-offset)",
        )}
      >
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {locked
              ? "Nedelja je zaključana"
              : dirty
                ? "Nesačuvane izmene"
                : lastSaved
                  ? `Poslednje čuvanje ${fmtInTz(lastSaved, timezone, "HH:mm")}`
                  : "Još nije sačuvano"}
          </p>
          {!locked && (
            <div className="flex items-center gap-2">
              {!isRunningWeek && (
                <LockWeekButton weekStart={weekStart} disabled={pending} persist={persist} />
              )}
              <Button onClick={save} disabled={pending}>
                <Save className="mr-2 size-4" />
                Sačuvaj osvrt
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const KEPT_LABELS: Record<PreviousChangeKept, string> = {
  yes: "Da",
  partly: "Delimično",
  no: "Ne",
};

/**
 * Last week's commitment, at the top of this week.
 *
 * The review asked for "one thing I change next week" and then never mentioned
 * it again: the promise was written once and read by nothing, so breaking it
 * cost nothing. Here it is the first thing on the screen, with the answer
 * stored on THIS week's row — last week's may already be sealed.
 */
function PreviousWeekCard({
  previous,
  kept,
  onKept,
  disabled,
  canAnswer,
}: {
  previous: WeeklyReview;
  kept: PreviousChangeKept | null;
  onKept: (v: PreviousChangeKept) => void;
  disabled: boolean;
  /** False while the database has no column for the answer yet. */
  canAnswer: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Prošle nedelje si rekao</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="rounded-md border-l-2 border-primary/50 bg-muted/40 px-3 py-2">
          {previous.one_change}
        </p>
        {previous.next_week_catalysts && (
          <p className="text-muted-foreground">
            Očekivao si na kalendaru: {previous.next_week_catalysts}
          </p>
        )}
        {canAnswer && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground">Jesi li to ispunio?</span>
            {(Object.keys(KEPT_LABELS) as PreviousChangeKept[]).map((v) => (
              <Button
                key={v}
                size="sm"
                variant={kept === v ? "default" : "outline"}
                disabled={disabled}
                aria-pressed={kept === v}
                onClick={() => onKept(v)}
              >
                {KEPT_LABELS[v]}
              </Button>
            ))}
          </div>
        )}
        <Link
          href={`/weekly?week=${previous.week_start}`}
          className="inline-block text-xs text-muted-foreground underline underline-offset-4"
        >
          Otvori tu nedelju
        </Link>
      </CardContent>
    </Card>
  );
}

/**
 * The facts, before the questions.
 *
 * Deliberately above the form. Asked "what went well" with a blank screen, a
 * trader answers from memory — and memory after five days is a summary of the
 * last one. Nothing here carries a verdict: the grade is the trader's to give,
 * and a panel that pre-empted it would answer the review's first question for
 * them.
 */
function WeekRecapCard({
  recap,
  days,
  currency,
  timezone,
}: {
  recap: WeekRecap;
  days: readonly (PeriodRow | null)[];
  currency: string;
  timezone: string;
}) {
  const nothingHappened =
    recap.closed === 0 && recap.checkedPositions === 0 && recap.journalledDays === 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Šta se desilo</CardTitle>
      </CardHeader>
      <CardContent>
        {nothingHappened ? (
          <p className="text-sm text-muted-foreground">
            Ove nedelje nema nijednog zatvorenog trejda ni zabeleženog dana. Pitanja ispod i
            dalje stoje — nedelja bez trgovanja je i dalje nedelja o kojoj se ima šta reći.
          </p>
        ) : (
          <div className="space-y-5">
            <section>
              <h3 className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Novac
              </h3>
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Stat label="Zatvoreno" value={String(recap.closed)} />
                <Stat
                  label="Net"
                  value={fmtMoney(recap.net, currency)}
                  tone={recap.net > 0 ? "up" : recap.net < 0 ? "down" : undefined}
                />
                <Stat label="Dobitni / gubitni" value={`${recap.wins} / ${recap.losses}`} />
                <Stat label="Win rate" value={fmtPct(recap.winRate)} />
                <Stat label="Profit factor" value={fmtFactor(recap.profitFactor)} />
                <Stat
                  label="Avg R"
                  value={fmtR(recap.avgR)}
                  hint={recap.rSample > 0 ? `${recap.rSample} od ${recap.closed} trejdova nosi R` : undefined}
                />
              </dl>
            </section>
            <section>
              <h3 className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Proces
              </h3>
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Stat
                  label="Zabeleženo dana"
                  value={`${recap.journalledDays} / ${recap.journalledOutOf}`}
                  hint="pon–pet"
                />
                <Stat label="Proverenih pozicija" value={String(recap.checkedPositions)} />
                <Stat label="Dirano" value={String(recap.interferedPositions)} />
                <Stat label="Teza oslabila" value={String(recap.thesisSlippedPositions)} />
                <Stat label="Držano preko vikenda" value={String(recap.weekendHolds)} />
              </dl>
            </section>
          </div>
        )}

        <WeekDayStrip days={days} currency={currency} timezone={timezone} />
      </CardContent>
    </Card>
  );
}

const fmtPct = (v: number | null) => (v == null ? "—" : `${v.toFixed(0)}%`);
const fmtR = (v: number | null) => (v == null ? "—" : `${v.toFixed(2)}R`);

/**
 * Profit factor prints "∞" for a week with winners and no losers.
 *
 * The same three-way the day card already uses: `null` means there was nothing
 * to divide, `Infinity` means the divisor was zero — which is a real and very
 * good week, not missing data, and collapsing the two into one dash would hide
 * a perfect week behind the same glyph as an empty one.
 */
const fmtFactor = (v: number | null) =>
  v == null ? "—" : v === Infinity ? "∞" : v.toFixed(2);

/**
 * The week as seven days, in order.
 *
 * Always seven columns, Monday to Sunday, so the shape of the week is legible
 * at a glance: three traded days in a row followed by four blanks looks like
 * what it was. A day with no trade shows a dash — NOT a zero, which would claim
 * a flat result was traded for. Each tile links to that day's journal, which is
 * where the answer to "what happened on Wednesday" actually lives.
 */
function WeekDayStrip({
  days,
  currency,
  timezone,
}: {
  days: readonly (PeriodRow | null)[];
  currency: string;
  timezone: string;
}) {
  return (
    <div className="mt-6 grid grid-cols-7 gap-1.5">
      {days.map((row, i) => (
        <Link
          key={DAY_LABELS[i]}
          href={row == null ? "/daily" : `/daily?date=${row.key}`}
          className={cn(
            "rounded-md border px-1.5 py-2 text-center transition-colors hover:bg-muted/50",
            row == null && "opacity-50",
            row != null && row.net > 0 && "border-emerald-600/40 bg-emerald-600/5",
            row != null && row.net < 0 && "border-red-600/40 bg-red-600/5",
          )}
          aria-label={
            row == null
              ? `${DAY_LABELS[i]} — bez trejdova`
              : `${DAY_LABELS[i]} ${fmtInTz(`${row.key}T12:00:00Z`, timezone, DATE)}, ${fmtMoney(row.net, currency)}, ${tradeCountLabel(row.trades)}`
          }
        >
          <div className="text-[10px] text-muted-foreground">{DAY_LABELS[i]}</div>
          <div
            className={cn(
              "mt-0.5 truncate text-xs font-medium tabular-nums",
              row != null && row.net > 0 && "text-emerald-600 dark:text-emerald-500",
              row != null && row.net < 0 && "text-red-600 dark:text-red-500",
            )}
          >
            {row == null ? "—" : fmtMoney(row.net, currency)}
          </div>
          <div className="text-[10px] text-muted-foreground">
            {row == null ? "" : tradeCountLabel(row.trades)}
          </div>
        </Link>
      ))}
    </div>
  );
}

/**
 * Serbian has three plural forms for a count: 1 trejd, 2–4 trejda, 0 and 5+
 * trejdova. The `n % 100` guard pulls 11–14 out of the "2–4" branch — it is
 * 11 trejdova, not 11 trejda.
 *
 * The label is Serbian because the weekly review is where the trader writes
 * their own prose; see README § On language.
 */
function tradeCountLabel(n: number): string {
  if (n === 1) return "1 trejd";
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return `${n} trejdova`;
  const mod10 = n % 10;
  return mod10 >= 2 && mod10 <= 4 ? `${n} trejda` : `${n} trejdova`;
}

/** Monday-first, matching `weekDayKeys`. */
const DAY_LABELS = ["pon", "uto", "sre", "čet", "pet", "sub", "ned"] as const;

function Stat({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone?: "up" | "down";
  hint?: string;
}) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "text-lg font-semibold tabular-nums",
          tone === "up" && "text-emerald-600 dark:text-emerald-500",
          tone === "down" && "text-red-600 dark:text-red-500",
        )}
      >
        {value}
      </dd>
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/**
 * Sealing asks first, because it cannot be undone — unlocking is an UPDATE, and
 * the trigger refuses every update of a locked row.
 *
 * Saves before sealing, for the reason the daily form does: locking freezes what
 * is STORED, and text still sitting in the form is not stored. Without this the
 * obvious sequence — write the review, hit lock — would seal an empty week.
 */
function LockWeekButton({
  weekStart,
  disabled,
  persist,
}: {
  weekStart: string;
  disabled: boolean;
  persist: () => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  function confirm() {
    start(async () => {
      if (!(await persist())) return;
      const res = await lockWeek(weekStart);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setOpen(false);
      // No router.refresh(): `lockWeek` revalidates /weekly and /reports.
      toast.success("Nedelja zaključana.");
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={disabled}>
          <Lock className="mr-2 size-4" />
          Zaključaj nedelju
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Zaključati {formatWeekRange(weekStart)}?</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-3 text-sm">
              <p>
                Ovo se <b>ne može poništiti</b>. Osvrt se zamrzava tačno onakav
                kakav je sada.
              </p>
              <p>
                Trejdovi i dnevni unosi <b>ostaju izmenjivi</b>. Pečaćenje
                nedelje pečati ono što si o njoj zaključio, ne zapis iz kog je
                izveden.
              </p>
            </div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            Otkaži
          </Button>
          <Button onClick={confirm} disabled={pending}>
            <Lock className="mr-2 size-4" />
            Zaključaj
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
  hint?: string;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {hint && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      <Textarea
        id={id}
        aria-describedby={hint ? hintId : undefined}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        rows={3}
      />
    </div>
  );
}
