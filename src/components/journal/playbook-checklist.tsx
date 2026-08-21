"use client";

import { useMemo } from "react";
import { Check, Minus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { gradeFromPct } from "@/lib/journal/setup-score";
import { cn } from "@/lib/utils";
import {
  RULE_CATEGORY_LABELS,
  ruleAppliesTo,
  rulesByCategory,
  type Playbook,
} from "@/lib/journal/playbook-types";

/**
 * Playbook picker plus the rule checklist.
 *
 * Answers are three-state on purpose. "Not answered" is different from "not
 * followed", and collapsing them would turn an unfinished form into a
 * discipline problem in the statistics — the one place this journal must not
 * invent a finding.
 *
 * The checklist is filtered by outcome using the SAME predicate the statistics
 * use (`ruleAppliesTo`). If the two could disagree, a rule's follow rate would
 * be measured against a population the trader was never asked about.
 */
export function PlaybookChecklist({
  playbooks,
  playbookId,
  onPlaybookChange,
  conviction,
  onConvictionChange,
  answers,
  onAnswerChange,
  netPl,
}: {
  playbooks: Playbook[];
  playbookId: string | null;
  onPlaybookChange: (id: string | null) => void;
  conviction: number | null;
  onConvictionChange: (v: number | null) => void;
  answers: Record<string, boolean>;
  onAnswerChange: (ruleId: string, followed: boolean | null) => void;
  /** Live net P&L, or null while the trade is still a plan. */
  netPl: number | null;
}) {
  const book = playbooks.find((p) => p.id === playbookId) ?? null;

  // Outcome from the live figure. Null while planned — at that point no
  // outcome-scoped rule can be answered yet, which is correct: "did you let the
  // winner run" is not a question you can answer before there is a winner.
  const outcome = useMemo<"win" | "loss" | "breakeven" | null>(() => {
    if (netPl == null) return null;
    if (netPl > 0) return "win";
    if (netPl < 0) return "loss";
    return "breakeven";
  }, [netPl]);

  // Bucketed by the rule's own category rather than by a group owned by this
  // playbook. Same reading order every time — context, entry, management, exit,
  // no-trade — so a rule sits in the same place whichever book it is linked in.
  const visibleGroups = useMemo(
    () =>
      rulesByCategory(
        (book?.rules ?? []).filter((r) => ruleAppliesTo(r.show_when, outcome)),
      ),
    [book, outcome],
  );

  const visible = useMemo(
    () => visibleGroups.flatMap((g) => g.rules),
    [visibleGroups],
  );
  const answered = visible.filter((r) => answers[r.id] !== undefined);
  const followed = answered.filter((r) => answers[r.id]).length;
  const broken = answered.length - followed;

  /**
   * The setup grade, live, from the criteria on this playbook.
   *
   * Computed here rather than read from the trade because the trade has not
   * been saved yet — the point is to see the grade move as you tick, while the
   * decision to take the trade is still open. `setupScoreFromTrade` owns the
   * bands and the refusals; this only assembles the answers it reads, so the
   * number shown here and the number the reports group by cannot diverge.
   */
  const criteria = visible.filter((r) => r.is_setup_criterion);
  const criteriaAnswered = criteria.filter((r) => answers[r.id] !== undefined);
  const criteriaMet = criteriaAnswered.filter((r) => answers[r.id]).length;
  const setupComplete =
    criteria.length > 0 && criteriaAnswered.length === criteria.length;
  const setupPct = setupComplete ? (criteriaMet / criteria.length) * 100 : null;
  const setupGrade = setupPct == null ? null : gradeFromPct(setupPct);

  /**
   * What "check remaining" is allowed to touch.
   *
   * Three exclusions, and each one is a wrong answer written into the
   * statistics if it is dropped:
   *
   *   - ANSWERED rules, either way. An explicit ✗ is something the trader
   *     entered; a bulk button must never overwrite it.
   *   - Rules outside `visible`, which is already scoped to the outcome. A
   *     winner-only rule answered while the trade is red is an observation from
   *     a population it was never asked about — `applicableAnswers` would drop
   *     it, and it would come back to life if the P&L later flipped.
   *   - RETIRED rules. The edit form loads `includeDeleted: true`, so archived
   *     rules do appear on this checklist. Minting a brand-new observation for a
   *     rule retired precisely so it would stop collecting them is what the soft
   *     delete exists to prevent. One deliberate click can still answer it; a
   *     sweep cannot.
   */
  const fillable = visible.filter(
    (r) => answers[r.id] === undefined && r.deleted_at == null,
  );

  // Answered + fillable, which is every visible rule EXCEPT the retired ones
  // nobody has answered. Leaving those in would paint a grey remainder that
  // "check remaining" is forbidden to fill — a bar that can never complete.
  const barTotal = answered.length + fillable.length;
  const pct = (part: number) => (barTotal > 0 ? (part / barTotal) * 100 : 0);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs">Playbook</Label>
          <Select
            value={playbookId ?? "none"}
            onValueChange={(v) => onPlaybookChange(v === "none" ? null : v)}
          >
            <SelectTrigger>
              <SelectValue placeholder="No playbook" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No playbook</SelectItem>
              {playbooks
                .filter((p) => p.is_active || p.id === playbookId)
                .map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Conviction (1–5)</Label>
          <Select
            value={conviction != null ? String(conviction) : "none"}
            onValueChange={(v) =>
              onConvictionChange(v === "none" ? null : Number(v))
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Not rated" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Not rated</SelectItem>
              {[1, 2, 3, 4, 5].map((v) => (
                <SelectItem key={v} value={String(v)}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {book == null ? (
        <p className="text-sm text-muted-foreground">
          Pick a playbook to get the checklist of its rules. Every rule carries
          its own statistics — that is how you see which one really carries edge
          and which one is just ritual.
        </p>
      ) : visibleGroups.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {book.rules.length > 0
            ? "No rule applies to this outcome yet."
            : "This playbook has no rules linked yet — add them under Playbooks."}
        </p>
      ) : (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-3">
              {/*
                Followed and broken are painted. THE UNANSWERED SHARE IS NOT —
                it is the bare track showing through.

                That is the whole design, and it is not a shortcut: the bar only
                ever grows when the trader gives an explicit answer, so an
                untouched checklist reads as an empty grey track and never as a
                red one. A plain followed/total bar would fill the remainder with
                "not followed", which is the one claim this journal must not make
                — everything else here, from the three-state buttons to
                `applicableAnswers`, exists to keep "not answered" and "broken"
                apart. Painting them the same would undo that in one div.

                aria-hidden, and no role="progressbar": a progressbar carries a
                single aria-valuenow, and this bar carries two independent
                quantities. The sentence below states all three numbers, which is
                the honest encoding — and is why there is no ui/progress.tsx to
                reach for.
              */}
              {criteria.length > 0 && (
                <Badge
                  variant="outline"
                  className="shrink-0 tabular-nums"
                  title={
                    setupGrade
                      ? `${criteriaMet} of ${criteria.length} setup criteria met`
                      : `${criteriaAnswered.length} of ${criteria.length} setup criteria answered — the grade needs all of them`
                  }
                >
                  {/* An em dash until every criterion is answered, never a
                      provisional letter: a grade computed from half a checklist
                      would be a verdict on a setup nobody finished judging. */}
                  Setup {setupGrade ?? "—"}
                  {setupGrade && (
                    <span className="ml-1 text-muted-foreground">
                      {criteriaMet}/{criteria.length}
                    </span>
                  )}
                </Badge>
              )}

              <div
                className="flex h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
                aria-hidden="true"
              >
                <div
                  style={{
                    width: `${pct(followed)}%`,
                    background: "var(--profit)",
                  }}
                />
                <div
                  style={{
                    width: `${pct(broken)}%`,
                    background: "var(--loss)",
                  }}
                />
              </div>

              {/* Hidden at zero rather than disabled: a button that is offered
                  and does nothing is worse than no button. The label says
                  "remaining" and not "all" because it deliberately does not
                  touch an answered rule. */}
              {fillable.length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 shrink-0 px-2 text-xs"
                  onClick={() => {
                    for (const r of fillable) onAnswerChange(r.id, true);
                  }}
                  title="Marks the rules you have not answered as followed. An explicit ✗ is never overwritten."
                >
                  Check remaining ({fillable.length})
                </Button>
              )}
            </div>

            <div className="text-xs text-muted-foreground">
              Followed {followed} of {answered.length} answered
              {fillable.length > 0 && ` · ${fillable.length} not answered`}
              {answered.length === 0 && " — unanswered does not count toward the statistics"}
            </div>
          </div>

          {visibleGroups.map((group) => (
            <div key={group.category} className="space-y-1.5">
              <h4 className="text-xs font-semibold text-muted-foreground">
                {RULE_CATEGORY_LABELS[group.category]}
              </h4>
              {group.rules.map((rule) => {
                const value = answers[rule.id];
                return (
                  <div
                    key={rule.id}
                    className="flex items-center gap-2 rounded-md border px-2 py-1.5"
                  >
                    <span className="min-w-0 flex-1 text-sm">{rule.text}</span>
                    <div className="flex shrink-0 rounded-md border p-0.5">
                      <TriButton
                        active={value === true}
                        onClick={() =>
                          onAnswerChange(rule.id, value === true ? null : true)
                        }
                        label="Followed"
                        tone="profit"
                      >
                        <Check className="size-3.5" />
                      </TriButton>
                      <TriButton
                        active={value === undefined}
                        onClick={() => onAnswerChange(rule.id, null)}
                        label="Unanswered"
                      >
                        <Minus className="size-3.5" />
                      </TriButton>
                      <TriButton
                        active={value === false}
                        onClick={() =>
                          onAnswerChange(rule.id, value === false ? null : false)
                        }
                        label="Broken"
                        tone="loss"
                      >
                        <X className="size-3.5" />
                      </TriButton>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TriButton({
  active,
  onClick,
  label,
  tone,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  tone?: "profit" | "loss";
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={cn(
        "rounded px-2 py-1 text-muted-foreground transition-colors",
        active && tone === "profit" && "bg-[var(--profit)]/15 text-[var(--profit)]",
        active && tone === "loss" && "bg-[var(--loss)]/15 text-[var(--loss)]",
        active && !tone && "bg-muted text-foreground",
      )}
    >
      {children}
    </button>
  );
}
