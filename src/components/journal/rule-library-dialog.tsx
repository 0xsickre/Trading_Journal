"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  SHOW_WHEN_LABELS,
  type PlaybookRule,
  type PlaybookSection,
} from "@/lib/journal/playbook-types";
import { deletePlaybookRule, linkRule } from "@/app/(app)/settings/playbook-actions";

/**
 * Pick a rule you have already written and file it into THIS section.
 *
 * The library is a set of suggestions, not a fixed filing. A rule written for
 * one playbook can be linked into any other, under any heading that playbook
 * has — the section is a property of the LINK, so the same sentence can be an
 * entry condition in one book and an exit condition in another while keeping
 * one id and therefore one set of statistics.
 *
 * Replaces the "Or reuse:" strip of buttons on the section card. That strip
 * filtered by `rule.category === category`, so it could only ever offer a rule
 * back into the heading it was already under — the exact restriction being
 * removed. Unfiltered, the list is long enough to need a search box, which is
 * why this is a dialog and not a row.
 *
 * Stays OPEN after a pick, and the picked row goes on showing a tick. Filing
 * four rules into a fresh section is one visit, not four.
 */
export function RuleLibraryDialog({
  playbookId,
  section,
  available,
  open,
  onOpenChange,
  linkedRuleIds = [],
}: {
  playbookId: string;
  section: PlaybookSection;
  /** Library rules this playbook does not already link, in library order. */
  available: readonly PlaybookRule[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Every rule some playbook links. None of them may be deleted from here —
   * a rule another setup still checks is not spare, even with no answers yet.
   */
  linkedRuleIds?: readonly string[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [query, setQuery] = useState("");
  /**
   * Linked during THIS visit.
   *
   * Kept locally rather than read back from `available`: the server action
   * refreshes the route, but the refreshed props do not arrive on the same
   * tick, and a row that vanished the instant it was clicked would give no
   * confirmation that anything happened. The tick is that confirmation, and it
   * survives until the dialog is reopened.
   */
  const [linked, setLinked] = useState<string[]>([]);
  /** Deleted during this visit — hidden at once, before the refresh lands. */
  const [deleted, setDeleted] = useState<string[]>([]);
  /** The row whose bin was pressed once and now asks to be pressed again. */
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const live = available.filter((r) => !deleted.includes(r.id));
    if (!q) return live;
    return live.filter((r) => r.text.toLowerCase().includes(q));
  }, [available, query, deleted]);

  /**
   * Delete a rule no trade has answered.
   *
   * Offered only for a rule that is truly spare: no trade has answered it (an
   * answered rule carries statistics), and no playbook uses it. The bin still
   * asks twice — a deleted rule cannot be brought back.
   */
  const linkedSet = useMemo(() => new Set(linkedRuleIds), [linkedRuleIds]);

  function remove(rule: PlaybookRule) {
    if (confirmId !== rule.id) {
      setConfirmId(rule.id);
      return;
    }
    setConfirmId(null);
    start(async () => {
      const res = await deletePlaybookRule(rule.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setDeleted((ids) => [...ids, rule.id]);
      router.refresh();
    });
  }

  function pick(rule: PlaybookRule) {
    if (linked.includes(rule.id)) return;
    start(async () => {
      const res = await linkRule(playbookId, rule.id, section.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setLinked((ids) => [...ids, rule.id]);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Reuse a rule in „{section.label}“</DialogTitle>
          <DialogDescription>
            Every rule you have written that this playbook does not use yet. A
            linked rule keeps its id, so the statistics it has already collected
            keep accumulating under it — which a retyped copy would split in two.
          </DialogDescription>
        </DialogHeader>

        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your rules…"
          aria-label="Search your rules"
          autoFocus
        />

        <div className="max-h-80 space-y-1 overflow-y-auto">
          {matches.length === 0 ? (
            <p className="px-1 py-3 text-sm text-muted-foreground">
              {available.length === 0
                ? "This playbook already uses every rule you have written."
                : "No rule matches that."}
            </p>
          ) : (
            matches.map((rule) => {
              const done = linked.includes(rule.id);
              const deletable =
                rule.answerCount === 0 && !done && !linkedSet.has(rule.id);
              const asking = confirmId === rule.id;
              return (
                <div key={rule.id} className="flex items-stretch gap-1">
                <button
                  type="button"
                  role="option"
                  aria-selected={done}
                  disabled={pending || done}
                  onClick={() => pick(rule)}
                  className={cn(
                    "flex min-w-0 flex-1 items-center gap-2 rounded-md border px-2.5 py-2 text-left text-sm",
                    done ? "bg-[var(--profit)]/5" : "hover:bg-accent/60",
                  )}
                >
                  <Check
                    className={cn(
                      "size-4 shrink-0",
                      done ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="min-w-0 flex-1">{rule.text}</span>
                  {rule.show_when !== "always" && (
                    <Badge variant="secondary" className="shrink-0">
                      {SHOW_WHEN_LABELS[rule.show_when]}
                    </Badge>
                  )}
                  {rule.answerCount > 0 && (
                    <span
                      className="shrink-0 text-xs tabular-nums text-muted-foreground"
                      title={`Answered on ${rule.answerCount} trades`}
                    >
                      {rule.answerCount}
                    </span>
                  )}
                </button>
                {deletable && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => remove(rule)}
                    onBlur={() => asking && setConfirmId(null)}
                    aria-label={asking ? `Confirm delete: ${rule.text}` : `Delete rule: ${rule.text}`}
                    title={
                      asking
                        ? "Click again to delete this rule for good"
                        : "Delete this rule — no playbook uses it and no trade has answered it"
                    }
                    className={cn(
                      "flex shrink-0 items-center gap-1 rounded-md border px-2 text-xs",
                      asking
                        ? "border-destructive/60 bg-destructive/10 text-destructive"
                        : "text-muted-foreground hover:bg-accent/60 hover:text-destructive",
                    )}
                  >
                    <Trash2 className="size-3.5" />
                    {asking && "Delete?"}
                  </button>
                )}
                </div>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
