import "server-only";
import { createClient } from "@/lib/supabase/server";
import { selectAllPages } from "@/lib/supabase/paginate";
import { getAccounts } from "./accounts";
import { evaluateTopstep, topstepConfigFromAccount, type TopstepResult, type TopstepSizing } from "./topstep";
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

  const supabase = await createClient();
  const data = await selectAllPages((from, to) =>
    supabase
      .from("tj_position_stats")
      .select("account_id, net_pl, closed_at")
      .eq("status", "closed")
      .in("account_id", topstep.map((a) => a.id))
      .order("position_id")
      .range(from, to),
  );

  const byAccount = new Map<string, { closedAt: string | null; net: number }[]>();
  for (const r of data) {
    if (!r.account_id || r.net_pl == null) continue;
    byAccount.set(r.account_id, [...(byAccount.get(r.account_id) ?? []), { closedAt: r.closed_at, net: r.net_pl }]);
  }

  return topstep.flatMap((account) => {
    const result = evaluateTopstep(topstepConfigFromAccount(account), byAccount.get(account.id) ?? []);
    return result.status === "off" ? [] : [{ account, result: result as TopstepResult }];
  });
}

export async function getTopstepSizing(): Promise<Record<string, TopstepSizing>> {
  const out: Record<string, TopstepSizing> = {};
  for (const { account, result } of await getTopstepStatuses()) {
    out[account.id] = { room: result.room, dllLeftToday: result.dllLeftToday, plan: result.rules };
  }
  return out;
}
