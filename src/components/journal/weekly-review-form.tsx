"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Lock, Save } from "lucide-react";
import { format } from "date-fns";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { fmtMoney } from "@/lib/journal/format";
import {
  addWeeksToWeekStart,
  emptyWeeklyReview,
  formatWeekRange,
  isWeekComplete,
  type WeeklyReview,
} from "@/lib/journal/weekly-review";
import type { WeekRecap } from "@/lib/journal/week-recap";
import type { PeriodRow } from "@/lib/journal/period-stats";
import { DATE_TIME } from "@/lib/journal/time";
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
  };
}

export function WeeklyReviewForm({
  review,
  weekStart,
  currentWeekStart,
  recap,
  days,
  currency,
}: {
  review: WeeklyReview | null;
  weekStart: string;
  /** The week containing today — the one that cannot be reviewed or sealed yet. */
  currentWeekStart: string;
  recap: WeekRecap;
  /** Exactly seven, Monday-first; `null` where the day saw no trade. */
  days: readonly (PeriodRow | null)[];
  currency: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [form, setForm] = useState<FormState>(() =>
    toFormState(review, weekStart),
  );
  const [lastSaved, setLastSaved] = useState(review?.updated_at ?? null);

  const complete = useMemo(
    () =>
      isWeekComplete({
        week_grade: form.week_grade,
        one_pattern: form.one_pattern,
        one_change: form.one_change,
      }),
    [form.week_grade, form.one_pattern, form.one_change],
  );

  const locked = review?.locked_at != null;
  const isRunningWeek = weekStart === currentWeekStart;
  const lockedAt = review?.locked_at
    ? format(new Date(review.locked_at), DATE_TIME)
    : null;

  function patch<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  /** Split out so locking can persist first — same contract as the daily form. */
  async function persist(): Promise<boolean> {
    const res = await saveWeeklyReview(weekStart, form);
    if (!res.ok) {
      toast.error(res.error);
      return false;
    }
    setLastSaved(res.updated_at);
    return true;
  }

  function save() {
    start(async () => {
      if (!(await persist())) return;
      toast.success("Nedeljni osvrt sačuvan");
      router.refresh();
    });
  }

  return (
    <div className="space-y-6 pb-24">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="size-8" asChild>
            <Link href={`/weekly?week=${addWeeksToWeekStart(weekStart, -1)}`}>
              <ChevronLeft className="size-4" />
            </Link>
          </Button>
          <div className="min-w-[11rem] text-center">
            <p className="text-lg font-semibold">{formatWeekRange(weekStart)}</p>
            {isRunningWeek && (
              <p className="text-xs text-muted-foreground">još u toku</p>
            )}
          </div>
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            asChild
            disabled={weekStart >= currentWeekStart}
          >
            <Link
              href={
                weekStart >= currentWeekStart
                  ? `/weekly?week=${weekStart}`
                  : `/weekly?week=${addWeeksToWeekStart(weekStart, 1)}`
              }
              aria-disabled={weekStart >= currentWeekStart}
            >
              <ChevronRight className="size-4" />
            </Link>
          </Button>
        </div>
        <Badge variant={complete ? "default" : "secondary"}>
          {complete ? "Završeno" : "Nacrt"}
        </Badge>
      </div>

      <WeekRecapCard recap={recap} days={days} currency={currency} />

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
              : lastSaved
                ? `Poslednje čuvanje ${format(new Date(lastSaved), "HH:mm")}`
                : "Još nije sačuvano"}
          </p>
          {!locked && (
            <div className="flex items-center gap-2">
              {!isRunningWeek && (
                <LockWeekButton
                  weekStart={weekStart}
                  disabled={pending}
                  persist={persist}
                />
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
}: {
  recap: WeekRecap;
  days: readonly (PeriodRow | null)[];
  currency: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Šta se desilo</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Zatvoreno" value={String(recap.closed)} />
          <Stat
            label="Net"
            value={fmtMoney(recap.net, currency)}
            tone={recap.net > 0 ? "up" : recap.net < 0 ? "down" : undefined}
          />
          <Stat label="Dobitni / gubitni" value={`${recap.wins} / ${recap.losses}`} />
          <Stat label="Zabeleženo dana" value={`${recap.journalledDays} / 7`} />
          <Stat label="Proverenih pozicija" value={String(recap.checkedPositions)} />
          <Stat label="Dirano" value={String(recap.interferedPositions)} />
          <Stat label="Teza oslabila" value={String(recap.thesisSlippedPositions)} />
          <Stat label="Držano preko vikenda" value={String(recap.weekendHolds)} />

          {/* Measurements, not verdicts — see the note on `WeekRecap`. Every one
              reads "—" rather than a zero when the week gave it nothing to
              divide by, because a week with no closed trade has no win rate. */}
          <Stat label="Win rate" value={fmtPct(recap.winRate)} />
          <Stat label="Profit factor" value={fmtFactor(recap.profitFactor)} />
          <Stat label="Avg R" value={fmtR(recap.avgR)} />
          <Stat
            label="Expectancy"
            value={fmtR(recap.expectancy)}
            tone={
              recap.expectancy == null
                ? undefined
                : recap.expectancy > 0
                  ? "up"
                  : recap.expectancy < 0
                    ? "down"
                    : undefined
            }
          />
        </dl>

        <WeekDayStrip days={days} currency={currency} />
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
 * a flat result was traded for.
 */
function WeekDayStrip({
  days,
  currency,
}: {
  days: readonly (PeriodRow | null)[];
  currency: string;
}) {
  return (
    <div className="mt-6 grid grid-cols-7 gap-1.5">
      {days.map((row, i) => (
        <div
          key={DAY_LABELS[i]}
          className={cn(
            "rounded-md border px-1.5 py-2 text-center",
            row == null && "opacity-50",
            row != null && row.net > 0 && "border-emerald-600/40 bg-emerald-600/5",
            row != null && row.net < 0 && "border-red-600/40 bg-red-600/5",
          )}
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
        </div>
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
}: {
  label: string;
  value: string;
  tone?: "up" | "down";
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
  const router = useRouter();
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
      toast.success("Nedelja zaključana.");
      router.refresh();
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
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      <Textarea
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        rows={3}
      />
    </div>
  );
}
