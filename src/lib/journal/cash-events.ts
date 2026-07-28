import "server-only";
import { createClient } from "@/lib/supabase/server";
import { selectAllPages } from "@/lib/supabase/paginate";
import type { CashEvent } from "./balance";

export type { CashEvent, CashEventType } from "./balance";

/** Cash events for one account, or all accounts when `accountId` is omitted. */
export async function getCashEvents(
  accountId?: string | null,
): Promise<CashEvent[]> {
  const supabase = await createClient();
  // Cash flow feeds the equity denominator behind every drawdown percentage;
  // a dropped deposit would silently distort it.
  const data = await selectAllPages((from, to) => {
    let q = supabase
      .from("tj_cash_events")
      .select("id,account_id,event_type,amount,occurred_at,note")
      .order("occurred_at", { ascending: false })
      .order("id")
      .range(from, to);
    if (accountId) q = q.eq("account_id", accountId);
    return q;
  });

  return (data as CashEvent[]).map((e) => ({ ...e, amount: Number(e.amount) }));
}
