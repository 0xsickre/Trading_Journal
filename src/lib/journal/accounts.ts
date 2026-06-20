import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Account } from "./types";

export async function getAccounts(): Promise<Account[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tj_accounts")
    .select(
      "id,name,broker,currency,starting_balance,default_asset_class,timezone,is_active",
    )
    .order("created_at");
  return (data ?? []) as Account[];
}

/** The account used as default context (first active, else first). */
export async function getPrimaryAccount(): Promise<Account | null> {
  const accounts = await getAccounts();
  return accounts.find((a) => a.is_active) ?? accounts[0] ?? null;
}
