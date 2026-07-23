"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format, parseISO } from "date-fns";
import { sr } from "date-fns/locale";
import { ChevronLeft, ChevronRight, Save } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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

const MANTRA_COPY = [
  {
    key: "mantra_series" as const,
    text: "Razmišljam u verovatnoćama — edge se ispoljava kroz seriju, ne kroz jedan trejd.",
  },
  {
    key: "mantra_rules" as const,
    text: "Sve može da se desi; svaki trenutak na grafikonu je jedinstven.",
  },
  {
    key: "mantra_risk" as const,
    text: "Definišem i u potpunosti prihvatam rizik pre nego što delujem.",
  },
];

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
    mantra_series: report.mantra_series,
    mantra_rules: report.mantra_rules,
    mantra_risk: report.mantra_risk,
    risk_accepted: report.risk_accepted,
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
}: {
  report: DailyReport | null;
  reportDate: string;
  today: string;
  timezone: string;
  activeGoal: FocusGoal | null;
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
            risk_accepted: false,
          }
        : {}),
    }));
  }

  function save() {
    start(async () => {
      const res = await saveDailyReport(reportDate, form);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      if (res.warnNoFocusGoal) {
        toast.warning("Postavi cilj fokusa da ocena dana ima smisla.");
      }
      toast.success("Dnevni izveštaj sačuvan");
      setLastSaved(res.updated_at);
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
              {format(parseISO(reportDate), "EEE, d. MMM yyyy.", { locale: sr })}
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
        <Badge variant={complete ? "default" : "secondary"}>
          {complete ? "Kompletan" : "Nacrt"}
        </Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ocena dana</CardTitle>
          <p className="text-sm text-muted-foreground">
            Samo na osnovu napretka ka aktivnom cilju fokusa — ne P&amp;L.
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
                Obriši
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
                Dan bez trejdova (no-trade day)
              </label>
              <p className="text-xs text-muted-foreground">
                Nisam ušao u nijednu poziciju. Impulsna sekcija se preskače —
                fokus na proces i učenje, ne na P&amp;L.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Jutro · pre trejda</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {lowMental && (
            <Alert>
              <AlertDescription>
                Mentalna temperatura ispod 5 — razmisli o manjoj veličini ili
                preskakanju dok se ne osećaš spremnije.
              </AlertDescription>
            </Alert>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Mentalna temperatura (1–10)</Label>
              <Select
                value={form.mental_temp?.toString() ?? ""}
                onValueChange={(v) =>
                  patch("mental_temp", v ? Number(v) : null)
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Izaberi…" />
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
            <Label>Makro događaji danas</Label>
            <Textarea
              value={form.macro_note ?? ""}
              onChange={(e) => patch("macro_note", e.target.value || null)}
              placeholder="Ključni izveštaji, govori, kontekst likvidnosti…"
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <Label>Tip tržišta (filter za setup)</Label>
            <Select
              value={form.market_type ?? ""}
              onValueChange={(v) =>
                patch("market_type", (v || null) as MarketType | null)
              }
            >
              <SelectTrigger className="w-full sm:w-64">
                <SelectValue placeholder="Izaberi režim…" />
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

          {!form.no_trade_day && (
            <>
              <div className="space-y-3 rounded-md border p-3">
                <p className="text-sm font-medium">Potvrdi (Douglas)</p>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  {MANTRA_COPY.map(({ key, text }) => (
                    <li key={key} className="flex items-start gap-2">
                      <Checkbox
                        id={key}
                        checked={form[key]}
                        onCheckedChange={(c) => patch(key, c === true)}
                        className="mt-0.5"
                      />
                      <label
                        htmlFor={key}
                        className="cursor-pointer leading-snug"
                      >
                        {text}
                      </label>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="flex items-start gap-2">
                <Checkbox
                  id="risk_accepted"
                  checked={form.risk_accepted}
                  onCheckedChange={(c) => patch("risk_accepted", c === true)}
                  className="mt-0.5"
                />
                <label
                  htmlFor="risk_accepted"
                  className="cursor-pointer text-sm"
                >
                  Prihvatam rizik na svaki trejd koji danas uzmem (gubitak je
                  već mentalno plaćen).
                </label>
              </div>
            </>
          )}

          <div className="space-y-2">
            <Label>Mentalna proba (opciono)</Label>
            <Textarea
              value={form.mental_rehearsal ?? ""}
              onChange={(e) =>
                patch("mental_rehearsal", e.target.value || null)
              }
              placeholder="1–2 rečenice: kako ću reagovati na stop ili propušten setup…"
              rows={2}
            />
          </div>
        </CardContent>
      </Card>

      {!form.no_trade_day && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tokom dana</CardTitle>
            <p className="text-sm text-muted-foreground">
              Mid-day check za intraweek swing — proveri se kad pregledaš tržište
              (London, NY, ili između), ne samo uveče.
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
                  Nisam dirao otvorene pozicije danas
                </label>
                <p className="text-xs text-muted-foreground">
                  Nema pomeranja stopa, delimičnih izlaza, usrednjavanja ili
                  zatvaranja van plana.
                </p>
              </div>
            </div>

            {form.micromanage !== "untouched" && (
              <div className="space-y-2">
                <Label>Ako nije tačno — šta se desilo?</Label>
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
                      Obriši
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
            <CardTitle className="text-base">Kontrola impulsa</CardTitle>
            <p className="text-sm text-muted-foreground">
              Uhvati loše navike pre nego što se nagomilaju.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Impulsi danas (Douglasovi strahovi)</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                {(
                  [
                    ["impulse_fomo", "FOMO — jurio bez edge-a"],
                    ["impulse_fear", "Strah od gubitka — oklevanje ili prerani izlaz"],
                    [
                      "impulse_fear_wrong",
                      "Strah da grešim — pomerio stop / usrednjavao",
                    ],
                    [
                      "impulse_greed",
                      "Strah da ostavim novac — prerano uzeo profit",
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
              <Label>Napomena</Label>
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
          <CardTitle className="text-base">Veče · debrief</CardTitle>
          <p className="text-sm text-muted-foreground">
            Miran dan sa malo trejdova? I dalje popuni — učenje se računa.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Da li si danas prekršio trading pravilo?</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={form.rule_broken === true ? "destructive" : "outline"}
                onClick={() => patch("rule_broken", true)}
              >
                Da
              </Button>
              <Button
                type="button"
                size="sm"
                variant={
                  form.rule_broken === false ? "default" : "outline"
                }
                onClick={() => patch("rule_broken", false)}
              >
                Ne
              </Button>
            </div>
            {form.rule_broken && (
              <Textarea
                value={form.rule_broken_note ?? ""}
                onChange={(e) =>
                  patch("rule_broken_note", e.target.value || null)
                }
                placeholder="Koje pravilo? Trošak u smislu procesa, ne P&amp;L…"
                rows={2}
              />
            )}
          </div>

          <Field
            label="Šta sam danas naučio ili poboljšao"
            value={form.learned_today}
            onChange={(v) => patch("learned_today", v)}
          />
          <Field
            label="Promene za sutra (sa rešenjima)"
            value={form.tomorrow_change}
            onChange={(v) => patch("tomorrow_change", v)}
            hint="Navedi promenu i kako ćeš je primeniti."
          />
          <Field
            label="Najlakši layup setup"
            value={form.easiest_setup}
            onChange={(v) => patch("easiest_setup", v)}
            hint="Setup iz playbook-a koji je bio najjasniji — ne najveći pomeraj."
          />
          <Field
            label="Pregled dana"
            value={form.day_overview}
            onChange={(v) => patch("day_overview", v)}
          />
          <Field
            label="Proslavi pobedu"
            value={form.celebrate_win}
            onChange={(v) => patch("celebrate_win", v)}
            hint="Pobeda u procesu, disciplina ili samosvest — ne dolar P&amp;L."
          />
        </CardContent>
      </Card>

      {showFriday && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Petak pravilo</CardTitle>
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

      <div
        className={cn(
          "fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 p-4 backdrop-blur",
          "md:left-60",
        )}
      >
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {lastSaved
              ? `Poslednje sačuvano ${format(new Date(lastSaved), "HH:mm")}`
              : "Još nije sačuvano"}
          </p>
          <Button onClick={save} disabled={pending}>
            <Save className="mr-2 size-4" />
            Sačuvaj izveštaj
          </Button>
        </div>
      </div>
    </div>
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
