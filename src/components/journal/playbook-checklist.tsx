"use client";

import { useMemo } from "react";
import { Check, Minus, X } from "lucide-react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { ruleAppliesTo, type Playbook } from "@/lib/journal/playbook-types";

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

  const visibleGroups = useMemo(
    () =>
      (book?.groups ?? [])
        .map((g) => ({
          ...g,
          rules: g.rules.filter((r) => ruleAppliesTo(r.show_when, outcome)),
        }))
        .filter((g) => g.rules.length > 0),
    [book, outcome],
  );

  const answered = visibleGroups
    .flatMap((g) => g.rules)
    .filter((r) => answers[r.id] !== undefined);
  const followed = answered.filter((r) => answers[r.id]).length;

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
              <SelectValue placeholder="Bez playbook-a" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Bez playbook-a</SelectItem>
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
          <Label className="text-xs">Uverenost (1–5)</Label>
          <Select
            value={conviction != null ? String(conviction) : "none"}
            onValueChange={(v) =>
              onConvictionChange(v === "none" ? null : Number(v))
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Neocenjeno" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Neocenjeno</SelectItem>
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
          Pick a playbook to get the checklist of its rules. Every rule carries its
          own statistics — that is how you see which one really carries edge and which
          je samo ritual.
        </p>
      ) : visibleGroups.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {book.groups.some((g) => g.rules.length > 0)
            ? "No rule applies to this outcome yet."
            : "This playbook has no rules yet — add them in Settings."}
        </p>
      ) : (
        <div className="space-y-4">
          <div className="text-xs text-muted-foreground">
            Followed {followed} of {answered.length} answered
            {answered.length === 0 && " — neodgovoreno se ne broji u statistiku"}
          </div>

          {visibleGroups.map((group) => (
            <div key={group.id} className="space-y-1.5">
              <h4 className="text-xs font-semibold text-muted-foreground">
                {group.name}
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
                        label="Neodgovoreno"
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
