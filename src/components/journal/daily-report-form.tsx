"use client";

import { useMemo, useState, useTransition } from "react";
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
import { DATE, DATE_TIME } from "@/lib/journal/time";
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
    ? format(new Date(report.locked_at), DATE_TIME)
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
      toast.warning("Postavi fokus cilj — u odnosu na njega se meri dan.");
    }
    setLastSaved(res.updated_at);
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
            <Link href={`/daily?date=${prevReportDate(reportDate)}`}>
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
            {complete ? "Završeno" : "Nacrt"}
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
              Ovaj dan je zaključan {lockedAt && `(${lockedAt})`}{" "}
              i njegov dnevnik se više ne menja. Trejdovi ostaju izmenjivi —
              ispravka P&amp;L-a je i dalje ispravka činjenice, ali ne pomera
              ocenu ovog dana.
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
          <CardTitle className="text-base">Pre nego što uđeš</CardTitle>
          <p className="text-sm text-muted-foreground">
            Filter, ne dnevnik. Oba pitanja su o tome šta ćeš tek uraditi, zato
            stoje ispod pozicija, a ne iznad njih.
          </p>
        </CardHeader>
        <CardContent className="space-y-5">
          {lowMental && (
            <Alert>
              <AlertDescription>
                Mentalno stanje ispod 3 zvezdice — razmisli o manjoj veličini
                pozicije, ili ostani po strani dok se ne osetiš spremnije.
              </AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label>Mentalno stanje</Label>
            {/* Stars, not 1–10. Ten levels is a precision nobody has about their
                own head; asked for, it produces noise that then feeds a report
                dimension and an insight rule as if it were signal. */}
            <StarRating
              label="Mentalno stanje"
              value={form.mental_temp}
              onChange={(next) => patch("mental_temp", next)}
            />
          </div>

          {/* Same column as the old "macro events today", asked differently on
              purpose. "Today" is the day trader's window; a position carried to
              Thursday is exposed to Thursday's release whether or not it lands
              in this session. */}
          <div className="space-y-2">
            <Label>Katalizatori pre planiranog izlaska</Label>
            <Textarea
              value={form.macro_note ?? ""}
              onChange={(e) => patch("macro_note", e.target.value || null)}
              placeholder="Šta se dešava između sada i trenutka kad očekujem da izađem — objave, earnings, vikend…"
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
                Danas bez novog ulaska
              </label>
              <p className="text-xs text-muted-foreground">
                Nisam otvorio ništa novo. Otvorene pozicije iznad su i dalje
                prijavljene — držanje je takođe odluka.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {!form.no_trade_day && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Kontrola impulsa</CardTitle>
            <p className="text-sm text-muted-foreground">
              Uhvati loše navike pre nego što se nagomilaju.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Impulsi danas (Daglasovi strahovi)</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                {(
                  [
                    ["impulse_fomo", "FOMO — jurio bez edge-a"],
                    [
                      "impulse_fear",
                      "Strah od gubitka — oklevao ili izašao prerano",
                    ],
                    [
                      "impulse_fear_wrong",
                      "Strah da nisam u pravu — pomerio stop / usrednjavao naniže",
                    ],
                    [
                      "impulse_greed",
                      "Strah da ostavljam novac — uzeo profit prerano",
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
              <Label>Beleška</Label>
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
          "md:left-(--sidebar-offset)",
        )}
      >
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {tracker.locked
              ? "Dan je zaključan"
              : lastSaved
                ? `Poslednje čuvanje ${format(new Date(lastSaved), "HH:mm")}`
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

