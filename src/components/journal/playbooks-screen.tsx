"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronsDownUp, ChevronsUpDown, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  HEADER_METRICS,
  PLAYBOOK_ROW_GRID,
  PlaybookCard,
} from "@/components/journal/playbook-card";
import { runReport } from "@/lib/journal/reports/engine";
import type { MetricContext } from "@/lib/journal/reports/metrics";
import {
  playbookDimension,
  type PlaybookLookup,
} from "@/lib/journal/reports/playbook-dimensions";
import type { Playbook, PlaybookRule } from "@/lib/journal/playbook-types";
import type { EnrichedTrade } from "@/lib/journal/enriched-trade";
import type { OptionItem } from "@/lib/journal/types";
import type { BreakevenRange } from "@/lib/journal/breakeven";
import {
  addPlaybook,
  setPlaybooksExpanded,
} from "@/app/(app)/settings/playbook-actions";

/**
 * "+ Create Playbook", in its own dialog rather than the toolbar text input it
 * replaces. The old inline input had no room for a description, and TradeZella's
 * two-field first step (name, description) is worth the extra click for that
 * one field. There is no second step for rules here — see the plan's rationale:
 * sections and rules are already fully editable on the card itself
 * (`+ Add section` and the rule rows), so the trader lands directly on that
 * editor with nothing further to build here.
 *
 * `onCreated` is why this cannot simply rely on a fresh id being absent from
 * `expanded`: absent now means COLLAPSED (see `setPlaybooksExpanded`'s doc) —
 * exactly right for a card the trader has not touched, but wrong for the one
 * they just opened this dialog to build. The parent adds the new id to
 * `expanded` itself, the same as any other explicit expand.
 */
function CreatePlaybookDialog({ onCreated }: { onCreated: (id: string) => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  function create() {
    if (!name.trim()) return;
    start(async () => {
      const res = await addPlaybook(name, description);
      if (!res.ok) {
        toast.error(res.error ?? "Failed");
        return;
      }
      setName("");
      setDescription("");
      setOpen(false);
      onCreated(res.id);
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        // Cleared on every close, not just on success — reopening should never
        // hand back a half-typed draft from a dialog the trader dismissed.
        if (!v) {
          setName("");
          setDescription("");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" className="h-9">
          <Plus className="size-4" /> Create Playbook
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New playbook</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) create();
            }}
            placeholder="e.g. London Reversal"
            aria-label="Playbook name"
            autoFocus
            disabled={pending}
          />
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What this setup is, in a sentence (optional)"
            aria-label="Playbook description"
            className="min-h-20"
            disabled={pending}
          />
        </div>
        <DialogFooter>
          <Button
            onClick={create}
            disabled={pending || !name.trim()}
          >
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PlaybooksScreen({
  playbooks,
  library,
  trades,
  lookup,
  currency,
  breakevenRange,
  initialExpanded,
  categories,
  missedByPlaybook,
}: {
  playbooks: Playbook[];
  library: PlaybookRule[];
  trades: EnrichedTrade[];
  lookup: PlaybookLookup;
  currency: string;
  breakevenRange: BreakevenRange;
  /** Playbook ids expanded on load — from `tj_user_prefs`, empty by default (every card starts collapsed). */
  initialExpanded: string[];
  /** The trader's own playbook sections, from the `rule_category` option list. */
  categories: OptionItem[];
  /**
   * Missed-trade counts, keyed by playbook id. Computed server-side in
   * `page.tsx` from the RAW trade rows (every status), because `trades` above
   * has already been realized down to closed trades with a net P&L — a missed
   * trade never has one, so it cannot be recovered from `trades` here. A plain
   * `Record`, not a `Map`: server-to-client props cross a serialization
   * boundary, and a `Record` is the shape every other cross-boundary lookup in
   * this app already uses (`OptionsMap` among them) rather than a novel one.
   */
  missedByPlaybook: Record<string, number>;
}) {
  /**
   * Which cards are expanded, and the one piece of state on this page that
   * survives a reload. Every write below is OPTIMISTIC WITH ROLLBACK, the same
   * shape `dashboard.tsx` uses for `hiddenWidgets`: a picker that waits for a
   * round trip before a card folds feels broken on a slow connection, and one
   * that never rolls back lies to the trader when the write fails.
   *
   * EXPANDED, not collapsed — flipped from the first version of this page
   * (see `setPlaybooksExpanded`'s doc comment for why): the list is a compact
   * table now, so the useful default is everything folded and opening one is
   * a deliberate act.
   */
  const [expanded, setExpanded] = useState<string[]>(initialExpanded);
  const expandedIds = useMemo(() => new Set(expanded), [expanded]);
  // Only for wrapping the server action below — nothing here renders a
  // pending state, so the boolean itself is discarded.
  const [, startPersist] = useTransition();

  // A `"use server"` action called directly (not inside a transition) is what
  // produced "Cannot update a component (Router) while rendering a different
  // component" here: Next's action dispatch touches router state internally,
  // and React expects that to happen inside `startTransition`, the same way
  // `useAction`'s `run` in `playbook-card.tsx` already wraps every other
  // action call in this app. This one was the odd one out — a bare
  // `.then()` — because it predates that helper.
  const persist = useCallback((next: string[], rollback: string[]) => {
    startPersist(async () => {
      const res = await setPlaybooksExpanded(next);
      if (!res.ok) {
        setExpanded(rollback);
        toast.error(res.error);
      }
    });
  }, []);

  /**
   * Every toggle below computes `next` from `expanded` DIRECTLY, then calls
   * `setExpanded(next)` and `persist(next, expanded)` as two separate, plain
   * statements — never `persist` nested inside a `setExpanded(current => ...)`
   * UPDATER. That nesting is what produced both React warnings above: React
   * is free to invoke a state updater during its render phase (Strict Mode
   * doubles down on this on purpose, to surface exactly this class of bug),
   * so a side effect — `startTransition`, or the server action it wraps —
   * fired from inside one can end up running "during render" instead of
   * after the click that triggered it. Reading `expanded` from the closure
   * instead of a `current` parameter is safe here: nothing above rapid-fires
   * these calls before a re-render lands, unlike the counters this
   * functional-update idiom exists for elsewhere in the codebase.
   */
  const toggleExpanded = useCallback(
    (id: string) => {
      const on = new Set(expanded);
      if (on.has(id)) on.delete(id);
      else on.add(id);
      const next = [...on];
      setExpanded(next);
      persist(next, expanded);
    },
    [expanded, persist],
  );

  // A newly created playbook opens expanded — see `CreatePlaybookDialog`'s doc
  // comment for why that can no longer be the default's doing.
  const markExpanded = useCallback(
    (id: string) => {
      if (expanded.includes(id)) return;
      const next = [...expanded, id];
      setExpanded(next);
      persist(next, expanded);
    },
    [expanded, persist],
  );

  function expandAll() {
    const next = playbooks.map((b) => b.id);
    setExpanded(next);
    persist(next, expanded);
  }

  function collapseAll() {
    setExpanded([]);
    persist([], expanded);
  }

  const allExpanded =
    playbooks.length > 0 && playbooks.every((b) => expandedIds.has(b.id));

  const metricCtx = useMemo<MetricContext>(
    () => ({
      pnlBasis: "net",
      range: breakevenRange,
      rules: lookup.rules,
    }),
    [breakevenRange, lookup],
  );

  /**
   * Header numbers per playbook, from `runReport`.
   *
   * The same function `/reports` calls, with the same dimension and the same
   * metric registry — so "Expectancy 0.34R" here and in a report grouped by
   * Playbook are the same computation, not two that agree today.
   */
  const byPlaybook = useMemo(() => {
    const result = runReport({
      trades,
      dimension: playbookDimension(lookup.names),
      dimensionContext: { reportByDate: new Map() },
      metricContext: metricCtx,
      // "net_pnl" rides along with the header set for the one column the list
      // row needs that the expanded card's own metrics grid does not:
      // `HEADER_METRICS` never included it because the card already shows
      // Expectancy, and Net P&L there would be a second currency figure next
      // to a per-R one. The compact list row wants the plain dollar number.
      metricKeys: [...HEADER_METRICS, "net_pnl"],
    });
    return new Map((result?.rows ?? []).map((r) => [r.bucket, r] as const));
  }, [trades, lookup, metricCtx]);



  return (
    <div className="space-y-4">
      {/* Only the half the page header does not already say. It opened with
          "Rules are a library: written once, linked into any number of
          playbooks…", which is the page description almost word for word — two
          paragraphs saying the same thing, stacked. What survives is the part
          that is genuinely surprising and has no other home on screen. */}
      <p className="text-sm text-muted-foreground">
        Removing a rule from a playbook is not deleting it.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <CreatePlaybookDialog onCreated={markExpanded} />

        {/* Reaching a specific card in a long list is the whole problem this
            solves, and a click beats guessing at a default. Hidden once there
            is nothing to toggle rather than disabled — a control with no
            useful state is noise, not affordance. */}
        {playbooks.length > 1 && (
          <Button
            variant="outline"
            size="sm"
            className="h-9 ml-auto"
            onClick={allExpanded ? collapseAll : expandAll}
          >
            {allExpanded ? (
              <>
                <ChevronsDownUp className="size-4" /> Collapse all
              </>
            ) : (
              <>
                <ChevronsUpDown className="size-4" /> Expand all
              </>
            )}
          </Button>
        )}
      </div>

      {playbooks.length === 0 ? (
        <p className="text-sm text-muted-foreground">No playbook yet.</p>
      ) : (
        <div className="space-y-2">
          {/* Column labels, sharing `PLAYBOOK_ROW_GRID` with every card's own
              header row below — the same grid-template-columns string is what
              keeps a number under "Win Rate" actually under "Win Rate" down
              the whole list, without the two ever being typed in two places. */}
          <div
            className={cn(
              PLAYBOOK_ROW_GRID,
              "px-1 text-xs font-medium text-muted-foreground",
            )}
          >
            <span>Playbook</span>
            <span className="text-right">Trades</span>
            <span className="text-right">Net P&L</span>
            <span className="text-right">Win Rate</span>
            <span className="text-right">Missed</span>
            <span className="text-right">Expectancy</span>
            <span />
          </div>

          {playbooks.map((book) => (
            <PlaybookCard
              key={book.id}
              book={book}
              library={library}
              // Keyed by NAME, because that is the bucket `playbookDimension`
              // emits. Undefined for one render after a rename, until
              // `router.refresh()` lands — every reader below degrades to 0 / "—".
              row={byPlaybook.get(book.name)}
              trades={trades}
              lookup={lookup}
              computeCtx={metricCtx}
              currency={currency}
              categories={categories}
              missedCount={missedByPlaybook[book.id] ?? 0}
              collapsed={!expandedIds.has(book.id)}
              onToggleCollapsed={() => toggleExpanded(book.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
