"use client";

import { useEffect, useState, useTransition, type MouseEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { format, parseISO } from "date-fns";
import { srLatn } from "date-fns/locale/sr-Latn";
import { ChevronLeft, ChevronRight, Lock, Plus, Save, X } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Chips } from "@/components/journal/chips";
import { cn } from "@/lib/utils";
import {
  MAX_OPPORTUNITIES,
  WORK_SHIFTS,
  WORK_SHIFT_LABEL,
  emptyDailyReport,
  gateLateText,
  gateWrittenAt,
  hasState,
  lowSleepReasons,
  nextReportDate,
  prevReportDate,
  type DailyReport,
  type Opportunity,
} from "@/lib/journal/daily-report";
import type { SaveDailyReportInput } from "@/lib/journal/daily-report-schema";
import { saveDailyReport } from "@/app/(app)/daily/actions";
import { lockDay } from "@/app/(app)/daily/tracker-actions";
import type { DayCompliance } from "@/lib/journal/tracker/compliance";
import { DATE, DATE_TIME, fmtInTz } from "@/lib/journal/time";
import {
  TrackerDayBadge,
  TrackerStageSection,
  type TrackerDayData,
} from "@/components/journal/tracker-checklist";

type FormState = SaveDailyReportInput;

/** A number field: empty or unreadable is "not written". */
function numOrNull(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

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
    sleep_quality_pct: report.sleep_quality_pct ?? null,
    // numeric(3,1) arrives from PostgREST as a string.
    sleep_hours: report.sleep_hours == null ? null : Number(report.sleep_hours),
    work_shift: report.work_shift ?? null,
    with_child: report.with_child ?? null,
    no_trade_day: report.no_trade_day ?? false,
    psychology_tags: report.psychology_tags ?? [],
    tomorrow_change: report.tomorrow_change ?? null,
    opportunities: report.opportunities ?? [],
  };
}

export function DailyReportForm({
  report,
  reportDate,
  today,
  timezone,
  tracker,
  beforeSession,
  afterSession,
  firstEntryAt,
  emotions = [],
  dayClose,
  lastTomorrowChange = null,
}: {
  report: DailyReport | null;
  reportDate: string;
  today: string;
  timezone: string;
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
  /** The page's own cards for the start of the day: the morning brief. */
  beforeSession?: ReactNode;
  /** The page's own cards for the end of it: trades still to review. */
  afterSession?: ReactNode;
  /** The day's first entry, ISO — the gate written after it is marked (phase Y). */
  firstEntryAt?: string | null;
  /** The emotion list, for the day's psychology (phase B5). */
  emotions?: { value: string; label: string }[];
  /** The day's close, read from the trades (phase B7): best and worst, mistakes and their cost. */
  dayClose?: ReactNode;
  /** The last "sutra menjam" written before this day (phase G): what the day opens with. */
  lastTomorrowChange?: { report_date: string; text: string } | null;
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

  const isToday = reportDate === today;
  // "Danas ne trgujem" with no trade taken: a rest day — the checklist goes away
  // (trader, 08.10.2026). A trade taken anyway (any auto verdict) voids the flag,
  // and the rules come back, as `computeDayCompliance` scores them.
  const traded = Object.values(tracker.auto).some(
    (v) => v?.verdict === "pass" || v?.verdict === "fail",
  );
  const restView = form.no_trade_day && !traded;
  // What is saved, not what is typed: the time is the trigger's, from the last
  // save — the state's, or on a day from before phase G the old rating's.
  const writtenAt = gateWrittenAt(report);
  const gateLate = writtenAt ? gateLateText(writtenAt, firstEntryAt) : null;
  // The retired 1–5 rating (G-2): shown read-only on a day that has one and no state.
  const oldRating = report?.mental_temp != null && !hasState(report) ? report.mental_temp : null;
  // From what is typed, so it shows before the save (trader, 27.10.2026).
  const shortNight = lowSleepReasons(form);
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

  function patchOpportunity(i: number, next: Partial<Opportunity>) {
    setDirty(true);
    setForm((prev) => ({
      ...prev,
      opportunities: prev.opportunities.map((o, j) => {
        if (j === i) return { ...o, ...next };
        // One easiest a day: marking one clears the others.
        return next.easiest ? { ...o, easiest: false } : o;
      }),
    }));
  }

  function addOpportunity() {
    setDirty(true);
    setForm((prev) => ({
      ...prev,
      opportunities: [...prev.opportunities, { note: "", in_playbook: false, could_take: false, easiest: false }],
    }));
  }

  function removeOpportunity(i: number) {
    setDirty(true);
    setForm((prev) => ({ ...prev, opportunities: prev.opportunities.filter((_, j) => j !== i) }));
  }

  /** Split out so locking can persist first — see LockDayButton. */
  async function persist(): Promise<boolean> {
    // A row left without a description is a row not written, not an error.
    const res = await saveDailyReport(reportDate, {
      ...form,
      opportunities: form.opportunities.filter((o) => o.note.trim() !== ""),
    });
    if (!res.ok) {
      toast.error(res.error);
      return false;
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
        </div>
      </div>

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

      {/* What the last close said to change (phase G): the day opens with it,
          so the change is read before the session, not found at the next close. */}
      {lastTomorrowChange && (
        <Card className="border-primary/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Danas menjam</CardTitle>
            <p className="text-xs text-muted-foreground">
              Upisano na zatvaranju dana{" "}
              {format(parseISO(lastTomorrowChange.report_date), `EEE, ${DATE}`, { locale: srLatn })}.
            </p>
          </CardHeader>
          <CardContent className="whitespace-pre-line text-sm">{lastTomorrowChange.text}</CardContent>
        </Card>
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
              <div className="space-y-3">
                <Label>1. U kakvom si stanju?</Label>
                {/* The state, not a rating (phase G, G-2): what can be checked
                    and grouped later — how I slept, whether I worked and which
                    shift, whether the child was with me — instead of a 1–5 star
                    nobody can calibrate on their own head. */}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="sleep_quality_pct" className="text-xs text-muted-foreground">
                      Kvalitet sna (%)
                    </Label>
                    <Input
                      id="sleep_quality_pct"
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={100}
                      step={5}
                      value={form.sleep_quality_pct ?? ""}
                      onChange={(e) => {
                        const n = numOrNull(e.target.value);
                        patch("sleep_quality_pct", n == null ? null : Math.round(n));
                      }}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="sleep_hours" className="text-xs text-muted-foreground">
                      Sati sna
                    </Label>
                    <Input
                      id="sleep_hours"
                      type="number"
                      inputMode="decimal"
                      min={0}
                      max={24}
                      step={0.5}
                      value={form.sleep_hours ?? ""}
                      onChange={(e) => patch("sleep_hours", numOrNull(e.target.value))}
                    />
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Smena">
                  <span className="w-14 text-xs text-muted-foreground">Smena</span>
                  {WORK_SHIFTS.map((v) => (
                    <Button
                      key={v}
                      type="button"
                      size="sm"
                      variant={form.work_shift === v ? "default" : "outline"}
                      aria-pressed={form.work_shift === v}
                      onClick={() => patch("work_shift", form.work_shift === v ? null : v)}
                    >
                      {WORK_SHIFT_LABEL[v]}
                    </Button>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Dete">
                  <span className="w-14 text-xs text-muted-foreground">Dete</span>
                  {([true, false] as const).map((v) => (
                    <Button
                      key={String(v)}
                      type="button"
                      size="sm"
                      variant={form.with_child === v ? "default" : "outline"}
                      aria-pressed={form.with_child === v}
                      onClick={() => patch("with_child", form.with_child === v ? null : v)}
                    >
                      {v ? "Sa detetom" : "Bez deteta"}
                    </Button>
                  ))}
                </div>
                {shortNight.length > 0 && (
                  <Alert>
                    <AlertDescription>
                      Kratka noć: {shortNight.join(", ")}. Danas manji rizik po trejdu — ili ostani po
                      strani.
                    </AlertDescription>
                  </Alert>
                )}
                {gateLate && (
                  <p className="text-xs font-medium text-destructive">
                    {oldRating != null ? "Ocena" : "Stanje"} {gateLate} — kapija nije bila pre sesije.
                  </p>
                )}
                {oldRating != null && (
                  <p className="text-xs text-muted-foreground">
                    Stara mentalna ocena ovog dana: {oldRating}/5 (ukinuta u fazi G, samo za čitanje).
                  </p>
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
                      Odluka pre sesije, ne izgovor posle nje. Kad je sačuvano i nema
                      trejda, dan je dan odmora: nijedno pravilo se ne traži i dan ne
                      ulazi u prosek.
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {!restView && <TrackerStageSection stage="prepare" data={tracker} />}
        </fieldset>
      </DaySection>

      {restView ? (
        <Card>
          <CardContent className="py-4 text-sm text-muted-foreground">
            Danas ne trguješ: nema pravila za štikliranje i dan je ispunjen. Ne ulazi u prosek
            usklađenosti. Sačuvaj izveštaj da bi se računalo. Ako ipak uđeš u trejd, pravila se
            vraćaju i dan se ocenjuje normalno.
          </CardContent>
        </Card>
      ) : (
        <>
          <DaySection
            n={2}
            title="Tokom sesije"
            hint="Automatska pravila se ocenjuju sama, iz trejdova. Ručna čekaju tvoj odgovor."
          >
            {/* The trade-stage rules stand even on a day you did not trade: "I
                only trade in my defined hours" is answerable, and answerable well,
                on a flat day. Only a SAVED "Danas ne trgujem" with no trade makes
                the day a rest day (`computeDayCompliance`). Boxed: the biggest
                stage by far. */}
            <fieldset disabled={tracker.locked} className="m-0 min-w-0 border-0 p-0 disabled:opacity-100">
              <TrackerStageSection stage="trade" data={tracker} boxed />
            </fieldset>
          </DaySection>

          <DaySection
            n={3}
            title="Posle sesije"
            hint="Pregledaj svaki trejd, odgovori na osvrt, sačuvaj i zaključaj dan. Zatvaranje dana je razgovor sa mentorom, iz mentor pack-a za Dan."
          >
            {afterSession}
            <fieldset disabled={tracker.locked} className="m-0 min-w-0 border-0 p-0 disabled:opacity-100">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Zatvaranje dana</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Jednom po danu, umesto na svakom trejdu: kako si se osećao, šta je dan doneo i šta
                    sutra menjaš.
                  </p>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-1.5">
                    <Label>Psihologija dana</Label>
                    <Chips
                      items={emotions}
                      selected={form.psychology_tags}
                      onToggle={(v) =>
                        patch(
                          "psychology_tags",
                          form.psychology_tags.includes(v)
                            ? form.psychology_tags.filter((x) => x !== v)
                            : [...form.psychology_tags, v],
                        )
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      Obavezno na dan sa trejdom. Na trejdu je psihologija samo za odstupanje od dana.
                    </p>
                  </div>
                  {dayClose}
                  <div className="space-y-1.5">
                    <Label htmlFor="tomorrow_change">Sutra menjam</Label>
                    <Textarea
                      id="tomorrow_change"
                      rows={3}
                      maxLength={2000}
                      placeholder="Šta sam danas naučio i šta sutra radim drugačije — sa rešenjem, ne samo problemom."
                      value={form.tomorrow_change ?? ""}
                      onChange={(e) => patch("tomorrow_change", e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">Sutra se /daily otvara ovim tekstom.</p>
                  </div>
                  <OpportunitiesField
                    items={form.opportunities}
                    onChange={patchOpportunity}
                    onAdd={addOpportunity}
                    onRemove={removeOpportunity}
                  />
                </CardContent>
              </Card>
            </fieldset>
            {/* The four Douglas-fear checkboxes left in Phase E: nothing read them.
                "Sutra menjam" came back in phase G as one field — the day after
                opens with it, and the mentor pack prints it. */}
            <fieldset disabled={tracker.locked} className="m-0 min-w-0 border-0 p-0 disabled:opacity-100">
              <TrackerStageSection stage="reflect" data={tracker} />
            </fieldset>
          </DaySection>
        </>
      )}

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

/**
 * The day's opportunities (phase G, G-1): what the market offered, up to three,
 * one marked the easiest. A sentence each, no entry, stop or target — it
 * replaced the missed setup, which asked for a whole trade and was never used.
 */
function OpportunitiesField({
  items,
  onChange,
  onAdd,
  onRemove,
}: {
  items: Opportunity[];
  onChange: (i: number, next: Partial<Opportunity>) => void;
  onAdd: () => void;
  onRemove: (i: number) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>Prilike dana</Label>
      <p className="text-xs text-muted-foreground">
        Do {MAX_OPPORTUNITIES}: šta je tržište danas ponudilo, uzeo ili ne. Jedna je najlakša.
      </p>
      {items.map((o, i) => (
        <div key={i} className="space-y-2 rounded-md border p-3">
          <div className="flex items-start gap-2">
            <Input
              aria-label={`Prilika ${i + 1}`}
              maxLength={500}
              placeholder="npr. NY sweep PDL pa MSS na 5m"
              value={o.note}
              onChange={(e) => onChange(i, { note: e.target.value })}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-9 shrink-0"
              aria-label={`Ukloni priliku ${i + 1}`}
              onClick={() => onRemove(i)}
            >
              <X className="size-4" />
            </Button>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
            {(
              [
                ["in_playbook", "U playbook-u"],
                ["could_take", "Mogao sam da uzmem"],
                ["easiest", "Najlakša danas"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex cursor-pointer items-center gap-2">
                <Checkbox checked={o[key]} onCheckedChange={(c) => onChange(i, { [key]: c === true })} />
                {label}
              </label>
            ))}
          </div>
        </div>
      ))}
      {items.length < MAX_OPPORTUNITIES && (
        <Button type="button" variant="outline" size="sm" onClick={onAdd}>
          <Plus className="mr-2 size-4" />
          Dodaj priliku
        </Button>
      )}
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

