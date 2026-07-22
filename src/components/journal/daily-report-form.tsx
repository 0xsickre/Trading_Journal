"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format, parseISO } from "date-fns";
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
  MICROMANAGE_OPTIONS,
  nextReportDate,
  prevReportDate,
  todayInTz,
  type DailyReport,
  type DayGrade,
  type MarketType,
  type Micromanage,
} from "@/lib/journal/daily-report";
import type { FocusGoal } from "@/lib/journal/focus-goal";
import {
  saveDailyReport,
  type SaveDailyReportInput,
} from "@/app/(app)/daily/actions";

const MANTRA_COPY = [
  {
    key: "mantra_series" as const,
    text: "I think in probabilities — edge plays out over a series, not one trade.",
  },
  {
    key: "mantra_rules" as const,
    text: "Anything can happen; every moment on the chart is unique.",
  },
  {
    key: "mantra_risk" as const,
    text: "I define and fully accept the risk before I act.",
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

  function save() {
    start(async () => {
      const res = await saveDailyReport(reportDate, form);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      if (res.warnNoFocusGoal) {
        toast.warning("Set a focus goal to make your grade meaningful.");
      }
      toast.success("Daily report saved");
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
              {format(parseISO(reportDate), "EEE, MMM d, yyyy")}
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
        <Badge variant={complete ? "default" : "secondary"}>
          {complete ? "Complete" : "Draft"}
        </Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Day grade</CardTitle>
          <p className="text-sm text-muted-foreground">
            Based only on progress toward your active focus goal — not P&amp;L.
          </p>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Morning · pre-trade</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {lowMental && (
            <Alert>
              <AlertDescription>
                Mental temperature below 5 — consider reducing size or sitting
                out until readiness improves.
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
                  <SelectValue placeholder="Select…" />
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
              <Label>Sleep quality (1–5, optional)</Label>
              <Select
                value={form.sleep_quality?.toString() ?? ""}
                onValueChange={(v) =>
                  patch("sleep_quality", v ? Number(v) : null)
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Optional" />
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
            <Label>Market type (deploy filter)</Label>
            <Select
              value={form.market_type ?? ""}
              onValueChange={(v) =>
                patch("market_type", (v || null) as MarketType | null)
              }
            >
              <SelectTrigger className="w-full sm:w-64">
                <SelectValue placeholder="Select regime…" />
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

          <div className="space-y-3 rounded-md border p-3">
            <p className="text-sm font-medium">Acknowledge (Douglas)</p>
            <ul className="space-y-2 text-sm text-muted-foreground">
              {MANTRA_COPY.map(({ key, text }) => (
                <li key={key} className="flex items-start gap-2">
                  <Checkbox
                    id={key}
                    checked={form[key]}
                    onCheckedChange={(c) => patch(key, c === true)}
                    className="mt-0.5"
                  />
                  <label htmlFor={key} className="cursor-pointer leading-snug">
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
            <label htmlFor="risk_accepted" className="cursor-pointer text-sm">
              I accept the risk on any trade I take today (loss is already
              paid mentally).
            </label>
          </div>

          <div className="space-y-2">
            <Label>Mental rehearsal (optional)</Label>
            <Textarea
              value={form.mental_rehearsal ?? ""}
              onChange={(e) =>
                patch("mental_rehearsal", e.target.value || null)
              }
              placeholder="1–2 lines: how you'll handle a stop hit or missed setup…"
              rows={2}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Impulse control</CardTitle>
          <p className="text-sm text-muted-foreground">
            Catch snowballing habits before they compound.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Micromanage open positions?</Label>
            <div className="flex flex-wrap gap-2">
              {MICROMANAGE_OPTIONS.map((opt) => (
                <Button
                  key={opt}
                  type="button"
                  size="sm"
                  variant={form.micromanage === opt ? "default" : "outline"}
                  onClick={() => patch("micromanage", opt as Micromanage)}
                >
                  {opt.charAt(0).toUpperCase() + opt.slice(1)}
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

          <div className="space-y-2">
            <Label>Impulses today (Douglas fears)</Label>
            <div className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  ["impulse_fomo", "FOMO — chased without edge"],
                  ["impulse_fear", "Fear of loss — hesitated or cut early"],
                  [
                    "impulse_fear_wrong",
                    "Fear of being wrong — moved stop / averaged",
                  ],
                  ["impulse_greed", "Fear of leaving money — took profit early"],
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Evening · debrief</CardTitle>
          <p className="text-sm text-muted-foreground">
            Slow day with few trades? Still complete this — learning counts.
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
                placeholder="Which rule? Cost in process terms, not P&amp;L…"
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
            hint="Name the change and how you'll implement it."
          />
          <Field
            label="Easiest layup setup"
            value={form.easiest_setup}
            onChange={(v) => patch("easiest_setup", v)}
            hint="Playbook-aligned setup that was clearest today — not the biggest mover."
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
            hint="Process win, discipline moment, or self-awareness — not dollar P&amp;L."
          />
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
                All positions closed before the weekend
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
              ? `Last saved ${format(new Date(lastSaved), "HH:mm")}`
              : "Not saved yet"}
          </p>
          <Button onClick={save} disabled={pending}>
            <Save className="mr-2 size-4" />
            Save report
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
