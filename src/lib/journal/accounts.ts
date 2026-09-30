import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Account } from "./types";
import { primaryAccount } from "./account-rules";

async function readAccounts(): Promise<Account[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tj_accounts")
    .select(
      "id,name,broker,currency,starting_balance,default_asset_class,timezone,is_active,breakeven_from,breakeven_to,breakeven_unit,default_commission_per_unit,default_fee_fixed,default_stop_pct,default_target_pct,topstep_mode,topstep_plan,topstep_payout_at,topstep_reset_at,topstep_personal_dll,topstep_daily_target,topstep_stage,risk_rule_pct,risk_rule_min,risk_rule_max,archived_at,created_at",
    )
    .order("created_at");
  return (data ?? []) as Account[];
}

// Memoized per request (React `cache`), like `getCurrentUser` and `getFieldDefs`: a page
// and the helpers it calls ask for this more than once in one render, and each ask
// was its own round trip to the database.
export const getAccounts = cache(readAccounts);

/**
 * The account used as default context: the default one, else the first — never
 * an archived one while any other exists. An archived account is finished, and
 * opening the app on it would date the day and pick the currency of a book
 * nobody trades any more.
 */
export async function getPrimaryAccount(): Promise<Account | null> {
  return primaryAccount(await getAccounts());
}

/**
 * One account's currency, for recording the FX rate when a trade is written.
 *
 * Its own query rather than `getAccounts()` because it is called on every write
 * and every import: pulling twenty-six columns of every account to read one
 * three-letter code is a cost paid per imported row.
 *
 * `null` when there is no account — a trade without one cannot be converted,
 * and the view reports that as `fx_rate_source = 'no_account'` instead of
 * assuming dollars.
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

