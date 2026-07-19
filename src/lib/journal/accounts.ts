import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Account } from "./types";

export async function getAccounts(): Promise<Account[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tj_accounts")
    .select(
      "id,name,broker,currency,starting_balance,default_asset_class,timezone,is_active,ftmo_mode,ftmo_daily_loss_enabled,ftmo_daily_loss_pct,ftmo_max_loss_enabled,ftmo_max_loss_pct,ftmo_profit_target_enabled,ftmo_profit_target_pct,ftmo_min_days_enabled,ftmo_min_days,ftmo_reset_at",
    )
    .order("created_at");
  return (data ?? []) as Account[];
}

/** The account used as default context (first active, else first). */
export async function getPrimaryAccount(): Promise<Account | null> {
  const accounts = await getAccounts();
  return accounts.find((a) => a.is_active) ?? accounts[0] ?? null;
}
