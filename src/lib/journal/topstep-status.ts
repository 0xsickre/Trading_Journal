import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { selectAllPages } from "@/lib/supabase/paginate";
import { getAccounts } from "./accounts";
import { firstEntryAt, riskBudgetAtEntryPatch } from "./equity-at-entry";
import {
  evaluateTopstep,
  riskBudgetAt,
  riskRuleFromAccount,
  topstepConfigFromAccount,
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
 * dashboard banner shows. Same shape and the same complete read as
 * `ftmo-status.ts`: a truncated page could omit the trade that moved the floor.
 */
export async function getTopstepStatuses(accountIds?: string[]): Promise<AccountTopstep[]> {
  const accounts = await getAccounts();
  const wanted = accountIds == null ? null : new Set(accountIds);
  const topstep = accounts.filter((a) => a.topstep_mode && (wanted == null || wanted.has(a.id)));
  if (topstep.length === 0) return [];

  const byAccount = await closedTradesByAccount(topstep.map((a) => a.id));

  return topstep.flatMap((account) => {
    const result = evaluateTopstep(topstepConfigFromAccount(account), byAccount.get(account.id) ?? []);
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

/**
 * The `risk_budget_at_entry` patch for one save (F3, E4): what the account's
 * risk rule allowed when the trade was entered, sealed on the save that first
 * gives it fills — `getEquityAtEntryPatch`'s twin. `{}` on any account not in
 * Topstep mode, and whenever the seal already stands.
 */
export async function getRiskBudgetAtEntryPatch(
  accountId: string | null | undefined,
  status: PositionStatus,
  execs: readonly { side: string; executed_at: string }[],
  prev: { risk_budget_at_entry: number | null } | null,
): Promise<{ risk_budget_at_entry?: number | null }> {
  const settled = riskBudgetAtEntryPatch(status, prev, null);
  if ("risk_budget_at_entry" in settled || (prev?.risk_budget_at_entry ?? null) != null) return settled;
  const at = firstEntryAt(execs);
  if (at == null || !accountId) return settled;
  const account = (await getAccounts()).find((a) => a.id === accountId);
  if (!account?.topstep_mode) return settled;
  const closed = (await closedTradesByAccount([accountId])).get(accountId) ?? [];
  const budget = riskBudgetAt(topstepConfigFromAccount(account), riskRuleFromAccount(account), closed, at);
  return riskBudgetAtEntryPatch(status, prev, budget);
}

/**
 * Every Topstep account's state, read once per request: `/trades/new` asks for
 * both the sizing and the failed accounts, and they are the same read.
 */
const getAllTopstepStatuses = cache(() => getTopstepStatuses());

export async function getTopstepSizing(): Promise<Record<string, TopstepSizing>> {
  const out: Record<string, TopstepSizing> = {};
  for (const { account, result } of await getAllTopstepStatuses()) {
    out[account.id] = { room: result.room, dllLeftToday: result.dllLeftToday, plan: result.rules };
  }
  return out;
}

/** Account ids whose Topstep account has hit its Maximum Loss Limit. */
export async function getFailedTopstepAccountIds(): Promise<Set<string>> {
  const statuses = await getAllTopstepStatuses();
  return new Set(statuses.filter((s) => s.result.status === "failed").map((s) => s.account.id));
}

/**
 * Whether one account has hit its MLL — the Topstep twin of
 * `isFtmoAccountFrozen`, and evaluated the same way: one account, not the book.
 */
export async function isTopstepAccountFailed(accountId: string | null | undefined): Promise<boolean> {
  if (!accountId) return false;
  const [status] = await getTopstepStatuses([accountId]);
  return status?.result.status === "failed";
}
