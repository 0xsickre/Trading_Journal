"use client";

import { useState, useTransition } from "react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  AUTO_RULES_NEEDING_PCT,
  ISO_WEEKDAYS,
  STAGE_LABELS,
  TRACKER_STAGES,
  WEEKDAY_LABELS,
  type TrackerRule,
  type TrackerStage,
} from "@/lib/journal/tracker-types";
import {
  addTrackerRule,
  clearTrackerRuleLimit,
  deleteTrackerRule,
  moveTrackerRule,
  restoreTrackerRule,
  updateTrackerRule,
} from "@/app/(app)/settings/tracker-actions";

// Every tracker action revalidates /settings itself, so no router.refresh().
function useAction() {
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) toast.error(res.error ?? "Failed");
      else after?.();
    });
  return { pending, run };
}

/**
 * Weekday toggles. The last day on cannot be switched off: a rule with no day
 * is a retired rule, and retiring has its own button and its own question.
 */
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
      {/* Monday to Friday only — nothing is scored at the weekend. */}
      {ISO_WEEKDAYS.filter((d) => d <= 5).map((d) => {
        const on = days.includes(d);
        const last = on && days.length === 1;
        return (
          <button
            key={d}
            type="button"
            disabled={disabled || last}
            aria-pressed={on}
            aria-label={WEEKDAY_LABELS[d]}
            title={last ? "A rule needs at least one day" : WEEKDAY_LABELS[d]}
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

function RuleRow({
  rule,
  isFirst = false,
  isLast = false,
}: {
  rule: TrackerRule;
  isFirst?: boolean;
  isLast?: boolean;
}) {
  const { pending, run } = useAction();
  const [text, setText] = useState(rule.text);
  const [confirming, setConfirming] = useState(false);
  const [pct, setPct] = useState(
    rule.config.pct != null ? String(rule.config.pct) : "",
  );

  const retired = rule.deleted_at != null;
  const isAuto = rule.auto_key != null;
  const needsPct = rule.auto_key != null && AUTO_RULES_NEEDING_PCT.has(rule.auto_key);
  const unconfigured = needsPct && rule.config.pct == null;

  function savePct() {
    const raw = pct.trim();
    if (raw === "") {
      if (rule.config.pct != null) run(() => clearTrackerRuleLimit(rule.id));
      return;
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) {
      toast.error("The limit must be a positive number.");
      return;
    }
    // Mirrors the server schema. Said here too so a typo is caught before a
    // round trip, and said in the same words so the two never disagree.
    if (n > 100) {
      toast.error("A limit above 100 % of equity is not a limit.");
      return;
    }
    if (n === rule.config.pct) return;
    run(() => updateTrackerRule(rule.id, { config: { pct: n } }));
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
        aria-label="Rule"
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          // Emptied and left: the rule keeps its text rather than showing a
          // blank box that was never saved.
          if (!text.trim()) setText(rule.text);
          else if (text !== rule.text) run(() => updateTrackerRule(rule.id, { text }));
        }}
        className="h-8 min-w-0 flex-1"
        disabled={pending || retired || isAuto}
        title={isAuto ? "An automatic rule's text is fixed." : undefined}
      />

      {isAuto && (
        <Badge variant="outline" className="gap-1 shrink-0">
          <Zap className="size-3" /> Auto
        </Badge>
      )}

      {needsPct && (
        <div className="flex shrink-0 items-center gap-1">
          <Input
            inputMode="decimal"
            value={pct}
            onChange={(e) => setPct(e.target.value)}
            onBlur={savePct}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            placeholder="Limit"
            aria-label="Limit, % of equity"
            className={cn("h-8 w-20", unconfigured && "border-amber-500/60")}
            disabled={pending || retired}
          />
          {/* "% of equity", not just "%": the number is meaningless without its
              basis, and the basis is the balance the DAY OPENED with — see
              `equity-ladder.ts`. */}
          <span className="text-xs text-muted-foreground">% of equity</span>
        </div>
      )}

      <DayToggles
        days={rule.active_days}
        disabled={pending || retired}
        onChange={(next) => run(() => updateTrackerRule(rule.id, { active_days: next }))}
      />

      {rule.is_mandatory && (
        <Badge variant="outline" className="gap-1 shrink-0">
          <Lock className="size-3" /> Required
        </Badge>
      )}
      {retired && <Badge variant="outline">Retired</Badge>}

      <div className="ml-auto flex shrink-0 items-center gap-1">
        {!retired && (
          <>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              disabled={pending || isFirst}
              onClick={() => run(() => moveTrackerRule(rule.id, -1))}
              aria-label="Move up"
            >
              <ChevronUp className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              disabled={pending || isLast}
              onClick={() => run(() => moveTrackerRule(rule.id, 1))}
              aria-label="Move down"
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
          onClick={() => setConfirming(true)}
          aria-label={retired ? "Restore rule" : "Retire rule"}
          title={retired ? "Restore rule" : "Retire rule"}
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
          Not scored until a limit is set.
        </p>
      )}

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{retired ? "Restore this rule?" : "Retire this rule?"}</DialogTitle>
            <DialogDescription>
              {retired
                ? `"${rule.text}" goes back on the checklist, and the days it was retired for are scored again.`
                : `"${rule.text}" leaves the checklist. Past days keep their score.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirming(false)} disabled={pending}>
              Cancel
            </Button>
            <Button
              variant={retired ? "default" : "destructive"}
              disabled={pending}
              onClick={() =>
                run(
                  () => (retired ? restoreTrackerRule(rule.id) : deleteTrackerRule(rule.id)),
                  () => setConfirming(false),
                )
              }
            >
              {retired ? "Restore" : "Retire"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AddRuleForm({ stage }: { stage: TrackerStage }) {
  const { pending, run } = useAction();
  const [text, setText] = useState("");
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);

  function submit() {
    if (!text.trim()) return;
    run(
      () => addTrackerRule({ text, stage, active_days: days }),
      () => {
        setText("");
        setDays([1, 2, 3, 4, 5]);
      },
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed p-2">
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
        placeholder="New rule…"
        aria-label={`New ${STAGE_LABELS[stage].toLowerCase()} rule`}
        className="h-8 min-w-0 flex-1"
        disabled={pending}
      />
      <DayToggles days={days} disabled={pending} onChange={setDays} />
      <Button size="sm" className="h-8" onClick={submit} disabled={pending || !text.trim()}>
        <Plus className="size-3.5" /> Add
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
// No `currency` any more: the limits are percentages of equity, so this screen
// no longer states an amount in money. The figure a percentage works out to on
// a given day is shown where it means something — on the daily checklist, from
// the evaluator that knows that day's opening balance.
export function TrackerRuleManager({ rules }: { rules: TrackerRule[] }) {
  const live = rules.filter((r) => r.deleted_at == null);
  const retired = rules.filter((r) => r.deleted_at != null);
  const unconfigured = live.filter(
    (r) => r.auto_key != null && AUTO_RULES_NEEDING_PCT.has(r.auto_key) && r.config.pct == null,
  ).length;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Your daily rules, by stage. <b>Auto</b> rules are scored from your trades.
      </p>

      {unconfigured > 0 && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-sm text-amber-700 dark:text-amber-400">
          {unconfigured}{" "}
          {unconfigured === 1 ? "rule has no" : "rules have no"} limit set, so{" "}
          {unconfigured === 1 ? "it is" : "they are"} not scored.
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
                  {inStage.length} {inStage.length === 1 ? "rule" : "rules"}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {inStage.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No rules in this stage.
                </p>
              )}
              {inStage.map((rule, i) => (
                <RuleRow
                  key={rule.id}
                  rule={rule}
                  isFirst={i === 0}
                  isLast={i === inStage.length - 1}
                />
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
              Retired rules
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                {retired.length}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {retired.map((rule) => (
              <RuleRow key={rule.id} rule={rule} />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
