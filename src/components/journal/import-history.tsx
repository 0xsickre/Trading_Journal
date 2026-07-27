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
        `${res.deletedPositions} obrisano`,
        `${res.restoredPositions} vraćeno`,
      ];
      if (res.unrestorableMerges > 0) {
        parts.push(`${res.unrestorableMerges} bez snimka`);
      }
      toast.success(`Import poništen — ${parts.join(", ")}`);
      router.refresh();
    });
  }

  if (batches.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Istorija importa</CardTitle>
        <p className="text-sm text-muted-foreground">
          Poništavanje briše trejdove koje je import napravio i vraća fill-ove
          koje je pregazio. Plan, psihologija i beleške se ne diraju — import ih
          nikad nije ni posedovao.
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
                  {b.filename ?? "Bez imena"}
                </div>
                <div className="text-xs text-muted-foreground">
                  {fmtInTz(b.created_at, tzOf(b.account_id))} ·{" "}
                  {s.created ?? 0} novih · {s.merged ?? 0} spojenih ·{" "}
                  {s.skipped ?? 0} preskočenih
                  {(s.failed ?? 0) > 0 && ` · ${s.failed} neuspelih`}
                </div>
                {b.unrestorableMerges > 0 && (
                  <div className="mt-1 text-xs text-[var(--loss)]">
                    {b.unrestorableMerges} spojenih redova nema snimak prethodnih
                    fill-ova — ti se ne mogu vratiti.
                  </div>
                )}
              </div>

              {isConfirming ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    Sigurno?
                  </span>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={pending}
                    onClick={() => undo(b)}
                  >
                    Poništi
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => setConfirming(null)}
                  >
                    Odustani
                  </Button>
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => setConfirming(b.id)}
                >
                  <Undo2 className="size-4" /> Poništi import
                </Button>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
