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
  WEEK_GRADES,
  type WeeklyReview,
} from "@/lib/journal/weekly-review";
import type { WeekRecap } from "@/lib/journal/week-recap";
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
  currency,
}: {
  review: WeeklyReview | null;
  weekStart: string;
  /** The week containing today — the one that cannot be reviewed or sealed yet. */
  currentWeekStart: string;
  recap: WeekRecap;
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
    ? format(new Date(review.locked_at), "d MMM yyyy, HH:mm")
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
      toast.success("Weekly review saved");
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
              <p className="text-xs text-muted-foreground">still running</p>
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
          {complete ? "Complete" : "Draft"}
        </Badge>
      </div>

      <WeekRecapCard recap={recap} currency={currency} />

      {isRunningWeek && (
        <Alert>
          <AlertDescription>
            This week is not over. You can write notes now, but the numbers above
            will keep moving and the review cannot be sealed until it ends.
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
              This week is locked {lockedAt && `(${lockedAt})`} and no longer
              changes. Trades stay editable — correcting P&amp;L is still
              correcting a fact, but it does not move what you concluded here.
            </AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Week rating</CardTitle>
            <p className="text-sm text-muted-foreground">
              Rate the PROCESS, not the P&amp;L. A week you followed to the letter
              and lost money on is an A.
            </p>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {WEEK_GRADES.map((g) => (
                <Button
                  key={g}
                  type="button"
                  size="sm"
                  variant={form.week_grade === g ? "default" : "outline"}
                  className="w-10"
                  onClick={() => patch("week_grade", g)}
                >
                  {g}
                </Button>
              ))}
              {form.week_grade && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => patch("week_grade", null)}
                >
                  Clear
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">The week, in five answers</CardTitle>
            <p className="text-sm text-muted-foreground">
              These used to be asked every evening, mid-hold. Once a week they
              have the outcome behind them.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field
              label="What went well"
              value={form.went_well}
              onChange={(v) => patch("went_well", v)}
              hint="Process, discipline, a decision you would make again — not the size of a win."
            />
            <Field
              label="What went badly"
              value={form.went_badly}
              onChange={(v) => patch("went_badly", v)}
              hint="Including the rules you broke. A losing trade taken correctly does not belong here."
            />
            <Field
              label="The one pattern I can see"
              value={form.one_pattern}
              onChange={(v) => patch("one_pattern", v)}
              hint="One. A review that names six patterns produces no change at all."
            />
            <Field
              label="The one thing I change next week"
              value={form.one_change}
              onChange={(v) => patch("one_change", v)}
              hint="Concrete enough to become a tracker rule. If it cannot be ticked, it is a wish."
            />
            <Field
              label="What is on next week's calendar"
              value={form.next_week_catalysts}
              onChange={(v) => patch("next_week_catalysts", v)}
              hint="Releases, earnings, holidays — a holding window is exposed to all of it."
            />
          </CardContent>
        </Card>
      </fieldset>

      <div
        className={cn(
          "fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 p-4 backdrop-blur",
          "md:left-60",
        )}
      >
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {locked
              ? "Week is locked"
              : lastSaved
                ? `Last saved ${format(new Date(lastSaved), "HH:mm")}`
                : "Not saved yet"}
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
                Save review
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
  currency,
}: {
  recap: WeekRecap;
  currency: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">What happened</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Closed" value={String(recap.closed)} />
          <Stat
            label="Net"
            value={fmtMoney(recap.net, currency)}
            tone={recap.net > 0 ? "up" : recap.net < 0 ? "down" : undefined}
          />
          <Stat label="Won / lost" value={`${recap.wins} / ${recap.losses}`} />
          <Stat label="Journalled" value={`${recap.journalledDays} / 7`} />
          <Stat label="Positions checked" value={String(recap.checkedPositions)} />
          <Stat label="Touched" value={String(recap.interferedPositions)} />
          <Stat label="Thesis slipped" value={String(recap.thesisSlippedPositions)} />
          <Stat label="Held over a weekend" value={String(recap.weekendHolds)} />
        </dl>
      </CardContent>
    </Card>
  );
}

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
      toast.success("Week locked.");
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={disabled}>
          <Lock className="mr-2 size-4" />
          Lock week
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Lock {formatWeekRange(weekStart)}?</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-3 text-sm">
              <p>
                This <b>cannot be undone</b>. The review freezes exactly as it is
                now.
              </p>
              <p>
                Trades and daily entries <b>stay editable</b>. Sealing a week
                seals what you concluded about it, not the record it was drawn
                from.
              </p>
            </div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={confirm} disabled={pending}>
            <Lock className="mr-2 size-4" />
            Lock
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
