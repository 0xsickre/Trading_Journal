import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { AccountUsage } from "./account-usage";

/**
 * Counted with `head: true`, not by reading rows and measuring the array.
 *
 * PostgREST caps a response at `db-max-rows` (1000) and returns the truncated
 * page with HTTP 200 — so counting client-side would report "1000 trades" for
 * any account above that, and the dialog would understate what it is about to
 * delete. A head count is answered by the server and has no such ceiling.
 *
 * One pass per account rather than a GROUP BY because the number of accounts is
 * small by construction (this is a single-trader journal) and a grouped read
 * would itself come back as rows subject to the same cap.
 */
export async function getAccountUsage(
  accountIds: string[],
): Promise<Record<string, AccountUsage>> {
  const out: Record<string, AccountUsage> = {};
  if (accountIds.length === 0) return out;

  const supabase = await createClient();

  await Promise.all(
    accountIds.map(async (id) => {
      const [trades, cash, batches] = await Promise.all([
        supabase
          .from("tj_positions")
          .select("id", { count: "exact", head: true })
          .eq("account_id", id),
        supabase
          .from("tj_cash_events")
          .select("id", { count: "exact", head: true })
          .eq("account_id", id),
        supabase
          .from("tj_import_batches")
          .select("id", { count: "exact", head: true })
          .eq("account_id", id),
      ]);

      // A failed count must not read as zero: that is the difference between
      // "this account is empty" and "we could not find out", and only one of
      // them is safe to offer a one-click delete for. `null` from a failed read
      // collapses to -1, which `usageIsEmpty` reports as non-empty.
      out[id] = {
        trades: trades.count ?? (trades.error ? -1 : 0),
        cashEvents: cash.count ?? (cash.error ? -1 : 0),
        importBatches: batches.count ?? (batches.error ? -1 : 0),
      };
    }),
  );

  return out;
}

/**
 * Trades per account, for the Accounts list — `null` for an account whose count
 * failed, shown as "—" rather than as 0.
 *
 * Head counts, one per account, for the reason `getAccountUsage` gives. Only the
 * trade count: the list needs one number per row, and the delete dialog still
 * reads the full usage when it opens.
 */
export async function getAccountTradeCounts(
  accountIds: string[],
): Promise<Record<string, number | null>> {
  const out: Record<string, number | null> = {};
  if (accountIds.length === 0) return out;
  const supabase = await createClient();
  await Promise.all(
    accountIds.map(async (id) => {
      const { count, error } = await supabase
        .from("tj_positions")
        .select("id", { count: "exact", head: true })
        .eq("account_id", id);
      out[id] = error ? null : (count ?? 0);
    }),
  );
  return out;
}
