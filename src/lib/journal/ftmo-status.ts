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

/**
 * Evaluate FTMO status for accounts that have the mode enabled.
 *
 * `accountIds` narrows the evaluation — and, importantly, the query behind it.
 * Without it this reads every closed trade the user owns, which is what the
 * whole-portfolio dashboard banner needs but is far more than a single-account
 * check requires.
 */
export async function getFtmoStatuses(
  accountIds?: string[],
): Promise<AccountFtmo[]> {
  const accounts = await getAccounts();
  const wanted = accountIds == null ? null : new Set(accountIds);
  const ftmoAccounts = accounts.filter(
    (a) => a.ftmo_mode && (wanted == null || wanted.has(a.id)),
  );
  if (ftmoAccounts.length === 0) return [];

  const supabase = await createClient();
  // Scoped to the FTMO accounts in play: trades on a non-challenge account
  // never affect a verdict, so fetching them was pure cost.
  const scopedIds = ftmoAccounts.map((a) => a.id);
  // Must be the complete set for those accounts: a truncated page could omit
  // the very trade that broke a rule, leaving a blown challenge reading as
  // still active.
  const data = await selectAllPages((from, to) =>
    supabase
      .from("tj_position_stats")
      .select("account_id, net_pl, closed_at")
      .eq("status", "closed")
      .in("account_id", scopedIds)
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

/**
 * Whether one account's challenge is currently blown.
 *
 * The write path checks a single account, so it evaluates a single account.
 * Calling `getFailedFtmoAccountIds()` here meant every trade insert pulled the
 * full account list and every closed trade in the journal to resolve one
 * boolean — work that grew with the user's history on the hot path.
 */
export async function isFtmoAccountFrozen(
  accountId: string | null | undefined,
): Promise<boolean> {
  if (!accountId) return false;
  const [status] = await getFtmoStatuses([accountId]);
  return status?.result.status === "failed";
}
