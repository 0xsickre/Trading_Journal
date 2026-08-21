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
import { StarRating } from "@/components/journal/star-rating";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  emptyDailyReport,
  isDayComplete,
  nextReportDate,
  prevReportDate,
  type DailyReport,
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
import {
  OpenPositionsCard,
  type OpenPositionView,
} from "@/components/journal/open-positions-card";

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
    mental_temp: report.mental_temp,
    macro_note: report.macro_note,
    impulse_fomo: report.impulse_fomo,
    impulse_fear: report.impulse_fear,
    impulse_greed: report.impulse_greed,
    impulse_fear_wrong: report.impulse_fear_wrong,
    impulse_note: report.impulse_note,
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
  positions,
}: {
  report: DailyReport | null;
  reportDate: string;
  today: string;
  timezone: string;
  activeGoal: FocusGoal | null;
  /**
   * Positions that were open on this day, with the answers already given.
   *
   * They render inside this form rather than beside it because `tj_lock_day`
   * seals the report, the checklist and now these check-ins in one call, and the
   * one `disabled` fieldset below is what makes a sealed day read-only.
   */
  positions: OpenPositionView[];
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

  // Read off the positions rather than the form: the day's remaining work is
  // judging what was open, and the answers are saved on tap, so this counts
  // stored rows and does not need to live in form state.
  const complete = useMemo(
    () =>
      isDayComplete(
        {
          openCount: positions.length,
          judgedCount: positions.filter((p) => p.checkin?.thesis_state != null)
            .length,
        },
        activeGoal,
      ),
    [positions, activeGoal],
  );

  const isToday = reportDate === today;
  const lowMental = form.mental_temp != null && form.mental_temp < 3;
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
      toast.warning("Set a focus goal — it is what the day is measured against.");
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
              <Link href="/daily">Today</Link>
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <TrackerDayBadge
            compliance={tracker.compliance}
            locked={tracker.locked}
          />
          <Badge variant={complete ? "default" : "secondary"}>
            {complete ? "Complete" : "Draft"}
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
              {/* Explicit `{" "}` — see the same banner in
                  `weekly-review-form.tsx`: the plain space written here did not
                  reach the DOM and the sentence ran together at the bracket. */}
              This day is locked {lockedAt && `(${lockedAt})`}{" "}
              and its journal no longer changes. Trades stay editable —
              correcting P&amp;L is still correcting a fact, but it does not move
              this day&apos;s rating.
            </AlertDescription>
          </Alert>
        )}

      {/* First, because it is the only thing on this page whose answer actually
          changes from one day to the next while a swing is running. */}
      <OpenPositionsCard
        positions={positions}
        reportDate={reportDate}
        locked={tracker.locked}
      />

      {/* The tracker checklist is the backbone of the day, not an extra — it is
          what `tj_lock_day` scores. The trade-stage rules stand on their own
          because they still apply on a day you did not trade: "I only trade in
          my defined hours" is answerable, and answerable well, on a flat day,
          and hiding them would quietly drop rules from the denominator on
          exactly the days discipline matters most. */}
      <TrackerStageSection stage="prepare" data={tracker} />
      {/* Boxed, unlike the other two: this is the biggest stage by far and a
          card keeps six rules from reading as a run-on of the section above. */}
      <TrackerStageSection stage="trade" data={tracker} boxed />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Before you enter</CardTitle>
          <p className="text-sm text-muted-foreground">
            A gate, not a diary. Both questions are about what you are about to
            do, which is why they sit below the positions and not above them.
          </p>
        </CardHeader>
        <CardContent className="space-y-5">
          {lowMental && (
            <Alert>
              <AlertDescription>
                Mental temperature below 3 stars — consider smaller size, or sitting out
                until you feel readier.
              </AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label>Mental temperature</Label>
            {/* Zvezdice, ne 1–10. Deset nivoa je preciznost koju čovek nema o
                sopstvenoj glavi; tražena, daje šum koji posle hrani dimenziju
                izveštaja i insight pravilo kao da je signal. */}
            <StarRating
              label="Mental temperature"
              value={form.mental_temp}
              onChange={(next) => patch("mental_temp", next)}
            />
          </div>

          {/* Same column as the old "macro events today", asked differently on
              purpose. "Today" is the day trader's window; a position carried to
              Thursday is exposed to Thursday's release whether or not it lands
              in this session. */}
          <div className="space-y-2">
            <Label>Catalysts before my planned exit</Label>
            <Textarea
              value={form.macro_note ?? ""}
              onChange={(e) => patch("macro_note", e.target.value || null)}
              placeholder="What lands between now and when I expect to be out — releases, earnings, the weekend…"
              rows={2}
            />
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
                No new entry today
              </label>
              <p className="text-xs text-muted-foreground">
                I opened nothing new. Open positions above are still checked —
                holding is a decision too.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

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

      {/* What used to be the "Evening · debrief" card lived here: what I learned,
          what I will change tomorrow, the day overview, whether I broke a rule.
          Five prose fields, asked daily, mid-hold. All five moved to the weekly
          review — a debrief written before the position is closed is a debrief
          written without the outcome, and asking for one every evening is how a
          journal turns into homework. */}
      <TrackerStageSection stage="reflect" data={tracker} />
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

