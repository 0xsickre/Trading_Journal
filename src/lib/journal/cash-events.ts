import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { selectAllPages } from "@/lib/supabase/paginate";
import type { CashEvent } from "./balance";

export type { CashEvent } from "./balance";

/** Cash events for one account, or all accounts when `accountId` is omitted. */
async function readCashEvents(
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

// Memoized per request (React `cache`), like `getCurrentUser` and `getFieldDefs`: a page
// and the helpers it calls ask for this more than once in one render, and each ask
// was its own round trip to the database.
export const getCashEvents = cache(readCashEvents);
