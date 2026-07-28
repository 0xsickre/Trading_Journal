import "server-only";
import { createClient } from "@/lib/supabase/server";
import { selectAllPages } from "@/lib/supabase/paginate";
import { getAccounts } from "./accounts";
import {
  evaluateFtmo,
  ftmoConfigFromAccount,
  type FtmoResult,
} from "./ftmo";
import type { Account } from "./types";

export type AccountFtmo = { account: Account; result: FtmoResult };

/** Evaluate FTMO status for every account that has the mode enabled. */
export async function getFtmoStatuses(): Promise<AccountFtmo[]> {
  const accounts = await getAccounts();
  const ftmoAccounts = accounts.filter((a) => a.ftmo_mode);
  if (ftmoAccounts.length === 0) return [];

  const supabase = await createClient();
  // Must be the complete set: a truncated page could omit the very trade that
  // broke a rule, leaving a blown challenge reading as still active.
  const data = await selectAllPages((from, to) =>
    supabase
      .from("tj_position_stats")
      .select("account_id, net_pl, closed_at")
      .eq("status", "closed")
      .order("position_id")
      .range(from, to),
  );

  const byAccount = new Map<string, { closedAt: string | null; net: number }[]>();
  for (const r of data) {
    if (!r.account_id || r.net_pl == null) continue;
    const arr = byAccount.get(r.account_id) ?? [];
    arr.push({ closedAt: r.closed_at, net: r.net_pl });
    byAccount.set(r.account_id, arr);
  }

  return ftmoAccounts.map((account) => ({
    account,
    result: evaluateFtmo(
      ftmoConfigFromAccount(account),
      byAccount.get(account.id) ?? [],
    ),
  }));
}

/** Account ids whose FTMO challenge is currently failed (frozen). */
export async function getFailedFtmoAccountIds(): Promise<Set<string>> {
  const statuses = await getFtmoStatuses();
  return new Set(
    statuses
      .filter((s) => s.result.status === "failed")
      .map((s) => s.account.id),
  );
}
