"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/user";

export type AddOptionResult =
  | {
      ok: true;
      item: {
        id: string;
        value: string;
        label: string;
        color: string | null;
        is_active: boolean;
        sort_order: number;
      };
    }
  | { ok: false; error: string };

function revalidateAll() {
  revalidatePath("/settings");
  revalidatePath("/trades/new");
  revalidatePath("/journal");
  revalidatePath("/", "layout");
}

/** Add a new option to a list identified by its `key` (used by inline "+ Add"). */
export async function addOption(
  listKey: string,
  rawLabel: string,
): Promise<AddOptionResult> {
  const label = rawLabel.trim();
  if (!label) return { ok: false, error: "Value cannot be empty." };

  const supabase = await createClient();
  const { data: list } = await supabase
    .from("tj_option_lists")
    .select("id")
    .eq("key", listKey)
    .maybeSingle();
  if (!list) return { ok: false, error: "List not found." };

  const { data: maxRow } = await supabase
    .from("tj_option_items")
    .select("sort_order")
    .eq("list_id", list.id)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const sort_order = (maxRow?.sort_order ?? -1) + 1;

  const { data, error } = await supabase
    .from("tj_option_items")
    .insert({ list_id: list.id, value: label, label, sort_order })
    .select("id,value,label,color,is_active,sort_order")
    .single();
  if (error) return { ok: false, error: error.message };

  revalidateAll();
  return { ok: true, item: data };
}

export async function renameOption(id: string, label: string) {
  const supabase = await createClient();
  const trimmed = label.trim();
  if (!trimmed) return { ok: false, error: "Empty label." };
  const { error } = await supabase
    .from("tj_option_items")
    .update({ label: trimmed, value: trimmed })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}

export async function setOptionColor(id: string, color: string | null) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("tj_option_items")
    .update({ color })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}

/** Soft-delete / restore: keeps history filterable, hides from entry forms. */
export async function toggleOptionActive(id: string, is_active: boolean) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("tj_option_items")
    .update({ is_active })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}

export async function reorderOptions(orderedIds: string[]) {
  const supabase = await createClient();
  await Promise.all(
    orderedIds.map((id, i) =>
      supabase.from("tj_option_items").update({ sort_order: i }).eq("id", id),
    ),
  );
  revalidateAll();
  return { ok: true };
}

export async function addList(
  key: string,
  label: string,
  category: string | null,
) {
  const supabase = await createClient();
  const cleanKey = key
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!cleanKey || !label.trim())
    return { ok: false, error: "Key and label are required." };

  const { data: maxRow } = await supabase
    .from("tj_option_lists")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const sort_order = (maxRow?.sort_order ?? -1) + 1;

  const { error } = await supabase.from("tj_option_lists").insert({
    key: cleanKey,
    label: label.trim(),
    category,
    sort_order,
  });
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}

export async function renameList(id: string, label: string) {
  const supabase = await createClient();
  if (!label.trim()) return { ok: false, error: "Empty label." };
  const { error } = await supabase
    .from("tj_option_lists")
    .update({ label: label.trim() })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}

export async function deleteList(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("tj_option_lists").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}

// ---- Instruments ----

export async function addInstrument(input: {
  symbol: string;
  name?: string;
  asset_class?: string;
  point_value?: number;
  tick_size?: number | null;
  tick_value?: number | null;
  currency?: string;
}) {
  const supabase = await createClient();
  const symbol = input.symbol.trim();
  if (!symbol) return { ok: false, error: "Symbol required." };
  const { error } = await supabase.from("tj_instruments").insert({
    symbol,
    name: input.name?.trim() || null,
    asset_class: input.asset_class?.trim() || null,
    point_value: input.point_value ?? 1,
    tick_size: input.tick_size ?? null,
    tick_value: input.tick_value ?? null,
    currency: input.currency?.trim() || "USD",
  });
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}

export async function updateInstrument(
  id: string,
  patch: {
    name?: string | null;
    asset_class?: string | null;
    point_value?: number;
    tick_size?: number | null;
    tick_value?: number | null;
    currency?: string;
    is_active?: boolean;
  },
) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("tj_instruments")
    .update(patch)
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}

export async function deleteInstrument(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("tj_instruments").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}

// ---- Accounts ----

export async function updateAccount(
  id: string,
  patch: {
    name?: string;
    broker?: string | null;
    currency?: string;
    starting_balance?: number;
    default_asset_class?: string | null;
    timezone?: string;
    is_active?: boolean;
    breakeven_from?: number;
    breakeven_to?: number;
    breakeven_unit?: "currency" | "pct";
    default_commission_per_unit?: number;
    default_fee_fixed?: number;
    default_swap_per_day?: number;
    default_stop_pct?: number | null;
    default_target_pct?: number | null;
    profit_calc_method?: "fifo" | "lifo" | "weighted_avg";
    ftmo_mode?: boolean;
    ftmo_daily_loss_enabled?: boolean;
    ftmo_daily_loss_pct?: number;
    ftmo_max_loss_enabled?: boolean;
    ftmo_max_loss_pct?: number;
    ftmo_profit_target_enabled?: boolean;
    ftmo_profit_target_pct?: number;
    ftmo_min_days_enabled?: boolean;
    ftmo_min_days?: number;
    ftmo_reset_at?: string | null;
  },
) {
  if (
    patch.breakeven_from != null &&
    patch.breakeven_to != null &&
    patch.breakeven_from > patch.breakeven_to
  ) {
    return {
      ok: false,
      error: "Breakeven range: 'from' must be less than or equal to 'to'.",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("tj_accounts").update(patch).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}

/** Restart the FTMO challenge: trades before now stop counting toward breaches. */
export async function resetFtmoChallenge(id: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("tj_accounts")
    .update({ ftmo_reset_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false as const, error: error.message };
  revalidateAll();
  return { ok: true as const };
}

export async function addAccount(input: {
  name: string;
  currency?: string;
  starting_balance?: number;
  timezone?: string;
  default_asset_class?: string | null;
}) {
  const supabase = await createClient();
  if (!input.name.trim()) return { ok: false, error: "Name required." };
  const { error } = await supabase.from("tj_accounts").insert({
    name: input.name.trim(),
    currency: input.currency ?? "USD",
    starting_balance: input.starting_balance ?? 0,
    timezone: input.timezone ?? "America/New_York",
    default_asset_class: input.default_asset_class ?? null,
  });
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}

// ---- Cash events (deposits / withdrawals / payouts) ----

const CASH_EVENT_TYPES = [
  "deposit",
  "withdrawal",
  "payout",
  "adjustment",
] as const;
export type CashEventType = (typeof CASH_EVENT_TYPES)[number];

/**
 * Amounts are stored signed so the balance timeline is a plain running sum.
 * The form asks for a magnitude and the sign is derived from the type here, in
 * one place, rather than trusting every caller to remember.
 */
function signedAmount(type: CashEventType, magnitude: number): number {
  const abs = Math.abs(magnitude);
  if (type === "deposit") return abs;
  if (type === "withdrawal" || type === "payout") return -abs;
  return magnitude; // adjustment keeps whatever sign was entered
}

export async function addCashEvent(input: {
  account_id: string;
  event_type: CashEventType;
  amount: number;
  occurred_at: string;
  note?: string | null;
}) {
  if (!CASH_EVENT_TYPES.includes(input.event_type))
    return { ok: false as const, error: "Unknown event type." };
  if (!input.account_id)
    return { ok: false as const, error: "Account is required." };

  const amount = signedAmount(input.event_type, Number(input.amount));
  if (!Number.isFinite(amount) || amount === 0)
    return { ok: false as const, error: "Amount must be a non-zero number." };

  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not signed in." };

  const { error } = await supabase.from("tj_cash_events").insert({
    user_id: user.id,
    account_id: input.account_id,
    event_type: input.event_type,
    amount,
    occurred_at: input.occurred_at,
    note: input.note?.trim() || null,
  });
  if (error) return { ok: false as const, error: error.message };
  revalidateAll();
  return { ok: true as const };
}

export async function deleteCashEvent(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("tj_cash_events").delete().eq("id", id);
  if (error) return { ok: false as const, error: error.message };
  revalidateAll();
  return { ok: true as const };
}
