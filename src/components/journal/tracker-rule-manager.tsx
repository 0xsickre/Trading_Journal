"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArchiveRestore,
  ChevronDown,
  ChevronUp,
  Lock,
  Plus,
  Trash2,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  AUTO_RULES_NEEDING_AMOUNT,
  ISO_WEEKDAYS,
  STAGE_LABELS,
  TRACKER_STAGES,
  WEEKDAY_LABELS,
  type TrackerRule,
  type TrackerStage,
} from "@/lib/journal/tracker-types";
import {
  addTrackerRule,
  clearTrackerRuleAmount,
  deleteTrackerRule,
  moveTrackerRule,
  restoreTrackerRule,
  updateTrackerRule,
} from "@/app/(app)/settings/tracker-actions";

function useAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) toast.error(res.error ?? "Nije uspelo");
      else router.refresh();
    });
  return { pending, run };
}

/** Weekday toggles. Empty is refused by the action — a rule with no day is retired. */
function DayToggles({
  days,
  disabled,
  onChange,
}: {
  days: number[];
  disabled: boolean;
  onChange: (next: number[]) => void;
}) {
  return (
    <div className="flex shrink-0 gap-0.5">
      {ISO_WEEKDAYS.map((d) => {
        const on = days.includes(d);
        return (
          <button
            key={d}
            type="button"
            disabled={disabled}
            aria-pressed={on}
            title={WEEKDAY_LABELS[d]}
            onClick={() =>
              onChange(on ? days.filter((x) => x !== d) : [...days, d].sort())
            }
            className={cn(
              "rounded border px-1.5 py-0.5 text-[11px] transition-colors",
              on
                ? "border-primary bg-primary text-primary-foreground"
                : "text-muted-foreground",
            )}
          >
            {WEEKDAY_LABELS[d]}
          </button>
        );
      })}
    </div>
  );
}

function RuleRow({ rule, currency }: { rule: TrackerRule; currency: string }) {
  const { pending, run } = useAction();
  const [text, setText] = useState(rule.text);
  const [amount, setAmount] = useState(
    rule.config.amount != null ? String(rule.config.amount) : "",
  );

  const retired = rule.deleted_at != null;
  const isAuto = rule.auto_key != null;
  const needsAmount = rule.auto_key != null && AUTO_RULES_NEEDING_AMOUNT.has(rule.auto_key);
  const unconfigured = needsAmount && rule.config.amount == null;

  function saveAmount() {
    const raw = amount.trim();
    if (raw === "") {
      if (rule.config.amount != null) run(() => clearTrackerRuleAmount(rule.id));
      return;
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) {
      toast.error("Limit mora biti pozitivan broj.");
      return;
    }
    if (n === rule.config.amount) return;
    run(() => updateTrackerRule(rule.id, { config: { amount: n } }));
  }

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-md border px-2 py-1.5",
        retired && "opacity-60",
      )}
    >
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (text.trim() && text !== rule.text)
            run(() => updateTrackerRule(rule.id, { text }));
        }}
        className="h-8 min-w-0 flex-1"
        disabled={pending || retired || isAuto}
        title={isAuto ? "Tekst automatskog pravila je fiksan." : undefined}
      />

      {isAuto && (
        <Badge variant="outline" className="gap-1 shrink-0">
          <Zap className="size-3" /> auto
        </Badge>
      )}

      {needsAmount && (
        <div className="flex shrink-0 items-center gap-1">
          <Input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            onBlur={saveAmount}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            placeholder="limit"
            className={cn("h-8 w-24", unconfigured && "border-amber-500/60")}
            disabled={pending || retired}
          />
          <span className="text-xs text-muted-foreground">{currency}</span>
        </div>
      )}

      <DayToggles
        days={rule.active_days}
        disabled={pending || retired}
        onChange={(next) => run(() => updateTrackerRule(rule.id, { active_days: next }))}
      />

      {rule.is_mandatory && (
        <Badge variant="outline" className="gap-1 shrink-0">
          <Lock className="size-3" /> obavezno
        </Badge>
      )}
      {retired && <Badge variant="outline">penzionisano</Badge>}

      <div className="ml-auto flex shrink-0 items-center gap-1">
        {!retired && (
          <>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              disabled={pending}
              onClick={() => run(() => moveTrackerRule(rule.id, -1))}
              aria-label="Pomeri gore"
            >
              <ChevronUp className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              disabled={pending}
              onClick={() => run(() => moveTrackerRule(rule.id, 1))}
              aria-label="Pomeri dole"
            >
              <ChevronDown className="size-3.5" />
            </Button>
          </>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          disabled={pending}
          onClick={() =>
            run(() => (retired ? restoreTrackerRule(rule.id) : deleteTrackerRule(rule.id)))
          }
          aria-label={retired ? "Vrati pravilo" : "Penzioniši pravilo"}
          title={
            retired
              ? "Vrati na čeklistu. Dani dok je bilo penzionisano postaju ponovo ocenjeni."
              : "Sklanja se sa čekliste. Doslednost prošlih dana ostaje netaknuta."
          }
        >
          {retired ? (
            <ArchiveRestore className="size-3.5" />
          ) : (
            <Trash2 className="size-3.5" />
          )}
        </Button>
      </div>

      {unconfigured && (
        <p className="w-full text-xs text-amber-600 dark:text-amber-500">
          Bez limita ovo pravilo se ne ocenjuje — ni pozitivno ni negativno.
          Postavi iznos da počne da radi.
        </p>
      )}
    </div>
  );
}

function AddRuleForm({ stage }: { stage: TrackerStage }) {
  const { pending, run } = useAction();
  const [text, setText] = useState("");
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);

  function submit() {
    if (!text.trim()) return;
    run(async () => {
      const res = await addTrackerRule({ text, stage, active_days: days });
      if (res.ok) setText("");
      return res;
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed p-2">
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
        placeholder="Novo pravilo…"
        className="h-8 min-w-0 flex-1"
        disabled={pending}
      />
      <DayToggles days={days} disabled={pending} onChange={setDays} />
      <Button size="sm" className="h-8" onClick={submit} disabled={pending}>
        <Plus className="size-3.5" /> Dodaj
      </Button>
    </div>
  );
}

/**
 * CRUD for tracker rules.
 *
 * Two things run through the whole screen, both so that editing configuration
 * can never rewrite history:
 *
 *   - a rule that has been answered is RETIRED, never deleted. Compliance
 *     decides applicability by comparing each day against `deleted_at`, so a
 *     hard delete would erase the denominator of every past day the rule was
 *     live on and silently raise those scores.
 *   - `auto_key` is not editable at all. It picks which evaluator runs, so
 *     changing it would re-interpret every check-in already recorded.
 */
export function TrackerRuleManager({
  rules,
  currency = "USD",
}: {
  rules: TrackerRule[];
  currency?: string;
}) {
  const live = rules.filter((r) => r.deleted_at == null);
  const retired = rules.filter((r) => r.deleted_at != null);
  const unconfigured = live.filter(
    (r) => r.auto_key != null && AUTO_RULES_NEEDING_AMOUNT.has(r.auto_key) && r.config.amount == null,
  ).length;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Pravila procesa po fazi dana. Označena kao <b>auto</b> baza ocenjuje sama
        iz trejdova — njih ne čekiraš rukom. Dani biraju kada pravilo važi;
        vikend koji isključiš ne prekida niz.
      </p>

      {unconfigured > 0 && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-sm text-amber-700 dark:text-amber-400">
          {unconfigured}{" "}
          {unconfigured === 1 ? "pravilo nema" : "pravila nemaju"} postavljen limit
          i zato se ne ocenjuje. Namerno nije seed-ovan podrazumevani iznos —
          limit koji nisi sam izabrao je limit koji ćeš prolaziti ne primetivši.
        </p>
      )}

      {TRACKER_STAGES.map((stage) => {
        const inStage = live.filter((r) => r.stage === stage);
        return (
          <Card key={stage}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                {STAGE_LABELS[stage]}
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  {inStage.length} {inStage.length === 1 ? "pravilo" : "pravila"}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {inStage.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {stage === "reflect"
                    ? "Nema pravila za osvrt. Ovde ide ono što radiš posle zatvaranja — pregled dana, beleška, ocena."
                    : "Nema pravila u ovoj fazi."}
                </p>
              )}
              {inStage.map((rule) => (
                <RuleRow key={rule.id} rule={rule} currency={currency} />
              ))}
              <AddRuleForm stage={stage} />
            </CardContent>
          </Card>
        );
      })}

      {retired.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              Penzionisana pravila
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                statistika starih dana ostaje netaknuta
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {retired.map((rule) => (
              <RuleRow key={rule.id} rule={rule} currency={currency} />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
