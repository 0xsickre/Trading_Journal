import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Account } from "./types";

export async function getAccounts(): Promise<Account[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tj_accounts")
    .select(
      "id,name,broker,currency,starting_balance,default_asset_class,timezone,is_active,breakeven_from,breakeven_to,breakeven_unit,default_commission_per_unit,default_fee_fixed,default_swap_per_day,default_stop_pct,default_target_pct,ftmo_mode,ftmo_daily_loss_enabled,ftmo_daily_loss_pct,ftmo_daily_loss_basis,ftmo_max_loss_enabled,ftmo_max_loss_pct,ftmo_profit_target_enabled,ftmo_profit_target_pct,ftmo_min_days_enabled,ftmo_min_days,ftmo_reset_at",
    )
    .order("created_at");
  return (data ?? []) as Account[];
}

/** The account used as default context (first active, else first). */
export async function getPrimaryAccount(): Promise<Account | null> {
  const accounts = await getAccounts();
  return accounts.find((a) => a.is_active) ?? accounts[0] ?? null;
}

/**
 * Valuta jednog naloga, za snimanje kursa pri upisu trejda.
 *
 * Sopstveni upit umesto `getAccounts()` zato što se zove na svakom upisu i
 * uvozu: povlačiti dvadeset šest kolona svih naloga da bi se pročitala jedna
 * troslovna oznaka je cena koja se plaća po redu uvoza.
 *
 * `null` kad naloga nema — trejd bez naloga se ne može konvertovati, i view to
 * prijavljuje kao `fx_rate_source = 'no_account'` umesto da pretpostavi dolare.
 */
export async function getAccountCurrency(
  accountId: string | null | undefined,
): Promise<string | null> {
  if (!accountId) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("tj_accounts")
    .select("currency")
    .eq("id", accountId)
    .maybeSingle();
  return data?.currency ?? null;
}

