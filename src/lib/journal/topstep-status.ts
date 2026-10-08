import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { selectAllPages } from "@/lib/supabase/paginate";
import { getAccounts } from "./accounts";
import { getCashEvents } from "./cash-events";
import { firstEntryAt, riskBudgetAtEntryPatch, roomAtEntryPatch } from "./equity-at-entry";
import {
  evaluateTopstep,
  riskBudgetAt,
  riskRuleFromAccount,
  topstepConfigFromAccount,
  topstepStateAt,
  type TopstepResult,
  type TopstepSizing,
  type TopstepTrade,
} from "./topstep";
import type { PositionStatus } from "./trade-lifecycle";
import type { Account } from "./types";

export type AccountTopstep = { account: Account; result: TopstepResult };

/**
 * Topstep state for the accounts in that mode — the room above the MLL and the
 * DLL left today, which the trade form sizes a planned trade from, and the
 * dashboard banner shows. The complete read, never a page of it: a truncated
 * one could omit the trade that moved the floor.
 */
export async function getTopstepStatuses(accountIds?: string[]): Promise<AccountTopstep[]> {
  const accounts = await getAccounts();
  const wanted = accountIds == null ? null : new Set(accountIds);
  const topstep = accounts.filter((a) => a.topstep_mode && (wanted == null || wanted.has(a.id)));
  if (topstep.length === 0) return [];

  const [byAccount, cash] = await Promise.all([closedTradesByAccount(topstep.map((a) => a.id)), getCashEvents()]);

  return topstep.flatMap((account) => {
    const result = evaluateTopstep(topstepConfigFromAccount(account, cash), byAccount.get(account.id) ?? []);
    return result.status === "off" ? [] : [{ account, result: result as TopstepResult }];
  });
}

/** Every closed, priced trade of these accounts, per account — the whole set, never a page of it. */
async function closedTradesByAccount(accountIds: string[]): Promise<Map<string, TopstepTrade[]>> {
  const supabase = await createClient();
  const data = await selectAllPages((from, to) =>
    supabase
      .from("tj_position_stats")
      .select("account_id, net_pl, closed_at")
      .eq("status", "closed")
      .in("account_id", accountIds)
      .order("position_id")
      .range(from, to),
  );
  const byAccount = new Map<string, TopstepTrade[]>();
  for (const r of data) {
    if (!r.account_id || r.net_pl == null) continue;
    byAccount.set(r.account_id, [...(byAccount.get(r.account_id) ?? []), { closedAt: r.closed_at, net: r.net_pl }]);
  }
  return byAccount;
}

type TopstepEntryPatch = { risk_budget_at_entry?: number | null; room_at_entry?: number | null };

/**
 * The Topstep seals for one save, taken at the entry on the save that first
 * gives the trade fills — `getEquityAtEntryPatch`'s twin:
 *   - `risk_budget_at_entry` (F3, E4): what the account's risk rule allowed;
 *   - `room_at_entry` (30.09.2026): the room above the MLL, Risk %'s denominator.
 * `{}` on any account not in Topstep mode, and for each seal that already stands.
 */
export async function getTopstepEntryPatch(
  accountId: string | null | undefined,
  status: PositionStatus,
  execs: readonly { side: string; executed_at: string }[],
  prev: { risk_budget_at_entry: number | null; room_at_entry?: number | null } | null,
): Promise<TopstepEntryPatch> {
  const settled: TopstepEntryPatch = {
    ...riskBudgetAtEntryPatch(status, prev, null),
    ...roomAtEntryPatch(status, prev, null),
  };
  const sealed = (prev?.risk_budget_at_entry ?? null) != null && (prev?.room_at_entry ?? null) != null;
  if (Object.keys(settled).length > 0 || sealed) return settled;
  const at = firstEntryAt(execs);
  if (at == null || !accountId) return settled;
  const account = (await getAccounts()).find((a) => a.id === accountId);
  if (!account?.topstep_mode) return settled;
  const [byAccount, cash] = await Promise.all([closedTradesByAccount([accountId]), getCashEvents(accountId)]);
  const closed = byAccount.get(accountId) ?? [];
  const config = topstepConfigFromAccount(account, cash);
  const budget = riskBudgetAt(config, riskRuleFromAccount(account), closed, at);
  const room = topstepStateAt(config, closed, at)?.room ?? null;
  return { ...riskBudgetAtEntryPatch(status, prev, budget), ...roomAtEntryPatch(status, prev, room) };
}

/**
 * Every Topstep account's state, read once per request.
 */
const getAllTopstepStatuses = cache(() => getTopstepStatuses());

export async function getTopstepSizing(): Promise<Record<string, TopstepSizing>> {
  const out: Record<string, TopstepSizing> = {};
  for (const { account, result } of await getAllTopstepStatuses()) {
    out[account.id] = {
      room: result.room,
      dllLeftToday: result.dllLeftToday,
      plan: result.rules,
      target:
        result.dailyTarget == null ? null : { of: result.dailyTarget, left: result.targetLeftToday ?? 0 },
    };
  }
  return out;
}

/**
 * Whether one account has hit its MLL — the write path checks one account, so
 * this evaluates one account, not the book.
 */
export async function isTopstepAccountFailed(accountId: string | null | undefined): Promise<boolean> {
  if (!accountId) return false;
  const [status] = await getTopstepStatuses([accountId]);
  return status?.result.status === "failed";
}
