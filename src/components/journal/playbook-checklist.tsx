"use client";

import { useMemo } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
import type { OptionItem } from "@/lib/journal/types";
import { gradeFromPct } from "@/lib/journal/setup-score";
import { cn } from "@/lib/utils";
import {
  ruleCategoryLabel,
  ruleAppliesTo,
  rulesByCategory,
  type Playbook,
} from "@/lib/journal/playbook-types";

/**
 * Playbook picker plus the rule checklist.
 *
 * ONE TICK PER RULE. Ticked means the rule was kept, unticked means it was not
 * — there is no third "not answered" state.
 *
 * It used to have one, with a ✓ / — / ✗ trio per rule, on the argument that an
 * unfinished form must not be read as a discipline problem. What that produced
 * in practice was a checklist reporting 100 % adherence with one box ticked and
 * seven left grey, because the ratio was over ANSWERED rules — a number that
 * flatters exactly when it should not. Since every rule on the list is one the
 * trader wrote and the outcome filter already removes the ones that do not
 * apply, "I did not tick it" is a real answer, and the honest reading of it is
 * "not kept".
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
  categories = [],
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
  /** The trader's own playbook sections, from the `rule_category` option list. */
  categories?: readonly OptionItem[];
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
        categories.map((c) => c.value),
      ),
    [book, outcome, categories],
  );

  const visible = useMemo(
    () => visibleGroups.flatMap((g) => g.rules),
    [visibleGroups],
  );
  /**
   * The rules this trade is judged on.
   *
   * Every applicable rule, EXCEPT a retired one nobody answered. The edit form
   * loads `includeDeleted: true`, so archived rules do appear here — and an
   * unticked box now means "broken", so counting one would mint a fresh
   * observation for a rule retired precisely to stop collecting them. One that
   * already carries an answer stays, because that answer is history.
   */
  const gradable = visible.filter(
    (r) => r.deleted_at == null || answers[r.id] !== undefined,
  );
  const followed = gradable.filter((r) => answers[r.id] === true).length;
  const broken = gradable.length - followed;

  /**
   * Adherence, as one number.
   *
   * The tick is the whole answer: checked means kept, unchecked means not kept.
   * There is no third state, so the denominator is every rule that applied —
   * which is what makes "one of eight ticked" read 13 % instead of the 100 % a
   * followed-over-answered ratio used to show while seven boxes sat untouched.
   *
   * Null when no rule applies at all — a percentage of nothing is not 0 %.
   */
  const followPct =
    gradable.length > 0 ? Math.round((followed / gradable.length) * 100) : null;

  /**
   * The setup grade, live, from the criteria on this playbook.
   *
   * Computed here rather than read from the trade because the trade has not
   * been saved yet — the point is to see the grade move as you tick, while the
   * decision to take the trade is still open. `setupScoreFromTrade` owns the
   * bands and the refusals; this only assembles the answers it reads, so the
   * number shown here and the number the reports group by cannot diverge.
   */
  const criteria = gradable.filter((r) => r.is_setup_criterion);
  const criteriaMet = criteria.filter((r) => answers[r.id] === true).length;
  // No "answered them all yet" gate any more: with a single tick per rule every
  // criterion always has an answer, so the grade is complete as soon as there
  // are criteria to compute it from.
  const setupPct =
    criteria.length > 0 ? (criteriaMet / criteria.length) * 100 : null;
  const setupGrade = setupPct == null ? null : gradeFromPct(setupPct);

  /**
   * What "check all" is allowed to touch.
   *
   * Everything gradable that is not already ticked. Retired rules are outside
   * `gradable` unless they already carry an answer, for the reason given there,
   * so a sweep can never mint an observation for one.
   */
  const fillable = gradable.filter((r) => answers[r.id] !== true);

  const pct = (part: number) =>
    gradable.length > 0 ? (part / gradable.length) * 100 : 0;

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
              {criteria.length > 0 && (
                <Badge
                  variant="outline"
                  className="shrink-0 tabular-nums"
                  title={`${criteriaMet} of ${criteria.length} setup criteria met`}
                >
                  Setup {setupGrade ?? "—"}
                  {setupGrade && (
                    <span className="ml-1 text-muted-foreground">
                      {criteriaMet}/{criteria.length}
                    </span>
                  )}
                </Badge>
              )}

              {/* The number the bar is drawing, said out loud. The bar shows
                  the split; this is what you actually quote to yourself. */}
              {followPct != null && (
                <span
                  className="shrink-0 text-sm font-semibold tabular-nums"
                  title={`${followed} of ${gradable.length} rules followed`}
                >
                  {followPct}%
                </span>
              )}

              {/*
                Kept as green and red rather than one fill on a bare track,
                because there is no third quantity left to leave unpainted: a
                box is ticked or it is not. The bar and the sentence below say
                the same two numbers.

                aria-hidden, and no role="progressbar": a progressbar carries a
                single aria-valuenow, and this carries two. The sentence is the
                accessible encoding, which is why there is no ui/progress.tsx to
                reach for.
              */}
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
                  and does nothing is worse than no button. */}
              {fillable.length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 shrink-0 px-2 text-xs"
                  onClick={() => {
                    for (const r of fillable) onAnswerChange(r.id, true);
                  }}
                  title="Ticks every rule that is not ticked yet."
                >
                  Check all ({fillable.length})
                </Button>
              )}
            </div>

            <div className="text-xs text-muted-foreground">
              Followed {followed} of {gradable.length}
              {broken > 0 && ` · ${broken} not followed`}
            </div>
          </div>

          {visibleGroups.map((group) => (
            <div key={group.category} className="space-y-1.5">
              <h4 className="text-xs font-semibold text-muted-foreground">
                {ruleCategoryLabel(group.category, categories)}
              </h4>
              {group.rules.map((rule) => {
                const checked = answers[rule.id] === true;
                return (
                  // The whole row is the control. A checklist is ticked in a
                  // hurry, and a 16px box is a smaller target than the sentence
                  // next to it — which is what people aim at anyway.
                  <label
                    key={rule.id}
                    className={cn(
                      "flex cursor-pointer items-center gap-2.5 rounded-md border px-2.5 py-2",
                      checked ? "bg-[var(--profit)]/5" : "hover:bg-accent/40",
                    )}
                  >
                    <Checkbox
                      checked={checked}
                      // Always a boolean, never null. One tick carries the whole
                      // answer now: ticked is kept, unticked is not kept.
                      onCheckedChange={(v) => onAnswerChange(rule.id, v === true)}
                    />
                    <span className="min-w-0 flex-1 text-sm">{rule.text}</span>
                  </label>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

