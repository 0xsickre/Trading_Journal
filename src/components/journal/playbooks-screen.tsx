"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Archive, ArchiveRestore, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
import { pnlClass } from "@/lib/journal/format";
import { formatMetric, metric as mkMetric } from "@/lib/journal/units";
import { runReport } from "@/lib/journal/reports/engine";
import type { MetricContext } from "@/lib/journal/reports/metrics";
import {
  playbookDimension,
  RULE_SAMPLE,
  type PlaybookLookup,
} from "@/lib/journal/reports/playbook-dimensions";
import { HEADER_METRICS, type Playbook } from "@/lib/journal/playbook-types";
import { EMPTY_BUCKET } from "@/lib/journal/reports/dimensions";
import { DeletePlaybookDialog } from "@/components/journal/playbook-identity-header";
import type { EnrichedTrade } from "@/lib/journal/enriched-trade";
import type { BreakevenRange } from "@/lib/journal/breakeven";
import {
  addPlaybook,
  deletePlaybook,
  updatePlaybook,
} from "@/app/(app)/settings/playbook-actions";

/**
 * "+ Create Playbook", in its own dialog. TradeZella's two-field first step
 * (name, description) is worth the extra click for that one field. On
 * success this lands the trader straight on the new playbook's own page,
 * where its (empty) Rules tab is one click away — there is nothing left to
 * build on this screen.
 */
function CreatePlaybookDialog() {
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
      router.push(`/playbooks/${res.id}`);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
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
          <Button onClick={create} disabled={pending || !name.trim()}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function useRowAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) toast.error(res.error ?? "Failed");
      else router.refresh();
    });
  return { pending, run };
}

export function PlaybooksScreen({
  playbooks,
  trades,
  lookup,
  currency,
  breakevenRange,
  missedByPlaybook,
}: {
  playbooks: Playbook[];
  trades: EnrichedTrade[];
  lookup: PlaybookLookup;
  /**
   * The currency every account shares, or null when they differ — then there
   * is no honest money total, and the money column shows a dash.
   */
  currency: string | null;
  breakevenRange: BreakevenRange;
  /**
   * Missed-trade counts, keyed by playbook id. Computed server-side in
   * `page.tsx` from the RAW trade rows (every status), because `trades` above
   * has already been realized down to closed trades with a net P&L — a
   * missed trade never has one.
   */
  missedByPlaybook: Record<string, number>;
}) {
  const router = useRouter();
  const { pending, run } = useRowAction();
  const [toDelete, setToDelete] = useState<Playbook | null>(null);

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
      // "net_pnl" rides along with the header set for the one column the
      // list needs that HEADER_METRICS does not carry.
      metricKeys: [...HEADER_METRICS, "net_pnl"],
    });
    return new Map((result?.rows ?? []).map((r) => [r.bucket, r] as const));
  }, [trades, lookup, metricCtx]);
  const noPlaybook = byPlaybook.get(EMPTY_BUCKET);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <CreatePlaybookDialog />
      </div>

      {playbooks.length === 0 ? (
        <p className="text-sm text-muted-foreground">No playbook yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-3xl text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">Playbook</th>
                <th className="px-3 py-2 text-right font-medium">Trades</th>
                <th className="px-3 py-2 text-right font-medium">Net P&amp;L</th>
                <th className="px-3 py-2 text-right font-medium">Win Rate</th>
                <th className="px-3 py-2 text-right font-medium">Profit factor</th>
                <th className="px-3 py-2 text-right font-medium">Expectancy</th>
                <th
                  className="px-3 py-2 text-right font-medium"
                  title="Share of checklist answers marked followed"
                >
                  Followed
                </th>
                <th className="px-3 py-2 text-right font-medium">Missed</th>
                <th className="w-20 px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {playbooks.map((book) => {
                const row = byPlaybook.get(book.name);
                const n = row?.n ?? 0;
                const missed = missedByPlaybook[book.id] ?? 0;
                return (
                  <tr
                    key={book.id}
                    className={cn(
                      "cursor-pointer border-b last:border-0 hover:bg-accent/50",
                      !book.is_active && "opacity-60",
                    )}
                    onClick={() => router.push(`/playbooks/${book.id}`)}
                  >
                    <td className="px-3 py-2">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <Link
                          href={`/playbooks/${book.id}`}
                          className="font-medium hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {book.name}
                        </Link>
                        {!book.is_active && <Badge variant="outline">inactive</Badge>}
                        {n > 0 && n < RULE_SAMPLE.MIN && (
                          <Badge variant="secondary">counts only</Badge>
                        )}
                        {n >= RULE_SAMPLE.MIN && n < RULE_SAMPLE.USABLE && (
                          <Badge variant="secondary">provisional</Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatMetric(mkMetric(n > 0 ? n : null, "count"))}
                    </td>
                    <FigureCells row={row} currency={currency} />
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatMetric(mkMetric(missed > 0 ? missed : null, "count"))}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        disabled={pending}
                        onClick={(e) => {
                          e.stopPropagation();
                          run(() =>
                            updatePlaybook(book.id, { is_active: !book.is_active }),
                          );
                        }}
                        aria-label={book.is_active ? "Deactivate" : "Activate"}
                        title={
                          book.is_active
                            ? "Remove from the picker on the form. Old trades stay attached to it."
                            : "Restore to the picker on the form."
                        }
                      >
                        {book.is_active ? (
                          <Archive className="size-3.5" />
                        ) : (
                          <ArchiveRestore className="size-3.5" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        disabled={pending}
                        onClick={(e) => {
                          e.stopPropagation();
                          setToDelete(book);
                        }}
                        aria-label="Delete playbook"
                        title="Only possible while no trade uses it."
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
              {/* The baseline. A playbook's numbers only mean something next to
                  what the trades WITHOUT one did — otherwise "55 % win rate"
                  cannot say whether the setup adds anything. */}
              {noPlaybook && (
                <tr className="border-t bg-muted/20 text-muted-foreground">
                  <td className="px-3 py-2 italic">No playbook</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatMetric(mkMetric(noPlaybook.n, "count"))}
                  </td>
                  <FigureCells row={noPlaybook} currency={currency} />
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2" />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {currency == null && playbooks.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Net P&amp;L is not summed: your accounts use different currencies.
        </p>
      )}

      <DeletePlaybookDialog
        name={toDelete?.name ?? ""}
        open={toDelete != null}
        onOpenChange={(v) => {
          if (!v) setToDelete(null);
        }}
        pending={pending}
        onConfirm={() => {
          const book = toDelete;
          if (!book) return;
          setToDelete(null);
          run(() => deletePlaybook(book.id));
        }}
      />
    </div>
  );
}

/** Net, win rate, profit factor, expectancy and follow rate — one row's figures. */
function FigureCells({
  row,
  currency,
}: {
  row: { values: Record<string, number | null> } | undefined;
  currency: string | null;
}) {
  const v = (k: string) => row?.values[k] ?? null;
  return (
    <>
      <td className={cn("px-3 py-2 text-right tabular-nums", currency && pnlClass(v("net_pnl")))}>
        {currency ? formatMetric(mkMetric(v("net_pnl"), "money", { currency })) : "—"}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        {formatMetric(mkMetric(v("win_rate"), "pct"))}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        {formatMetric(mkMetric(v("profit_factor"), "ratio"))}
      </td>
      <td className={cn("px-3 py-2 text-right tabular-nums", pnlClass(v("expectancy")))}>
        {formatMetric(mkMetric(v("expectancy"), "r"))}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        {formatMetric(mkMetric(v("follow_rate"), "pct"))}
      </td>
    </>
  );
}
