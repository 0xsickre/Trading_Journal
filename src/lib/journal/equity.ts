import "server-only";
import { createClient } from "@/lib/supabase/server";
import { selectAllPages } from "@/lib/supabase/paginate";
import { buildBalanceTimeline, currentEquity } from "./balance";
import { getAccounts } from "./accounts";
import { getCashEvents } from "./cash-events";

/**
 * Current equity per account: starting balance + realized P&L + cash flow.
 *
 * Position sizing used to risk a percentage of `starting_balance`, which never
 * moves. After +40%, or after a withdrawal, "risk 1%" was no longer 1% of
 * anything real — and that suggestion is the one number a trader acts on
 * *before* entering. Sizing reads from here instead.
 *
 * Built from the same primitives as the dashboard's equity curve, so the two
 * can never disagree about what the account is worth.
 */
export async function getAccountEquities(): Promise<Record<string, number>> {
  const supabase = await createClient();

  const [accounts, cashEvents, closed] = await Promise.all([
    getAccounts(),
    getCashEvents(),
    selectAllPages((from, to) =>
      supabase
        .from("tj_position_stats")
        .select("account_id, net_pl, closed_at")
        .eq("status", "closed")
        .order("position_id")
        .range(from, to),
    ),
  ]);

  const out: Record<string, number> = {};
  for (const account of accounts) {
    const trades = closed
      .filter((r) => r.account_id === account.id && r.net_pl != null)
      .map((r) => ({ at: r.closed_at ?? "", pnl: Number(r.net_pl) }));

    out[account.id] = currentEquity(
      buildBalanceTimeline(
        account.starting_balance ?? 0,
        trades,
        cashEvents.filter((c) => c.account_id === account.id),
      ),
    );
  }
  return out;
}
