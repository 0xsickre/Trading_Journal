"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { RESERVED_KEYS } from "@/lib/journal/reserved-keys";
import { getCurrentUser } from "@/lib/supabase/user";
import { EMPTY_USAGE, usageIsEmpty } from "@/lib/journal/account-usage";
import { getAccountUsage } from "@/lib/journal/account-usage-queries";
import { RESET_PHRASE } from "@/lib/journal/reset-phrase";
import { isValidTimeZone, DEFAULT_TZ } from "@/lib/journal/time";
import {
  FIELD_DEF_GROUPS,
  FIELD_DEF_TYPES,
  slugifyFieldKey,
  type FieldDefGroup,
  type FieldDefType,
} from "@/lib/journal/field-def-types";

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

  // The next ordinal is computed inside the INSERT. Reading MAX(sort_order)
  // here and inserting in a second request let two near-simultaneous adds read
  // the same maximum and claim the same position.
  // Returns a composite row, not a set — PostgREST sends the object directly.
  const { data, error } = await supabase.rpc("tj_add_option_item", {
    p_list_id: list.id,
    p_label: label,
  });
  if (error) return { ok: false, error: error.message };

  revalidateAll();
  return {
    ok: true,
    item: {
      id: data.id,
      value: data.value,
      label: data.label,
      color: data.color,
      is_active: data.is_active,
      sort_order: data.sort_order,
    },
  };
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
  // Every result is inspected. This used to `await Promise.all(...)` and throw
  // the array away, then return `{ ok: true }` unconditionally — so a reorder
  // that half-applied reported success, the list snapped back on the next load,
  // and nothing anywhere said why. The two sibling reorders in this codebase
  // (`moveFieldDef` below, and the tracker's) have always checked; this was the
  // odd one out.
  //
  // Still dispatched in parallel — the ordinals are independent, and one round
  // trip per option would make a long list crawl.
  const results = await Promise.all(
    orderedIds.map((id, i) =>
      supabase.from("tj_option_items").update({ sort_order: i }).eq("id", id),
    ),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) return { ok: false, error: failed.error.message };
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

  // Same atomic-ordinal reasoning as addOption above.
  const { error } = await supabase.rpc("tj_add_option_list", {
    p_key: cleanKey,
    p_label: label.trim(),
    p_category: category,
  });
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}

// ---- Instruments ----

/**
 * Contract specs that multiply into money must be strictly positive.
 *
 * `point_value` is the multiplier in `grossPl = grossPoints * point_value`: a 0
 * makes every trade on the instrument worth nothing and a negative one flips
 * the sign of all of them, silently in both cases. And the value is SNAPSHOTTED
 * onto each trade at creation, so a bad one is copied into every trade booked
 * while it stood and fixing the instrument later does not fix those trades.
 *
 * A CHECK constraint enforces the same thing in the database, which is the
 * guard that actually holds; this one exists to say why in Serbian instead of
 * raising a constraint name at the user.
 */
function badSpec(patch: {
  point_value?: number | null;
  tick_size?: number | null;
  tick_value?: number | null;
}): string | null {
  const fields: [string, number | null | undefined][] = [
    ["Point value", patch.point_value],
    ["Tick size", patch.tick_size],
    ["Tick value", patch.tick_value],
  ];
  for (const [label, v] of fields) {
    if (v == null) continue;
    if (!Number.isFinite(v) || v <= 0) return `${label} must be greater than zero.`;
  }
  return null;
}

export async function addInstrument(input: {
  symbol: string;
  name?: string;
  asset_class?: string;
  point_value?: number;
  tick_size?: number | null;
  tick_value?: number | null;
  quote_currency?: string;
}) {
  const supabase = await createClient();
  const symbol = input.symbol.trim();
  if (!symbol) return { ok: false, error: "Symbol required." };
  const spec = badSpec(input);
  if (spec) return { ok: false, error: spec };
  const { error } = await supabase.from("tj_instruments").insert({
    symbol,
    name: input.name?.trim() || null,
    asset_class: input.asset_class?.trim() || null,
    point_value: input.point_value ?? 1,
    tick_size: input.tick_size ?? null,
    tick_value: input.tick_value ?? null,
    quote_currency: input.quote_currency?.trim().toUpperCase() || "USD",
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
    quote_currency?: string;
    is_active?: boolean;
  },
) {
  const spec = badSpec(patch);
  if (spec) return { ok: false, error: spec };
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

  // Currency, once trades exist, is a historical fact too — more strictly than
  // `starting_balance` below. `fx_rate_at_trade` is a SNAPSHOT resolved against
  // whatever the account's currency was at the moment each trade was saved
  // (`src/lib/journal/fx.ts`, and `tj_position_stats`'s own read of it); it is
  // never recomputed. Swapping the account to a different currency does not
  // touch that snapshot — every already-logged trade keeps its old fx_rate
  // while the view relabels its money under the NEW currency, which is not a
  // relabel at all: the number stops meaning what its symbol claims, silently,
  // in every dashboard tile, drawdown figure and report that sums it. There is
  // no safe reconversion to offer (this app does not store historical market
  // FX rates), so the only honest move is to refuse the change once there is
  // a trade it would corrupt.
  //
  // Compared against the CURRENT value, not just "has trades": the settings
  // form always sends `currency` on every save (`account-settings.tsx`), so
  // gating on presence alone would block ordinary saves of an account that
  // already has trades, not just an actual currency change.
  if (patch.currency != null) {
    const { data: current } = await supabase
      .from("tj_accounts")
      .select("currency")
      .eq("id", id)
      .maybeSingle();
    if (current && current.currency !== patch.currency) {
      const { count } = await supabase
        .from("tj_positions")
        .select("id", { count: "exact", head: true })
        .eq("account_id", id);
      if ((count ?? 0) > 0) {
        return {
          ok: false,
          error:
            "Currency can't change once trades exist on this account — every logged trade's money was already converted and locked in against the old currency, and changing this would relabel it without reconverting. Create a new account instead.",
        };
      }
    }
  }

  // starting_balance is a historical fact, not a setting: it is the denominator
  // behind every drawdown percentage, the base of every FTMO threshold and the
  // opening point of the equity curve. Changing it silently re-bases all of
  // them. A negative one would invert them, so that much is refused outright;
  // an honest correction is still allowed, but it is worth knowing it rewrites
  // how every past trade reads.
  if (patch.starting_balance != null && patch.starting_balance < 0) {
    return { ok: false, error: "Starting balance cannot be negative." };
  }

  // The account's timezone decides which calendar DAY every trade, every
  // compliance verdict and every daily total belongs to. The read path uses
  // `safeTz`, which degrades an unknown zone to the default rather than
  // throwing — right for rendering, and it makes a typo invisible: save
  // `Europe/Belgrad` and the whole journal quietly re-dates itself to New York
  // with nothing on screen that looks wrong. Refused here, where the user is
  // still looking at the field they typed it into.
  if (patch.timezone != null && !isValidTimeZone(patch.timezone)) {
    return { ok: false, error: `Nepoznata vremenska zona: ${patch.timezone}` };
  }

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
  // Same guard as `updateAccount` — a bad zone must not be creatable either.
  if (input.timezone != null && !isValidTimeZone(input.timezone)) {
    return { ok: false, error: `Nepoznata vremenska zona: ${input.timezone}` };
  }
  const { error } = await supabase.from("tj_accounts").insert({
    name: input.name.trim(),
    currency: input.currency ?? "USD",
    starting_balance: input.starting_balance ?? 0,
    timezone: input.timezone ?? DEFAULT_TZ,
    default_asset_class: input.default_asset_class ?? null,
  });
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}

/**
 * Delete an account and everything that hangs off it.
 *
 * The work happens in `tj_delete_account`, not here, for a reason worth stating:
 * `tj_positions.account_id` is ON DELETE SET NULL, so a plain delete would
 * remove the account and leave its trades behind with no account — still in
 * every total, no longer convertible to the book currency, and with nothing on
 * screen to say why. The function deletes dependants first, in one transaction.
 *
 * `confirmName` is required whenever the account holds anything. The typing is
 * not ceremony: this is the only screen in the application where one click can
 * destroy a trade record, and undo does not cover it.
 */
export async function deleteAccount(id: string, confirmName?: string) {
  const supabase = await createClient();
  // Server Actions are reachable by direct POST, not only through the dialog
  // that renders them — so the signed-in check is repeated here rather than
  // assumed from the caller.
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not signed in." };

  const { data: account } = await supabase
    .from("tj_accounts")
    .select("id,name")
    .eq("id", id)
    .maybeSingle();
  if (!account) return { ok: false as const, error: "Account not found." };

  const usage = (await getAccountUsage([id]))[id] ?? EMPTY_USAGE;
  if (!usageIsEmpty(usage)) {
    if ((confirmName ?? "").trim() !== account.name.trim()) {
      return {
        ok: false as const,
        error: `This account is not empty. Type its name exactly — ${account.name} — to confirm.`,
      };
    }
  }

  const { error } = await supabase.rpc("tj_delete_account", {
    p_account_id: id,
  });
  if (error) {
    // The two the function raises deliberately, given back in the words the
    // screen can use. Anything else is passed through unchanged.
    if (error.message.includes("last account"))
      return {
        ok: false as const,
        error:
          "This is your only account, and the journal needs one — its timezone and currency date every trade. Create another first.",
      };
    if (error.message.includes("not found"))
      return { ok: false as const, error: "Account not found." };
    return { ok: false as const, error: error.message };
  }

  revalidateAll();
  return { ok: true as const };
}

/**
 * Delete everything this user owns and re-seed the defaults.
 *
 * Irreversible, and the only operation here that is. `RESET_PHRASE` is checked
 * on the server as well as in the dialog for the same reason the signed-in check
 * is: the action is callable without the dialog.
 */
export async function resetAllData(confirmPhrase: string) {
  if (confirmPhrase.trim() !== RESET_PHRASE) {
    return {
      ok: false as const,
      error: `Type ${RESET_PHRASE} to confirm.`,
    };
  }

  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not signed in." };

  const { error } = await supabase.rpc("tj_reset_my_data");
  if (error) return { ok: false as const, error: error.message };

  // Every route reads something this just deleted, so the whole tree goes —
  // revalidating only /settings would leave the dashboard drawing a book that
  // no longer exists.
  revalidatePath("/", "layout");
  return { ok: true as const };
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

// --- User-defined trade fields ---------------------------------------------


/**
 * Storage key rules, mirroring the CHECK constraint on tj_field_defs.
 *
 * Kept strict deliberately: the key becomes a jsonb path and appears in report
 * URLs, so anything with a dot, a colon or a space would eventually be split in
 * the wrong place by something downstream.
 */
const KEY_RE = /^[a-z][a-z0-9_]{0,48}$/;


export async function addFieldDef(input: {
  label: string;
  field_type: FieldDefType;
  group_id: FieldDefGroup;
  list_key?: string | null;
  key?: string;
}) {
  const label = input.label.trim();
  if (!label) return { ok: false as const, error: "The name cannot be empty." };
  if (!FIELD_DEF_TYPES.includes(input.field_type))
    return { ok: false as const, error: "Unknown field type." };
  if (!FIELD_DEF_GROUPS.includes(input.group_id))
    return { ok: false as const, error: "Unknown group." };

  // A label with no letter or digit in it has no key to derive. `slugifyFieldKey`
  // strips punctuation, finds nothing left, and falls back to the bare `f` —
  // so `!!!`, `___` and `---` are three visibly different labels that all
  // become the same field. The collision itself is caught below (23505), but
  // the message it produces — "a field with that key already exists" — is
  // baffling next to a label the user can see is new. Refused at the source
  // instead, where the reason can be stated.
  if (!/[a-z0-9]/i.test(label.normalize("NFD").replace(/[\u0300-\u036f]/g, "")))
    return {
      ok: false as const,
      error: "The name must contain at least one letter or digit.",
    };

  const key = (input.key?.trim() || slugifyFieldKey(label)).toLowerCase();
  if (!KEY_RE.test(key))
    return {
      ok: false as const,
      error: "The key must start with a letter and contain only lowercase letters, digits and _.",
    };
  if (RESERVED_KEYS.has(key))
    return {
      ok: false as const,
      error: `"${key}" is a reserved column name — pick another.`,
    };

  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not signed in." };

  // Append to the end of its group.
  const { data: last } = await supabase
    .from("tj_field_defs")
    .select("sort_order")
    .eq("group_id", input.group_id)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from("tj_field_defs").insert({
    user_id: user.id,
    key,
    label,
    field_type: input.field_type,
    // Only select / tags read an option list; storing one on a text field would
    // be a promise the form does not keep.
    list_key:
      input.field_type === "select" || input.field_type === "tags"
        ? (input.list_key?.trim() || key)
        : null,
    group_id: input.group_id,
    sort_order: (last?.sort_order ?? -1) + 1,
  });
  if (error) {
    return {
      ok: false as const,
      error: error.code === "23505" ? "A field with that key already exists." : error.message,
    };
  }
  revalidateAll();
  return { ok: true as const };
}

/**
 * Rename / regroup / retype a field.
 *
 * `key` is deliberately absent: it is where the values are stored, so changing
 * it would orphan every value already written under the old one.
 */
export async function updateFieldDef(
  id: string,
  patch: {
    label?: string;
    field_type?: FieldDefType;
    group_id?: FieldDefGroup;
    list_key?: string | null;
  },
) {
  const next: {
    label?: string;
    field_type?: string;
    group_id?: string;
    list_key?: string | null;
  } = {};
  if (patch.label != null) {
    const label = patch.label.trim();
    if (!label) return { ok: false as const, error: "The name cannot be empty." };
    next.label = label;
  }
  if (patch.field_type != null) {
    if (!FIELD_DEF_TYPES.includes(patch.field_type))
      return { ok: false as const, error: "Unknown field type." };
    next.field_type = patch.field_type;
  }
  if (patch.group_id != null) {
    if (!FIELD_DEF_GROUPS.includes(patch.group_id))
      return { ok: false as const, error: "Unknown group." };
    next.group_id = patch.group_id;
  }
  if (patch.list_key !== undefined) next.list_key = patch.list_key?.trim() || null;
  if (Object.keys(next).length === 0) return { ok: true as const };

  const supabase = await createClient();
  const { error } = await supabase.from("tj_field_defs").update(next).eq("id", id);
  if (error) return { ok: false as const, error: error.message };
  revalidateAll();
  return { ok: true as const };
}

/**
 * Archive / restore a field.
 *
 * Deactivating never deletes: history keeps the values, and every reader that
 * looks at past trades asks for inactive definitions too. Hard deletion is not
 * offered at all — it would turn recorded data into unlabelled jsonb keys.
 */
export async function toggleFieldDefActive(id: string, isActive: boolean) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("tj_field_defs")
    .update({ is_active: isActive })
    .eq("id", id);
  if (error) return { ok: false as const, error: error.message };
  revalidateAll();
  return { ok: true as const };
}

export async function moveFieldDef(id: string, direction: -1 | 1) {
  const supabase = await createClient();
  const { data: self } = await supabase
    .from("tj_field_defs")
    .select("id, group_id, sort_order")
    .eq("id", id)
    .maybeSingle();
  if (!self) return { ok: false as const, error: "Field not found." };

  const { data: siblings } = await supabase
    .from("tj_field_defs")
    .select("id, sort_order")
    .eq("group_id", self.group_id)
    .order("sort_order")
    .order("id");
  if (!siblings) return { ok: false as const, error: "Read failed." };

  const i = siblings.findIndex((s) => s.id === id);
  const j = i + direction;
  if (i < 0 || j < 0 || j >= siblings.length) return { ok: true as const };

  // Rewrite the whole group's ordinals from the reordered array. Swapping two
  // sort_order values instead would deadlock whenever rows already share one.
  const reordered = [...siblings];
  [reordered[i], reordered[j]] = [reordered[j], reordered[i]];
  for (const [ord, row] of reordered.entries()) {
    const { error } = await supabase
      .from("tj_field_defs")
      .update({ sort_order: ord })
      .eq("id", row.id);
    if (error) return { ok: false as const, error: error.message };
  }
  revalidateAll();
  return { ok: true as const };
}
