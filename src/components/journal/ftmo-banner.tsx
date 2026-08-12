"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, RotateCcw, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fmtMoney, fmtPct } from "@/lib/journal/format";
import { ruleLabel, type FtmoResult } from "@/lib/journal/ftmo";
import type { Account } from "@/lib/journal/types";
import { resetFtmoChallenge } from "@/app/(app)/settings/actions";

export function FtmoBanner({
  account,
  result,
}: {
  account: Account;
  result: FtmoResult;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const ccy = account.currency;

  if (result.status === "off") return null;

  function reset() {
    start(async () => {
      const res = await resetFtmoChallenge(account.id);
      if (!res.ok) toast.error(res.error);
      else {
        toast.success("Challenge reset — a new run starts now");
        router.refresh();
      }
    });
  }

  const tone =
    result.status === "failed"
      ? "border-[var(--loss)]/40 bg-[var(--loss)]/10"
      : result.status === "passed"
        ? "border-[var(--profit)]/40 bg-[var(--profit)]/10"
        : "border-border bg-muted/40";

  return (
    <div className={cn("space-y-2 rounded-lg border p-3", tone)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* basis-full on phones: the account name keeps its own line instead of
            being truncated away next to the badge and the reset button. */}
        <div className="flex min-w-0 flex-1 basis-full flex-wrap items-center gap-2 text-sm font-semibold sm:basis-auto">
          {result.status === "failed" && (
            <AlertTriangle className="size-4 text-[var(--loss)]" />
          )}
          {result.status === "passed" && (
            <CheckCircle2 className="size-4 text-[var(--profit)]" />
          )}
          {result.status === "active" && <Target className="size-4" />}
          <span className="min-w-0">FTMO · {account.name}</span>
          <span
            className={cn(
              "shrink-0 rounded px-1.5 py-0.5 text-xs whitespace-nowrap uppercase tracking-wide",
              result.status === "failed" &&
                "bg-[var(--loss)]/20 text-[var(--loss)]",
              result.status === "passed" &&
                "bg-[var(--profit)]/20 text-[var(--profit)]",
              result.status === "active" && "bg-muted text-muted-foreground",
            )}
          >
            {result.status === "failed"
              ? "Zamrznut"
              : result.status === "passed"
                ? "Passed"
                : "Aktivan"}
          </span>
        </div>
        {(result.status === "failed" || result.status === "passed") && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 shrink-0"
            disabled={pending}
            onClick={reset}
          >
            <RotateCcw className="size-3.5" /> Reset izazov
          </Button>
        )}
      </div>

      {result.status === "failed" && (
        <ul className="space-y-0.5 text-sm text-[var(--loss)]">
          {result.breaches.map((b) => (
            <li key={`${b.rule}-${b.date}`}>
              <strong>{ruleLabel(b.rule)}</strong> breached {b.date} —{" "}
              {fmtMoney(b.amount, ccy, { sign: true })} (limit{" "}
              {fmtMoney(b.limit, ccy, { sign: true })}). Novi trejdovi su blokirani
              until you reset the challenge.
            </li>
          ))}
        </ul>
      )}

      {result.status === "passed" && (
        <p className="text-sm text-[var(--profit)]">
          Profitni cilj dostignut ({fmtPct(result.profitPct)}) uz{" "}
          {result.daysTraded} trading dana. 🎉
        </p>
      )}

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          P/L: {fmtMoney(result.netPnl, ccy, { sign: true })} ({fmtPct(result.profitPct)})
        </span>
        <span>Drawdown: {fmtPct(result.maxDrawdownPct)}</span>
        {result.profitTargetAmount != null && (
          <span>Cilj: {fmtMoney(result.profitTargetAmount, ccy)}</span>
        )}
        {result.dailyLossLimit != null && (
          <span>Dnevni limit: {fmtMoney(result.dailyLossLimit, ccy, { sign: true })}</span>
        )}
        {result.maxLossFloor != null && (
          <span>Prag (floor): {fmtMoney(result.maxLossFloor, ccy)}</span>
        )}
        <span>
          Dana: {result.daysTraded}
          {!result.minDaysMet && result.status === "active" ? " (nedovoljno)" : ""}
        </span>
      </div>
    </div>
  );
}
