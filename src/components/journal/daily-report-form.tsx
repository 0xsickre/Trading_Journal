"use client";

import { useEffect, useState, useTransition, type MouseEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { format, parseISO } from "date-fns";
import { srLatn } from "date-fns/locale/sr-Latn";
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
import { DATE, DATE_TIME, fmtInTz } from "@/lib/journal/time";
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
    mental_temp: report.mental_temp,
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
  streak,
  beforeSession,
  afterSession,
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
  /** The run of days behind this one — under the day's heading. */
  streak?: ReactNode;
  /** The page's own cards for the start of the day: the morning brief, the focus goal. */
  beforeSession?: ReactNode;
  /** The page's own cards for the end of it: trades still to review, the day's result. */
  afterSession?: ReactNode;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [form, setForm] = useState<FormState>(() =>
    toFormState(report, reportDate),
  );
  const [lastSaved, setLastSaved] = useState(report?.updated_at ?? null);
  /**
   * Typed and not yet saved. The arrows and "Danas" move to another day, which
   * remounts this form — everything unsaved was dropped without a word.
   */
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  /** Stops a day change that would throw away unsaved text, unless confirmed. */
  function guardLeave(e: MouseEvent) {
    if (dirty && !window.confirm("Imaš nesačuvane izmene. Napusti ovaj dan bez čuvanja?"))
      e.preventDefault();
  }

  const complete = isDayComplete(activeGoal);

  const isToday = reportDate === today;
  const lowMental = form.mental_temp != null && form.mental_temp < 3;
  // In the ACCOUNT's zone, like every other time on this page. `format` read
  // the browser's clock, so the server and the client could print two times.
  const lockedAt = report?.locked_at
    ? fmtInTz(report.locked_at, timezone, DATE_TIME)
    : null;

  function patch<K extends keyof FormState>(key: K, value: FormState[K]) {
    setDirty(true);
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function toggleNoTradeDay(checked: boolean) {
    setDirty(true);
    setForm((prev) => ({ ...prev, no_trade_day: checked }));
  }

  /** Split out so locking can persist first — see LockDayButton. */
  async function persist(): Promise<boolean> {
    const res = await saveDailyReport(reportDate, form);
    if (!res.ok) {
      toast.error(res.error);
      return false;
    }
    if (res.warnNoFocusGoal) {
      toast.warning("Postavi fokus cilj — u odnosu na njega se meri dan.");
    }
    setLastSaved(res.updated_at);
    setDirty(false);
    return true;
  }

  function save() {
    start(async () => {
      if (!(await persist())) return;
      toast.success("Dnevni izveštaj sačuvan");
      router.refresh();
    });
  }

  return (
    <div className="space-y-6 pb-24">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="size-8" asChild>
            <Link
              href={`/daily?date=${prevReportDate(reportDate)}`}
              onClick={guardLeave}
              aria-label="Prethodni dan"
            >
              <ChevronLeft className="size-4" />
            </Link>
          </Button>
          <div className="min-w-[10rem] text-center">
            <p className="text-lg font-semibold">
              {format(parseISO(reportDate), `EEE, ${DATE}`, { locale: srLatn })}
            </p>
            {!isToday && (
              <p className="text-xs text-muted-foreground">{timezone}</p>
            )}
          </div>
          {/* A real disabled button on today: `disabled` on a link does
              nothing, and clicking it reloaded the same day. */}
          {reportDate >= today ? (
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              disabled
              aria-label="Sledeći dan"
            >
              <ChevronRight className="size-4" />
            </Button>
          ) : (
            <Button variant="outline" size="icon" className="size-8" asChild>
              <Link
                href={`/daily?date=${nextReportDate(reportDate)}`}
                onClick={guardLeave}
                aria-label="Sledeći dan"
              >
                <ChevronRight className="size-4" />
              </Link>
            </Button>
          )}
          {!isToday && (
            <Button variant="ghost" size="sm" asChild>
              <Link href="/daily" onClick={guardLeave}>
                Danas
              </Link>
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <TrackerDayBadge
            compliance={tracker.compliance}
            locked={tracker.locked}
          />
          <Badge variant={complete ? "default" : "secondary"}>
            {complete ? "Završeno" : "Nacrt"}
          </Badge>
        </div>
      </div>

      {streak}

      {tracker.locked && (
        <Alert>
          <AlertDescription>
            {/* Explicit `{" "}`: the plain space written here did not reach
                the DOM and the sentence ran together at the bracket. */}
            Ovaj dan je zaključan {lockedAt && `(${lockedAt})`}{" "}
            i njegov dnevnik se više ne menja. Trejdovi ostaju izmenjivi —
            ispravka P&amp;L-a je i dalje ispravka činjenice, ali ne pomera
            ocenu ovog dana.
          </AlertDescription>
        </Alert>
      )}

      {/* The day in the order it is lived: before the session, during it,
          after it. It used to open with the day's money and the trades still to
          review, and ask "before you enter" only after the trading rules —
          answering the morning's questions below the evening's result. */}
      <DaySection
        n={1}
        title="Pre sesije"
        hint="Šta brief kaže o danu, u kakvom si stanju i da li uopšte trguješ — pre prvog ulaza."
      >
        {beforeSession}
        {/* One `disabled` per block instead of threading it through every
            control. The tracker rows go read-only the same way — the answer
            buttons are form controls, so the browser disables them too, and the
            database trigger refuses the write regardless. Links stay clickable:
            a sealed day is still readable. The page's own cards sit outside
            these blocks, since they are not part of the day's sealed record. */}
        <fieldset disabled={tracker.locked} className="m-0 min-w-0 space-y-6 border-0 p-0 disabled:opacity-100">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Pre nego što uđeš</CardTitle>
              <p className="text-sm text-muted-foreground">
                Dva pitanja pre prvog ulaza. Odgovori su filter za danas, ne dnevnik —
                čuvaju se dugmetom „Sačuvaj izveštaj“.
              </p>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label>1. Kako si danas?</Label>
                {/* Stars, not 1–10. Ten levels is a precision nobody has about
                    their own head; asked for, it produces noise that then feeds a
                    report dimension and an insight rule as if it were signal. */}
                <StarRating
                  label="Mentalno stanje"
                  value={form.mental_temp}
                  onChange={(next) => patch("mental_temp", next)}
                />
                <p className="text-xs text-muted-foreground">
                  Mentalno stanje: 1 = umoran ili rastrojen, 5 = odmoran i miran.
                </p>
                {lowMental && (
                  <Alert>
                    <AlertDescription>
                      Ispod 3 zvezdice — razmisli o manjoj veličini pozicije, ili ostani
                      po strani dok se ne osetiš spremnije.
                    </AlertDescription>
                  </Alert>
                )}
              </div>

              <div className="space-y-2">
                <Label>2. Da li danas trguješ?</Label>
                <div className="flex items-start gap-2 rounded-md border border-dashed p-3">
                  <Checkbox
                    id="no_trade_day"
                    checked={form.no_trade_day}
                    onCheckedChange={(c) => toggleNoTradeDay(c === true)}
                    className="mt-0.5"
                  />
                  <div>
                    <label htmlFor="no_trade_day" className="cursor-pointer text-sm font-medium">
                      Danas ne trgujem
                    </label>
                    <p className="text-xs text-muted-foreground">
                      Odluka pre sesije, ne izgovor posle nje. Dan bez ulaza je i dalje
                      dan: pravila pripreme i osvrta se ocenjuju, a pravila trgovanja
                      nemaju šta da ocene.
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <TrackerStageSection stage="prepare" data={tracker} />
        </fieldset>
      </DaySection>

      <DaySection
        n={2}
        title="Tokom sesije"
        hint="Automatska pravila se ocenjuju sama — iz trejdova i iz brief-a. Ručna čekaju tvoj odgovor."
      >
        {/* The trade-stage rules stand even on a day you did not trade: "I
            only trade in my defined hours" is answerable, and answerable well,
            on a flat day, and hiding them would quietly drop rules from the
            denominator on exactly the days discipline matters most. Boxed: the
            biggest stage by far. */}
        <fieldset disabled={tracker.locked} className="m-0 min-w-0 border-0 p-0 disabled:opacity-100">
          <TrackerStageSection stage="trade" data={tracker} boxed />
        </fieldset>
      </DaySection>

      <DaySection
        n={3}
        title="Posle sesije"
        hint="Pregledaj svaki trejd, pogledaj rezultat dana, odgovori na osvrt — pa sačuvaj i zaključaj dan."
      >
        {afterSession}
        {/* The debrief prose (what I learned, what I change tomorrow) and the
            four Douglas-fear checkboxes left in Phase E: nothing read them. The
            week's review asks those questions, with the week's outcome in hand. */}
        <fieldset disabled={tracker.locked} className="m-0 min-w-0 border-0 p-0 disabled:opacity-100">
          <TrackerStageSection stage="reflect" data={tracker} />
        </fieldset>
      </DaySection>

      <div
        className={cn(
          "fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 p-4 backdrop-blur",
          "md:left-(--sidebar-offset)",
        )}
      >
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {tracker.locked
              ? "Dan je zaključan"
              : lastSaved
                ? `${dirty ? "Nesačuvane izmene · " : ""}Poslednje čuvanje ${fmtInTz(lastSaved, timezone, "HH:mm")}`
                : dirty
                  ? "Nesačuvane izmene"
                  : "Još nije sačuvano"}
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
                Sačuvaj izveštaj
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** One part of the day — before, during or after the session — with a number and one line on what it holds. */
function DaySection({ n, title, hint, children }: { n: number; title: string; hint: string; children: ReactNode }) {
  return (
    <section className="space-y-4">
      <div className="border-b pb-2">
        <h2 className="text-base font-semibold">
          <span className="mr-2 text-muted-foreground tabular-nums">{n}</span>
          {title}
        </h2>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      {children}
    </section>
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
      toast.success("Dan zaključan.");
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={disabled}>
          <Lock className="mr-2 size-4" />
          Zaključaj dan
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Zaključati {reportDate}?</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-3 text-sm">
              <p>
                Ovo se <b>ne može poništiti</b>. Dnevni izveštaj i čeklista za ovaj
                dan se zamrzavaju tačno ovakvi kakvi su sada
                {compliance.pct != null &&
                  ` — ${Math.round(compliance.pct)}%, ${compliance.satisfied} od ${compliance.applicable} pravila`}
                .
              </p>
              <p>
                Trejdovi <b>ostaju izmenjivi</b>. Možeš i dalje ispraviti pogrešno
                unetu cenu i P&amp;L će se pomeriti — ali ocena ovog dana neće,
                jer se automatska pravila sada zamrzavaju.
              </p>
              {isToday && (
                <p className="text-amber-600 dark:text-amber-500">
                  Dan je još u toku. Neodgovorena pravila se zamrzavaju kao
                  neispunjena.
                </p>
              )}
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

