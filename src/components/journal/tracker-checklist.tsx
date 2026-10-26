"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Check, Lock, Minus, X, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { DEFAULT_TZ, fmtInTz } from "@/lib/journal/time";
import {
  type TrackerRule,
  type TrackerStage,
} from "@/lib/journal/tracker-types";
import type { AutoRuleResult } from "@/lib/journal/tracker/auto-rules";
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

/** Phase Q rules, whose `not_yet` means the trade is still open, not the trading day. */
const REVIEW_KEYS: ReadonlySet<string> = new Set([
  "daily_psychology",
  "htf_bias_set",
  "thesis_recorded",
  "honest_tags",
  "review_complete",
  "screenshot_per_trade",
]);

/** A close time on the trader's clock (phase N: Belgrade, never CT). */
const closeTime = (iso: string) => fmtInTz(iso, DEFAULT_TZ, "HH:mm");

/**
 * The verdict of a rule in its own words: a time, a window, a run of stops.
 * Null for the reasons the generic text already says right.
 */
function dayTradingText(res: AutoRuleResult): string | null {
  const verdict = res.reason === "violated" || res.reason === "ok";
  if (!verdict) return null;
  const broke = res.reason === "violated";
  switch (res.key) {
    case "stop_after_two_losses":
      if (!res.counted) return null;
      return broke
        ? `Prekršeno: ulaz posle ${res.counted.observed} SL zaredom — dan je bio gotov.`
        : `U okviru — najduži niz SL pre ulaza: ${res.counted.observed} od ${res.counted.limit}.`;
    case "flat_by_close":
      if (!res.at) return null;
      return broke
        ? `Prekršeno: pozicija otvorena posle vremena „ravno do“ (${closeTime(res.at)}).`
        : `Sve pozicije zatvorene do vremena „ravno do“ (${closeTime(res.at)}).`;
    case "no_entry_in_red_window":
      return broke
        ? `Prekršeno: ulaz u crvenom prozoru${res.window ? ` (${res.window})` : ""}.`
        : "Nijedan ulaz u crvenom prozoru brief-a.";
    // Phase Y4: the day's window, Belgrade time.
    case "trading_window": {
      if (!res.window) return null;
      const to = res.window.split("–")[1];
      return broke
        ? `Prekršeno: ulaz van prozora ${res.window} ili pozicija otvorena posle ${to} (po Beogradu).`
        : `Svi ulazi i izlazi u prozoru ${res.window} (po Beogradu).`;
    }
    // Phase Y: a playbook written after the entry fails like a missing one.
    case "playbook_linked": {
      if (!broke) return "Svaki trejd vezan za playbook koji je postojao pre ulaza.";
      const late = res.lateLinks?.length ?? 0;
      if (late === 0) return null;
      return late === res.offenders.length
        ? "Prekršeno: playbook napravljen posle ulaza — tada nije bio plan."
        : "Prekršeno: trejd bez playbook-a, ili playbook napravljen posle ulaza.";
    }
    // Phase Q: read off the trade page, so the fix is on the trade the link opens.
    // Phase D: from 19.10.2026 the bias is the card above, set before the entry.
    case "htf_bias_set":
      return broke
        ? "Bias dana nije upisan na kartici pre ulaza (za taj instrument), ili na starijem trejdu piše „Nisam odredio unapred“."
        : "Bias dana upisan pre ulaza za svaki trejd.";
    case "thesis_recorded":
      return broke
        ? "Na trejdu nije upisano šta si rekao pre klika."
        : "Na svakom trejdu upisano šta si rekao pre klika.";
    case "review_complete":
      return broke
        ? "Trejdu fali ocena, razlog izlaza, bias dana, greška (kad ocena nije A) ili rečenica (uz ocenu C)."
        : "Svaki trejd ima ocenu, razlog izlaza, bias dana i grešku ili ocenu A; uz C i rečenicu.";
    case "screenshot_per_trade":
      return broke
        ? "Fali slika charta: trejd sa ocenom C, ili najbolji ili najgori trejd dana."
        : "Slika charta je na C trejdovima i na najboljem i najgorem trejdu dana.";
    case "daily_psychology":
      return broke
        ? "Psihologija dana nije upisana na kartici „Zatvaranje dana“."
        : "Psihologija dana upisana.";
    case "honest_tags":
      return broke
        ? "Tag se ne slaže sa automatskim pravilom na istom trejdu: „Ispoštovao rizik“ bez stopa, ocena A uz prekršeno pravilo, ili „Vodio po planu“ bez playbook-a pre ulaza."
        : "Nijedan tag se ne sukobljava sa automatskim pravilima.";
    default:
      return null;
  }
}

/**
 * Why an auto rule reached its verdict.
 *
 * Every branch says what to DO about it, because the two most common states are
 * both actionable and neither is a failure: `unconfigured` means you never set a
 * window, `no_trades` means the rule had nothing to judge.
 */
function autoReasonText(res: AutoRuleResult): string {
  const day = dayTradingText(res);
  if (day) return day;

  switch (res.reason) {
    case "unconfigured":
      return "Za ovaj dan nije upisan prozor trgovanja — upiši od–do (po Beogradu) u Settings › Tracker.";
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
      if (REVIEW_KEYS.has(res.key)) return "Trejd je još otvoren — pregled se ocenjuje posle izlaza.";
      return res.at
        ? `Pozicija je još otvorena — ocenjuje se posle vremena „ravno do“ (${closeTime(res.at)}).`
        : "Pozicija je još otvorena — ocenjuje se posle vremena „ravno do“.";
    case "frozen":
      return "Zamrznuto kad je dan zaključan. Ispravka trejda pomera P&L, ali ne i ocenu ovog dana.";
    case "violated":
      return "Prekršeno.";
    case "ok":
      return "Ispunjeno na svakom trejdu ovog dana.";
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
  tradeLabels,
}: {
  rule: TrackerRule;
  res: AutoRuleResult | undefined;
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
              {autoReasonText(res)}
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
              href={`/trades/${id}?from=daily`}
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
 * unscored rule has to be visible saying why (no window set, no brief), or the
 * one thing standing between the user and a working rule would be invisible.
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
