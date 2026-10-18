import "server-only";
import { createClient } from "@/lib/supabase/server";
import { parseDailyBias, type DailyBias } from "./daily-bias";

/**
 * True when PostgREST says the TABLE is not there: `tj_daily_bias` arrives by a migration
 * applied by hand, and `main` is deployed on push — until it runs, /daily still opens.
 */
function missingTable(error: { code?: string; message: string } | null): boolean {
  return (
    error != null &&
    (error.code === "PGRST205" ||
      /could not find the table .*tj_daily_bias/i.test(error.message) ||
      /relation .*tj_daily_bias.* does not exist/i.test(error.message))
  );
}

const COLUMNS =
  "id, trading_day, root, bias, reason, set_at, eval_status, eval_start_at, eval_start_price, eval_end_price, eval_move, eval_band, eval_day, eval_contract";

/** Every forecast of the Topstep days `from`–`to` (inclusive; either open), oldest first. */
export async function getDailyBiases(from?: string, to?: string): Promise<DailyBias[]> {
  const supabase = await createClient();
  let q = supabase.from("tj_daily_bias").select(COLUMNS);
  if (from) q = q.gte("trading_day", from);
  if (to) q = q.lte("trading_day", to);
  const { data, error } = await q.order("trading_day").order("set_at");
  if (error) {
    if (missingTable(error)) return [];
    throw new Error(error.message);
  }
  return (data ?? []).map((r) => parseDailyBias(r as Record<string, unknown>)).filter((b): b is DailyBias => b != null);
}
