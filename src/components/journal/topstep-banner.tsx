"use client";

import { AlertTriangle, CheckCircle2, Target } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtMoney } from "@/lib/journal/format";
import { TOPSTEP_CONSISTENCY, type TopstepResult } from "@/lib/journal/topstep";
import type { Account } from "@/lib/journal/types";

/**
 * One Topstep account on the dashboard: the numbers that decide the next trade.
 *
 * Room first — balance minus the Maximum Loss Limit is what the account can
 * really lose, and the trade form sizes from it — then today's Daily Loss Limit
 * (the personal one where it is tighter), the personal daily profit target, the
 * best day against the 55 % consistency line, and the way to the target.
 * Closed trades only (see topstep.ts): the platform's own risk engine, which
 * also counts open P&L, is the record.
 */
export function TopstepBanner({ account, result }: { account: Account; result: TopstepResult }) {
  const ccy = account.currency;
  const tone =
    result.status === "failed"
      ? "border-[var(--loss)]/40 bg-[var(--loss)]/10"
      : result.status === "passed"
        ? "border-[var(--profit)]/40 bg-[var(--profit)]/10"
        : "border-border bg-muted/40";
  const bestLimit = result.rules.target * TOPSTEP_CONSISTENCY;

  return (
    <div className={cn("space-y-2 rounded-lg border p-3", tone)}>
      <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
        {result.status === "failed" && <AlertTriangle className="size-4 text-[var(--loss)]" />}
        {result.status === "passed" && <CheckCircle2 className="size-4 text-[var(--profit)]" />}
        {result.status === "active" && <Target className="size-4" />}
        <span className="min-w-0">
          Topstep {account.topstep_plan} · {account.name}
        </span>
        <span
          className={cn(
            "shrink-0 rounded px-1.5 py-0.5 text-xs whitespace-nowrap uppercase tracking-wide",
            result.status === "failed" && "bg-[var(--loss)]/20 text-[var(--loss)]",
            result.status === "passed" && "bg-[var(--profit)]/20 text-[var(--profit)]",
            result.status === "active" && "bg-muted text-muted-foreground",
          )}
        >
          {result.status === "failed" ? "MLL hit" : result.status === "passed" ? "Target reached" : "Active"}
        </span>
      </div>

      {result.status === "failed" && (
        <p className="text-sm text-[var(--loss)]">
          The realized balance reached the Maximum Loss Limit on {result.mllBreachDay}.
        </p>
      )}

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">
          Room: {fmtMoney(result.room, ccy)} (balance {fmtMoney(result.balance, ccy)} − MLL{" "}
          {fmtMoney(result.mllFloor, ccy)}
          {result.mllLocked ? ", locked" : ""})
        </span>
        <span className={cn(result.dllLeftToday <= 0 && "font-medium text-[var(--loss)]")}>
          {result.personalDll ? "Daily loss limit" : "DLL"} today: {fmtMoney(result.dllLeftToday, ccy)} of{" "}
          {fmtMoney(result.rules.dll, ccy)} left{result.dllLeftToday <= 0 ? " — done for today" : ""}
        </span>
        {result.dailyTarget != null && (
          <span className={cn(result.targetLeftToday === 0 && "font-medium text-[var(--profit)]")}>
            {result.targetLeftToday === 0
              ? `Daily target ${fmtMoney(result.dailyTarget, ccy)} reached — done for today`
              : `Daily target: ${fmtMoney(result.targetLeftToday ?? 0, ccy)} of ${fmtMoney(result.dailyTarget, ccy)} to go`}
          </span>
        )}
        <span>
          P/L: {fmtMoney(result.profit, ccy, { sign: true })} of {fmtMoney(result.effectiveTarget, ccy)} target
        </span>
        {result.paidOut > 0 && <span>Paid out: {fmtMoney(result.paidOut, ccy)}</span>}
        {result.bestDay && (
          <span className={cn(!result.consistencyOk && "text-[var(--loss)]")}>
            Best day: {fmtMoney(result.bestDay.net, ccy, { sign: true })} (limit {fmtMoney(bestLimit, ccy)}
            {!result.consistencyOk ? " — target raised" : ""})
          </span>
        )}
        {result.dllDays.length > 0 && <span>DLL days: {result.dllDays.length}</span>}
        <span>Days: {result.daysTraded}</span>
      </div>
    </div>
  );
}
