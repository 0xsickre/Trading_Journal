"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Check, Lock, Minus, X, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { fmtMoney } from "@/lib/journal/format";
import { fmtInTz } from "@/lib/journal/time";
import {
  type TrackerRule,
  type TrackerStage,
} from "@/lib/journal/tracker-types";
import type { AutoRuleResult, LimitBasis } from "@/lib/journal/tracker/auto-rules";
import type {
  AutoResults,
  DayCompliance,
  DayStatus,
} from "@/lib/journal/tracker/compliance";
import { setCheckin } from "@/app/(app)/daily/tracker-actions";

const STATUS_LABELS: Record<DayStatus, string> = {
  compliant: "Dan ispunjen",
  broken: "Dan prekršen",
  skipped: "Nema pravila za ovaj dan",
  pending: "Dan u toku",
  unlogged: "Dan bez prijave",
  rest: "Ne trguješ danas — dan ispunjen",
};

/**
 * The stages as `/daily` names them. Settings edits rules under the English
 * `STAGE_LABELS`; this page is the Serbian half, and it groups the rules under
 * the part of the day they belong to. Still one name per stage — never chosen
 * by the caller (see `boxed`).
 */
const DAILY_STAGE_LABELS: Record<TrackerStage, string> = {
  prepare: "Pravila pripreme",
  trade: "Pravila trgovanja",
  reflect: "Pravila osvrta",
};

/** Where a Topstep limit came from, said after the amount. */
const BASIS_TEXT: Record<LimitBasis, string> = {
  topstep_dll: "DLL Topstep plana",
  personal_dll: "lični dnevni limit gubitka",
  topstep_budget: "budžet rizika na ulazu",
  topstep_budget_slippage: "budžet rizika na ulazu + 10 % za proklizavanje",
  daily_target: "lični dnevni cilj profita",
};

/** A close time on Chicago's clock — Topstep states its day there. */
const ctTime = (iso: string) => `${fmtInTz(iso, "America/Chicago", "HH:mm")} CT`;

/**
 * The verdict of a day-trading rule (F4), whose numbers are a time, a window or
 * the day's banked profit rather than a loss. Null for every other rule and for
 * the reasons the generic text already says right.
 */
function dayTradingText(res: AutoRuleResult, currency: string): string | null {
  const verdict = res.reason === "violated" || res.reason === "ok";
  if (!verdict) return null;
  const broke = res.reason === "violated";
  switch (res.key) {
    case "stop_after_two_losses":
      if (!res.counted) return null;
      return broke
        ? `Prekršeno: ulaz posle ${res.counted.observed} SL zaredom — dan je bio gotov.`
        : `U okviru — najduži niz SL pre ulaza: ${res.counted.observed} od ${res.counted.limit}.`;
    case "no_entry_after_daily_target":
      if (res.observed == null || res.limit == null) return null;
      return broke
        ? `Prekršeno: ulaz posle ${fmtMoney(res.observed, currency)} zatvorenog profita, a dnevni cilj je ${fmtMoney(res.limit, currency)}.`
        : `U okviru — pre ulaza najviše ${fmtMoney(res.observed, currency)} od cilja ${fmtMoney(res.limit, currency)}.`;
    case "flat_by_close":
      if (!res.at) return null;
      return broke
        ? `Prekršeno: pozicija otvorena posle kraja Topstep dana (${ctTime(res.at)}).`
        : `Sve pozicije zatvorene pre kraja Topstep dana (${ctTime(res.at)}).`;
    case "no_entry_in_red_window":
      return broke
        ? `Prekršeno: ulaz u crvenom prozoru${res.window ? ` (${res.window})` : ""}.`
        : "Nijedan ulaz u crvenom prozoru brief-a.";
    default:
      return null;
  }
}

/**
 * Why an auto rule reached its verdict.
 *
 * Every branch says what to DO about it, because the two most common states are
 * both actionable and neither is a failure: `unconfigured` means you never set a
 * limit, `no_trades` means the rule had nothing to judge.
 */
function autoReasonText(res: AutoRuleResult, currency: string): string {
  // The limit the plan gave on THIS day, from the evaluator — the budget at
  // entry depends on the account's closed trades at that moment.
  const limit = res.limit ?? null;

  const day = dayTradingText(res, currency);
  if (day) return day;

  switch (res.reason) {
    case "unconfigured":
      return "Nalog nema lični dnevni cilj profita — upiši ga u Settings › Accounts (Topstep) da bi pravilo počelo da se ocenjuje.";
    case "no_trades":
      return "Nema trejdova po kojima bi se ovo pravilo ocenilo ovog dana.";
    case "no_plans":
      return "Nijedan trejd ovog dana nije planiran pre ulaza — upisan posle zatvaranja ili uvozom, pa teza pre ulaza nije mogla da postoji. Ocenjuju se samo trejdovi otvoreni iz plana.";
    case "unpriced":
      return "Trejd bez vrednosti poena — rezultat je nepoznat, pa se dan po ovom pravilu ne ocenjuje.";
    case "no_brief":
      return "Brief za ovaj dan nije stigao u journal — bez njegovih crvenih prozora pravilo nema po čemu da oceni.";
    case "market_closed":
      return "Po brief-u je berza ovog dana zatvorena — nema kraja dana po kome bi se ocenilo.";
    case "not_yet":
      return res.at
        ? `Pozicija je još otvorena — ocenjuje se posle kraja Topstep dana (${ctTime(res.at)}).`
        : "Pozicija je još otvorena — ocenjuje se posle kraja Topstep dana.";
    case "no_topstep_trades":
      return "Pravilo važi za Topstep naloge; ovog dana nije bilo Topstep trejdova.";
    case "frozen":
      return "Zamrznuto kad je dan zaključan. Ispravka trejda pomera P&L, ali ne i ocenu ovog dana.";
    case "violated":
      // Both numbers, and which of the plan's numbers the second one is.
      return res.observed != null && limit != null
        ? `Prekršeno: ${fmtMoney(res.observed, currency)} od dozvoljenih ${fmtMoney(limit, currency)}${
            res.basis ? ` (${BASIS_TEXT[res.basis]})` : ""
          }.`
        : "Prekršeno.";
    case "ok":
      return res.observed != null
        ? `U okviru limita — najgori ${fmtMoney(res.observed, currency)}.`
        : "Ispunjeno na svakom trejdu ovog dana.";
  }
}

function VerdictBadge({ res }: { res: AutoRuleResult }) {
  if (res.verdict === "pass")
    return (
      <Badge className="gap-1 shrink-0">
        <Check className="size-3" /> ispunjeno
      </Badge>
    );
  if (res.verdict === "fail")
    return (
      <Badge variant="destructive" className="gap-1 shrink-0">
        <X className="size-3" /> prekršeno
      </Badge>
    );
  return (
    <Badge variant="outline" className="gap-1 shrink-0 text-muted-foreground">
      <Minus className="size-3" /> nije ocenjeno
    </Badge>
  );
}

/**
 * The three-state control for a manual rule.
 *
 * Clicking the active button clears the answer rather than doing nothing. An
 * unanswered box and an explicit "no" are different facts: on today only the
 * explicit no breaks the day, so the user needs a way back out of an answer they
 * gave by accident.
 */
function AnswerButtons({
  value,
  disabled,
  onSet,
}: {
  value: boolean | undefined;
  disabled: boolean;
  onSet: (next: boolean | null) => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <Button
        type="button"
        size="icon"
        variant={value === true ? "default" : "outline"}
        className="size-8"
        disabled={disabled}
        aria-pressed={value === true}
        aria-label="Ispunjeno"
        title={value === true ? "Klikni ponovo da obrišeš odgovor" : "Ispunjeno"}
        onClick={() => onSet(value === true ? null : true)}
      >
        <Check className="size-4" />
      </Button>
      <Button
        type="button"
        size="icon"
        variant={value === false ? "destructive" : "outline"}
        className="size-8"
        disabled={disabled}
        aria-pressed={value === false}
        aria-label="Nije ispunjeno"
        title={
          value === false ? "Klikni ponovo da obrišeš odgovor" : "Nije ispunjeno"
        }
        onClick={() => onSet(value === false ? null : false)}
      >
        <X className="size-4" />
      </Button>
    </div>
  );
}

function ManualRow({
  rule,
  reportDate,
  answer,
  locked,
}: {
  rule: TrackerRule;
  reportDate: string;
  answer: boolean | undefined;
  locked: boolean;
}) {
  const [pending, start] = useTransition();
  // Optimistic, because the round trip is a server action and the control would
  // otherwise sit unchanged long enough to be clicked twice.
  const [local, setLocal] = useState<boolean | undefined>(answer);

  function set(next: boolean | null) {
    const previous = local;
    setLocal(next ?? undefined);
    start(async () => {
      const res = await setCheckin(rule.id, reportDate, next);
      if (!res.ok) {
        setLocal(previous);
        toast.error(res.error);
      }
      // No `router.refresh()`: `setCheckin` revalidates `/daily`, the only page
      // this checklist is on, and the action's response already carries the
      // fresh page. The refresh rendered it a second time on every tick.
    });
  }

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-md border px-3 py-2",
        local === true && "border-primary/40 bg-primary/5",
        local === false && "border-destructive/40 bg-destructive/5",
      )}
    >
      <p className="min-w-0 flex-1 text-sm">{rule.text}</p>
      {locked ? (
        <Badge variant="outline" className="gap-1 shrink-0">
          <Lock className="size-3" />
          {local === true
            ? "ispunjeno"
            : local === false
              ? "prekršeno"
              : "bez odgovora"}
        </Badge>
      ) : (
        <AnswerButtons value={local} disabled={pending} onSet={set} />
      )}
    </div>
  );
}

function AutoRow({
  rule,
  res,
  currency,
  tradeLabels,
}: {
  rule: TrackerRule;
  res: AutoRuleResult | undefined;
  currency: string;
  tradeLabels: Record<string, string>;
}) {
  return (
    <div
      className={cn(
        "rounded-md border px-3 py-2",
        res?.verdict === "pass" && "border-primary/40 bg-primary/5",
        res?.verdict === "fail" && "border-destructive/40 bg-destructive/5",
      )}
    >
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-sm">
            {rule.text}
            <Zap
              className="size-3 shrink-0 text-muted-foreground"
              aria-label="Automatsko pravilo"
            />
          </p>
          {res && (
            <p className="text-xs text-muted-foreground">
              {autoReasonText(res, currency)}
            </p>
          )}
        </div>
        {res && <VerdictBadge res={res} />}
      </div>

      {res && res.offenders.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Trejdovi:</span>
          {res.offenders.map((id) => (
            <Link
              key={id}
              href={`/trades/${id}/edit`}
              className="text-xs underline underline-offset-2 hover:no-underline"
            >
              {tradeLabels[id] ?? id.slice(0, 8)}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/** Everything a stage section needs, threaded through unchanged. */
export type TrackerDayData = {
  reportDate: string;
  /** Rules LIVE on this day — created by then, not yet retired, right weekday. */
  rules: TrackerRule[];
  auto: AutoResults;
  answers: Record<string, boolean>;
  compliance: DayCompliance;
  currency: string;
  tradeLabels: Record<string, string>;
  locked: boolean;
};

/**
 * The rules of one stage, for embedding inside the matching daily-report card.
 *
 * Renders nothing when the stage is empty, so a card the user has no rules for
 * looks exactly as it did before the tracker existed.
 *
 * Auto rules whose evaluator reached no verdict are deliberately still shown: an
 * unscored money rule has to be visible saying it has no limit, or the one thing
 * standing between the user and a working rule would be invisible.
 */
export function TrackerStageSection({
  stage,
  data,
  boxed,
}: {
  stage: TrackerStage;
  data: TrackerDayData;
  /**
   * Render inside a `<Card>` instead of as a bare block under a rule.
   *
   * This replaced a `title?: string` that chose the WRAPPER and the TEXT at
   * once. Both call sites wanting a bare block therefore passed no title and
   * fell through to a hardcoded "Process checklist" — so that one string was
   * printed twice on the same page, over `prepare` and again over `reflect`,
   * naming neither. Splitting the two jobs makes that unrepeatable: the heading
   * is always the stage's own, and this prop only picks the box.
   */
  boxed?: boolean;
}) {
  // The rules to tick first, the ones the journal scores below them — a rule
  // the trader adds lands with its own kind, whatever its `sort_order`. The
  // order the trader chose still holds inside each group.
  const inStage = data.rules
    .filter((r) => r.stage === stage)
    .sort((a, b) => Number(a.auto_key != null) - Number(b.auto_key != null));
  if (inStage.length === 0) return null;

  const rows = (
    <div className="space-y-2">
      {inStage.map((rule) =>
        rule.auto_key ? (
          <AutoRow
            key={rule.id}
            rule={rule}
            res={data.auto[rule.auto_key]}
            currency={data.currency}
            tradeLabels={data.tradeLabels}
          />
        ) : (
          // The date is in the key on purpose: the row holds an optimistic
          // answer in local state, and navigating to another day would
          // otherwise carry yesterday's tick over.
          <ManualRow
            key={`${data.reportDate}:${rule.id}`}
            rule={rule}
            reportDate={data.reportDate}
            answer={data.answers[rule.id]}
            locked={data.locked}
          />
        ),
      )}
    </div>
  );

  if (boxed) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{DAILY_STAGE_LABELS[stage]}</CardTitle>
        </CardHeader>
        <CardContent>{rows}</CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-2 border-t pt-4">
      <p className="text-sm font-medium">{DAILY_STAGE_LABELS[stage]}</p>
      {rows}
    </div>
  );
}

/** The day's compliance, for the report header. */
export function TrackerDayBadge({
  compliance,
  locked,
}: {
  compliance: DayCompliance;
  locked: boolean;
}) {
  return (
    <span className="flex items-center gap-2">
      {locked && (
        <Badge variant="outline" className="gap-1">
          <Lock className="size-3" /> zaključano
        </Badge>
      )}
      <Badge
        variant={
          compliance.status === "compliant" || compliance.status === "rest"
            ? "default"
            : compliance.status === "broken"
              ? "destructive"
              : "secondary"
        }
        title={
          compliance.status === "rest"
            ? "Označeno „Danas ne trgujem“ i nema trejda: nijedno pravilo se ne traži, dan ne ulazi u prosek."
            : compliance.applicable === 0
            ? "Nijedno pravilo se ne odnosi na ovaj dan."
            : "Dan se broji kao ispunjen samo na 100%. Pravila koja nisu ocenjena ne ulaze ni u brojilac ni u imenilac."
        }
      >
        {STATUS_LABELS[compliance.status]}
        {compliance.pct != null && (
          <span className="ml-1 font-normal opacity-80">
            {Math.round(compliance.pct)}% · {compliance.satisfied}/
            {compliance.applicable}
          </span>
        )}
      </Badge>
    </span>
  );
}
