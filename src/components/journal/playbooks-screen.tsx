"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronsDownUp, ChevronsUpDown, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HEADER_METRICS, PlaybookCard } from "@/components/journal/playbook-card";
import { runReport } from "@/lib/journal/reports/engine";
import type { MetricContext } from "@/lib/journal/reports/metrics";
import {
  playbookDimension,
  type PlaybookLookup,
} from "@/lib/journal/reports/playbook-dimensions";
import type { Playbook, PlaybookRule } from "@/lib/journal/playbook-types";
import type { EnrichedTrade } from "@/lib/journal/enriched-trade";
import type { BreakevenRange } from "@/lib/journal/breakeven";
import {
  addPlaybook,
  setPlaybooksCollapsed,
} from "@/app/(app)/settings/playbook-actions";

export function PlaybooksScreen({
  playbooks,
  library,
  trades,
  lookup,
  currency,
  breakevenRange,
  initialCollapsed,
}: {
  playbooks: Playbook[];
  library: PlaybookRule[];
  trades: EnrichedTrade[];
  lookup: PlaybookLookup;
  currency: string;
  breakevenRange: BreakevenRange;
  /** Playbook ids collapsed on load — from `tj_user_prefs`, empty by default. */
  initialCollapsed: string[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState("");

  /**
   * Which cards are collapsed, and the one piece of state on this page that
   * survives a reload. Every write below is OPTIMISTIC WITH ROLLBACK, the same
   * shape `dashboard.tsx` uses for `hiddenWidgets`: a picker that waits for a
   * round trip before a card folds feels broken on a slow connection, and one
   * that never rolls back lies to the trader when the write fails.
   */
  const [collapsed, setCollapsed] = useState<string[]>(initialCollapsed);
  const collapsedIds = useMemo(() => new Set(collapsed), [collapsed]);

  const persist = useCallback((next: string[], rollback: string[]) => {
    void setPlaybooksCollapsed(next).then((res) => {
      if (!res.ok) {
        setCollapsed(rollback);
        toast.error(res.error);
      }
    });
  }, []);

  const toggleCollapsed = useCallback(
    (id: string) => {
      setCollapsed((current) => {
        const off = new Set(current);
        if (off.has(id)) off.delete(id);
        else off.add(id);
        const next = [...off];
        persist(next, current);
        return next;
      });
    },
    [persist],
  );

  function collapseAll() {
    setCollapsed((current) => {
      const next = playbooks.map((b) => b.id);
      persist(next, current);
      return next;
    });
  }

  function expandAll() {
    setCollapsed((current) => {
      persist([], current);
      return [];
    });
  }

  const allCollapsed =
    playbooks.length > 0 && playbooks.every((b) => collapsedIds.has(b.id));

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
      metricKeys: [...HEADER_METRICS],
    });
    return new Map((result?.rows ?? []).map((r) => [r.bucket, r] as const));
  }, [trades, lookup, metricCtx]);

  function create() {
    if (!draft.trim()) return;
    start(async () => {
      const res = await addPlaybook(draft);
      if (!res.ok) toast.error(res.error ?? "Failed");
      else {
        setDraft("");
        router.refresh();
      }
    });
  }

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
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") create();
          }}
          placeholder="New playbook, e.g. London Reversal"
          aria-label="New playbook name"
          className="h-9 w-64"
          disabled={pending}
        />
        <Button
          size="sm"
          className="h-9"
          disabled={pending || !draft.trim()}
          onClick={create}
        >
          <Plus className="size-4" /> Add playbook
        </Button>

        {/* Reaching a specific card in a long list is the whole problem this
            solves, and a click beats guessing at a default. Hidden once there
            is nothing to toggle rather than disabled — a control with no
            useful state is noise, not affordance. */}
        {playbooks.length > 1 && (
          <Button
            variant="outline"
            size="sm"
            className="h-9 ml-auto"
            onClick={allCollapsed ? expandAll : collapseAll}
          >
            {allCollapsed ? (
              <>
                <ChevronsUpDown className="size-4" /> Expand all
              </>
            ) : (
              <>
                <ChevronsDownUp className="size-4" /> Collapse all
              </>
            )}
          </Button>
        )}
      </div>

      {playbooks.length === 0 ? (
        <p className="text-sm text-muted-foreground">No playbook yet.</p>
      ) : (
        playbooks.map((book) => (
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
            collapsed={collapsedIds.has(book.id)}
            onToggleCollapsed={() => toggleCollapsed(book.id)}
          />
        ))
      )}
    </div>
  );
}
