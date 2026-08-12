"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtInTz } from "@/lib/journal/time";
import type { ImportBatch } from "@/lib/journal/import-batches";
import type { Account } from "@/lib/journal/types";
import { undoImportBatch } from "@/app/(app)/import/actions";

export function ImportHistory({
  batches,
  accounts,
}: {
  batches: ImportBatch[];
  accounts: Account[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState<string | null>(null);

  const tzOf = (accountId: string | null) =>
    accounts.find((a) => a.id === accountId)?.timezone ?? "America/New_York";

  function undo(batch: ImportBatch) {
    start(async () => {
      const res = await undoImportBatch(batch.id);
      setConfirming(null);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      const parts = [
        `${res.deletedPositions} deleted`,
        `${res.restoredPositions} restored`,
      ];
      if (res.unrestorableMerges > 0) {
        parts.push(`${res.unrestorableMerges} without a snapshot`);
      }
      toast.success(`Import undone — ${parts.join(", ")}`);
      router.refresh();
    });
  }

  if (batches.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Import history</CardTitle>
        <p className="text-sm text-muted-foreground">
          Undoing deletes the trades the import created and restores the fills it
          overwrote. Plan, psychology and notes are untouched — the import never
          owned them in the first place.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {batches.map((b) => {
          const s = b.summary ?? {};
          const isConfirming = confirming === b.id;
          return (
            <div
              key={b.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">
                  {b.filename ?? "Unnamed"}
                </div>
                <div className="text-xs text-muted-foreground">
                  {fmtInTz(b.created_at, tzOf(b.account_id))} ·{" "}
                  {s.created ?? 0} new · {s.merged ?? 0} merged ·{" "}
                  {s.skipped ?? 0} skipped
                  {(s.failed ?? 0) > 0 && ` · ${s.failed} failed`}
                </div>
                {b.unrestorableMerges > 0 && (
                  <div className="mt-1 text-xs text-[var(--loss)]">
                    {b.unrestorableMerges} merged rows have no snapshot of the previous
                    fills — those cannot be restored.
                  </div>
                )}
              </div>

              {isConfirming ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    Are you sure?
                  </span>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={pending}
                    onClick={() => undo(b)}
                  >
                    Undo
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => setConfirming(null)}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => setConfirming(b.id)}
                >
                  <Undo2 className="size-4" /> Undo import
                </Button>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
