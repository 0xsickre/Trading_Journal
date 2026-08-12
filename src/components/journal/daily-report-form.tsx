"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format, parseISO } from "date-fns";
import { ChevronLeft, ChevronRight, Lock, Save } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  DAY_GRADES,
  emptyDailyReport,
  isFriday,
  isReportComplete,
  MARKET_TYPE_LABELS,
  MARKET_TYPES,
  MICROMANAGE_LABELS,
  nextReportDate,
  prevReportDate,
  type DailyReport,
  type DayGrade,
  type MarketType,
} from "@/lib/journal/daily-report";
import type { FocusGoal } from "@/lib/journal/focus-goal";
import {
  saveDailyReport,
  type SaveDailyReportInput,
} from "@/app/(app)/daily/actions";
import { lockDay } from "@/app/(app)/daily/tracker-actions";
import type { DayCompliance } from "@/lib/journal/tracker/compliance";
import {
  TrackerDayBadge,
  TrackerStageSection,
  type TrackerDayData,
} from "@/components/journal/tracker-checklist";

type FormState = SaveDailyReportInput;

function toFormState(
  report: DailyReport | null,
  reportDate: string,
): FormState {
  if (!report) {
    const empty = emptyDailyReport(reportDate);
    const { report_date: _, ...rest } = empty;
    return rest;
  }
  return {
    day_grade: report.day_grade as DayGrade | null,
    mental_temp: report.mental_temp,
    sleep_quality: report.sleep_quality,
    macro_note: report.macro_note,
    mental_rehearsal: report.mental_rehearsal,
    market_type: report.market_type,
    micromanage: report.micromanage,
    impulse_fomo: report.impulse_fomo,
    impulse_fear: report.impulse_fear,
    impulse_greed: report.impulse_greed,
    impulse_fear_wrong: report.impulse_fear_wrong,
    impulse_note: report.impulse_note,
    rule_broken: report.rule_broken,
    rule_broken_note: report.rule_broken_note,
    learned_today: report.learned_today,
    tomorrow_change: report.tomorrow_change,
    easiest_setup: report.easiest_setup,
    day_overview: report.day_overview,
    celebrate_win: report.celebrate_win,
    friday_flat: report.friday_flat,
    no_trade_day: report.no_trade_day ?? false,
  };
}

export function DailyReportForm({
  report,
  reportDate,
  today,
  timezone,
  activeGoal,
  tracker,
}: {
  report: DailyReport | null;
  reportDate: string;
  today: string;
  timezone: string;
  activeGoal: FocusGoal | null;
  /**
   * The tracker checklist for this same day.
   *
   * It rides along inside this form rather than on a page of its own because
   * both describe one day, and `tj_lock_day` seals them together in a single
   * call — something sealed by one action should not be split across two
   * screens. The two still write to separate tables and save independently: a
   * ticked rule is stored the moment you tick it, the report only on Save.
   */
  tracker: TrackerDayData;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [form, setForm] = useState<FormState>(() =>
    toFormState(report, reportDate),
  );
  const [lastSaved, setLastSaved] = useState(report?.updated_at ?? null);

  const complete = useMemo(
    () =>
      isReportComplete(
        { day_grade: form.day_grade, rule_broken: form.rule_broken },
        activeGoal,
      ),
    [form.day_grade, form.rule_broken, activeGoal],
  );

  const isToday = reportDate === today;
  const showFriday = isFriday(reportDate);
  const lowMental = form.mental_temp != null && form.mental_temp < 5;
  const lockedAt = report?.locked_at
    ? format(new Date(report.locked_at), "d MMM yyyy, HH:mm")
    : null;

  function patch<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function toggleNoTradeDay(checked: boolean) {
    setForm((prev) => ({
      ...prev,
      no_trade_day: checked,
      ...(checked
        ? {
            micromanage: null,
            impulse_fomo: false,
            impulse_fear: false,
            impulse_greed: false,
            impulse_fear_wrong: false,
          }
        : {}),
    }));
  }

  /** Split out so locking can persist first — see LockDayButton. */
  async function persist(): Promise<boolean> {
    const res = await saveDailyReport(reportDate, form);
    if (!res.ok) {
      toast.error(res.error);
      return false;
    }
    if (res.warnNoFocusGoal) {
      toast.warning("Postavi cilj fokusa da ocena dana ima smisla.");
    }
    setLastSaved(res.updated_at);
    return true;
  }

  function save() {
    start(async () => {
      if (!(await persist())) return;
      toast.success("Daily report saved");
      router.refresh();
    });
  }

  return (
    <div className="space-y-6 pb-24">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="size-8" asChild>
            <Link href={`/daily?date=${prevReportDate(reportDate)}`}>
              <ChevronLeft className="size-4" />
            </Link>
          </Button>
          <div className="min-w-[10rem] text-center">
            <p className="text-lg font-semibold">
              {format(parseISO(reportDate), "EEE, d MMM yyyy")}
            </p>
            {!isToday && (
              <p className="text-xs text-muted-foreground">{timezone}</p>
            )}
          </div>
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            asChild
            disabled={reportDate >= today}
          >
            <Link
              href={
                reportDate >= today
                  ? `/daily?date=${reportDate}`
                  : `/daily?date=${nextReportDate(reportDate)}`
              }
              aria-disabled={reportDate >= today}
            >
              <ChevronRight className="size-4" />
            </Link>
          </Button>
          {!isToday && (
            <Button variant="ghost" size="sm" asChild>
              <Link href="/daily">Danas</Link>
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <TrackerDayBadge
            compliance={tracker.compliance}
            locked={tracker.locked}
          />
          <Badge variant={complete ? "default" : "secondary"}>
            {complete ? "Kompletan" : "Nacrt"}
          </Badge>
        </div>
      </div>

      {/* One `disabled` on the wrapper instead of threading it through forty
          controls. The tracker rows inside go read-only the same way — the answer
          buttons are form controls, so the browser disables them too, and the
          database trigger refuses the write regardless. Links stay clickable,
          which is what you want: a sealed day is still readable. */}
      <fieldset
        disabled={tracker.locked}
        className="m-0 min-w-0 space-y-6 border-0 p-0 disabled:opacity-100"
      >
        {tracker.locked && (
          <Alert>
            <AlertDescription>
              This day is locked {lockedAt && `(${lockedAt})`} and its journal no
              longer changes. Trades stay editable — correcting P&amp;L is still
              correcting a fact, but it does not move this day&apos;s rating.
            </AlertDescription>
          </Alert>
        )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Day rating</CardTitle>
          <p className="text-sm text-muted-foreground">
            Based only on progress toward the active focus goal — not P&amp;L.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {DAY_GRADES.map((g) => (
              <Button
                key={g}
                type="button"
                size="sm"
                variant={form.day_grade === g ? "default" : "outline"}
                className="w-10"
                onClick={() => patch("day_grade", g)}
              >
                {g}
              </Button>
            ))}
            {form.day_grade && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => patch("day_grade", null)}
              >
                Clear
              </Button>
            )}
          </div>

          <div className="flex items-start gap-2 rounded-md border border-dashed p-3">
            <Checkbox
              id="no_trade_day"
              checked={form.no_trade_day}
              onCheckedChange={(c) => toggleNoTradeDay(c === true)}
              className="mt-0.5"
            />
            <div>
              <label
                htmlFor="no_trade_day"
                className="cursor-pointer text-sm font-medium"
              >
                No-trade day
              </label>
              <p className="text-xs text-muted-foreground">
                I entered no position. The impulse section is skipped — the focus is
                process and learning, not P&amp;L.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Morning · pre-market</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {lowMental && (
            <Alert>
              <AlertDescription>
                Mental temperature below 5 — consider smaller size, or sitting out
                until you feel readier.
              </AlertDescription>
            </Alert>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Mental temperature (1–10)</Label>
              <Select
                value={form.mental_temp?.toString() ?? ""}
                onValueChange={(v) =>
                  patch("mental_temp", v ? Number(v) : null)
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Pick…" />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Kvalitet sna (1–5, opciono)</Label>
              <Select
                value={form.sleep_quality?.toString() ?? ""}
                onValueChange={(v) =>
                  patch("sleep_quality", v ? Number(v) : null)
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Opciono" />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 5 }, (_, i) => i + 1).map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Macro events today</Label>
            <Textarea
              value={form.macro_note ?? ""}
              onChange={(e) => patch("macro_note", e.target.value || null)}
              placeholder="Key releases, speeches, liquidity context…"
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <Label>Market type (setup filter)</Label>
            <Select
              value={form.market_type ?? ""}
              onValueChange={(v) =>
                patch("market_type", (v || null) as MarketType | null)
              }
            >
              <SelectTrigger className="w-full sm:w-64">
                <SelectValue placeholder="Pick a regime…" />
              </SelectTrigger>
              <SelectContent>
                {MARKET_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {MARKET_TYPE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Mental rehearsal (optional)</Label>
            <Textarea
              value={form.mental_rehearsal ?? ""}
              onChange={(e) =>
                patch("mental_rehearsal", e.target.value || null)
              }
              placeholder="1–2 sentences: how I will react to a stop or a missed setup…"
              rows={2}
            />
          </div>

          <TrackerStageSection stage="prepare" data={tracker} />
        </CardContent>
      </Card>

      {/* The trade-stage rules stand in their own card instead of inside "Tokom
          dana", which is hidden on a no-trade day. Those rules still apply then —
          "I only trade in my defined hours" is answerable, and answerable well,
          on a day you did not trade — so hiding them would quietly drop rules
          from the denominator on exactly the days discipline matters most. */}
      <TrackerStageSection
        stage="trade"
        data={tracker}
        title="Trading · checklist"
      />

      {!form.no_trade_day && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">During the day</CardTitle>
            <p className="text-sm text-muted-foreground">
              Mid-day check for an intraweek swing — check in when you review the
              market (London, NY, or in between), not only in the evening.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start gap-2 rounded-md border border-dashed p-3">
              <Checkbox
                id="midday_no_touch"
                checked={form.micromanage === "untouched"}
                onCheckedChange={(c) =>
                  patch("micromanage", c ? "untouched" : null)
                }
                className="mt-0.5"
              />
              <div>
                <label
                  htmlFor="midday_no_touch"
                  className="cursor-pointer text-sm font-medium"
                >
                  I did not touch open positions today
                </label>
                <p className="text-xs text-muted-foreground">
                  No stop moves, partial exits, averaging, or closing outside the plan.
                </p>
              </div>
            </div>

            {form.micromanage !== "untouched" && (
              <div className="space-y-2">
                <Label>If not true — what happened?</Label>
                <div className="flex flex-wrap gap-2">
                  {(["watched", "violated"] as const).map((opt) => (
                    <Button
                      key={opt}
                      type="button"
                      size="sm"
                      variant={
                        form.micromanage === opt ? "default" : "outline"
                      }
                      onClick={() => patch("micromanage", opt)}
                    >
                      {MICROMANAGE_LABELS[opt]}
                    </Button>
                  ))}
                  {form.micromanage && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => patch("micromanage", null)}
                    >
                      Clear
                    </Button>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {!form.no_trade_day && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Impulse control</CardTitle>
            <p className="text-sm text-muted-foreground">
              Catch bad habits before they pile up.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Impulses today (Douglas&apos; fears)</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                {(
                  [
                    ["impulse_fomo", "FOMO — chased without an edge"],
                    ["impulse_fear", "Fear of losing — hesitated or exited early"],
                    [
                      "impulse_fear_wrong",
                      "Fear of being wrong — moved the stop / averaged down",
                    ],
                    [
                      "impulse_greed",
                      "Fear of leaving money — took profit too early",
                    ],
                  ] as const
                ).map(([key, label]) => (
                  <div key={key} className="flex items-center gap-2">
                    <Checkbox
                      id={key}
                      checked={form[key]}
                      onCheckedChange={(c) => patch(key, c === true)}
                    />
                    <label htmlFor={key} className="cursor-pointer text-sm">
                      {label}
                    </label>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Note</Label>
              <Textarea
                value={form.impulse_note ?? ""}
                onChange={(e) => patch("impulse_note", e.target.value || null)}
                rows={2}
              />
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Evening · debrief</CardTitle>
          <p className="text-sm text-muted-foreground">
            A quiet day with few trades? Fill it in anyway — the learning counts.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Did you break a trading rule today?</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={form.rule_broken === true ? "destructive" : "outline"}
                onClick={() => patch("rule_broken", true)}
              >
                Yes
              </Button>
              <Button
                type="button"
                size="sm"
                variant={
                  form.rule_broken === false ? "default" : "outline"
                }
                onClick={() => patch("rule_broken", false)}
              >
                No
              </Button>
            </div>
            {form.rule_broken && (
              <Textarea
                value={form.rule_broken_note ?? ""}
                onChange={(e) =>
                  patch("rule_broken_note", e.target.value || null)
                }
                placeholder="Which rule? The cost in process terms, not P&amp;L…"
                rows={2}
              />
            )}
          </div>

          <Field
            label="What I learned or improved today"
            value={form.learned_today}
            onChange={(v) => patch("learned_today", v)}
          />
          <Field
            label="Changes for tomorrow (with solutions)"
            value={form.tomorrow_change}
            onChange={(v) => patch("tomorrow_change", v)}
            hint="Name the change and how you will apply it."
          />
          <Field
            label="Easiest layup setup"
            value={form.easiest_setup}
            onChange={(v) => patch("easiest_setup", v)}
            hint="The playbook setup that was clearest — not the biggest move."
          />
          <Field
            label="Day overview"
            value={form.day_overview}
            onChange={(v) => patch("day_overview", v)}
          />
          <Field
            label="Celebrate a win"
            value={form.celebrate_win}
            onChange={(v) => patch("celebrate_win", v)}
            hint="A process win, discipline, or self-awareness — not dollar P&amp;L."
          />

          <TrackerStageSection stage="reflect" data={tracker} />
        </CardContent>
      </Card>

      {showFriday && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Friday rule</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Checkbox
                id="friday_flat"
                checked={form.friday_flat === true}
                onCheckedChange={(c) => patch("friday_flat", c === true)}
              />
              <label htmlFor="friday_flat" className="cursor-pointer text-sm">
                Sve pozicije zatvorene pre vikenda
              </label>
            </div>
          </CardContent>
        </Card>
      )}
      </fieldset>

      <div
        className={cn(
          "fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 p-4 backdrop-blur",
          "md:left-60",
        )}
      >
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {tracker.locked
              ? "Day is locked"
              : lastSaved
                ? `Last saved ${format(new Date(lastSaved), "HH:mm")}`
                : "Not saved yet"}
          </p>
          {!tracker.locked && (
            <div className="flex items-center gap-2">
              <LockDayButton
                reportDate={reportDate}
                isToday={isToday}
                compliance={tracker.compliance}
                disabled={pending}
                persist={persist}
              />
              <Button onClick={save} disabled={pending}>
                <Save className="mr-2 size-4" />
                Save report
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Locking is irreversible, so it asks first — and the dialog says what will and
 * will not be frozen, because "lock" alone reads like it freezes the trades too.
 *
 * Saving the report first is deliberate: locking seals what is STORED, and text
 * sitting unsaved in the form is not stored. Without this the obvious sequence —
 * write the debrief, hit lock — would seal an empty day.
 */
function LockDayButton({
  reportDate,
  isToday,
  compliance,
  disabled,
  persist,
}: {
  reportDate: string;
  isToday: boolean;
  compliance: DayCompliance;
  disabled: boolean;
  /** Saves the report; locking aborts if it fails. */
  persist: () => Promise<boolean>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  function confirm() {
    start(async () => {
      // Save before sealing. Locking freezes what is STORED, and text still
      // sitting in the form is not stored — without this, the obvious sequence
      // (write the debrief, hit lock) would seal an empty day, irreversibly.
      if (!(await persist())) return;

      const res = await lockDay(reportDate);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setOpen(false);
      toast.success("Day locked.");
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={disabled}>
          <Lock className="mr-2 size-4" />
          Lock day
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Lock {reportDate}?</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-3 text-sm">
              <p>
                This <b>cannot be undone</b>. The daily report and checklist for this
                day freeze exactly as they are now
                {compliance.pct != null &&
                  ` — ${Math.round(compliance.pct)}%, ${compliance.satisfied} of ${compliance.applicable} rules`}
                .
              </p>
              <p>
                Trades <b>stay editable</b>. You can still correct a mistyped price
                and P&amp;L will move — but this day&apos;s rating will not, because
                the automatic rules freeze now.
              </p>
              {isToday && (
                <p className="text-amber-600 dark:text-amber-500">
                  The day is still running. Unanswered rules freeze as unmet.
                </p>
              )}
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
        rows={2}
      />
    </div>
  );
}
