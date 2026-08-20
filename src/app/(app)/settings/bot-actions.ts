"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { cleanBrokerSymbol, TOKEN_PREFIX } from "@/lib/journal/bot-events";

function revalidateAll() {
  revalidatePath("/settings");
  revalidatePath("/journal");
  revalidatePath("/", "layout");
}

type Result = { ok: true } | { ok: false; error: string };

/**
 * Token registration.
 *
 * The action receives a HASH, never a token. The plaintext is generated in the
 * browser with `crypto.getRandomValues`, shown once, and discarded — so there
 * is no point in the pipeline (server log, RSC payload, error report) where a
 * working credential can be captured. The prefix is a display aid so the user
 * can tell two tokens apart in the list.
 *
 * A consequence worth stating: a lost token cannot be recovered, only replaced.
 * That is the intended trade.
 */
const registerSchema = z.object({
  label: z.string().trim().min(1, "Naziv je obavezan").max(60),
  // 64 hex chars = sha256. Fixed length, so a client sending anything else is
  // not a user error to explain, it is a caller that is wrong.
  tokenHash: z.string().regex(/^[0-9a-f]{64}$/, "Neispravan otisak tokena"),
  tokenPrefix: z.string().trim().min(TOKEN_PREFIX.length).max(24),
});

export async function registerBotToken(input: {
  label: string;
  tokenHash: string;
  tokenPrefix: string;
}): Promise<Result> {
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Neispravan unos" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("tj_bot_tokens").insert({
    label: parsed.data.label,
    // Postgres `bytea` over PostgREST takes hex in `\x...` form.
    token_hash: `\\x${parsed.data.tokenHash}`,
    token_prefix: parsed.data.tokenPrefix,
  });

  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}

/**
 * Revoking is a timestamp, not a delete.
 *
 * `tj_bot_events.token_id` points here, and the log's whole value is answering
 * "what did the bot send, and which credential sent it" months later. Deleting
 * the row would null that out. `tj_bot_ingest` matches on
 * `revoked_at IS NULL`, so a revoked token stops working immediately either way.
 */
export async function revokeBotToken(id: string): Promise<Result> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tj_bot_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .is("revoked_at", null)
    .select("id");

  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) {
    return { ok: false, error: "Token je već opozvan — osveži stranicu" };
  }
  revalidateAll();
  return { ok: true };
}

/**
 * Map a broker account number onto a journal account.
 *
 * An empty value clears the mapping, which stops the bridge for that account
 * rather than silently redirecting it somewhere else.
 */
export async function setAccountBrokerId(
  accountId: string,
  brokerAccountId: string,
): Promise<Result> {
  const clean = brokerAccountId.trim();
  if (clean.length > 40) return { ok: false, error: "Broj naloga je predugačak" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("tj_accounts")
    .update({ broker_account_id: clean === "" ? null : clean })
    .eq("id", accountId);

  if (error) {
    // The partial unique index is the only way two journal accounts can be
    // pointed at one broker account, and it is worth a sentence rather than a
    // constraint name: the bridge would have no answer for which one to write.
    if (error.code === "23505") {
      return { ok: false, error: "Taj broj naloga je već vezan za drugi nalog u dnevniku" };
    }
    return { ok: false, error: error.message };
  }
  revalidateAll();
  return { ok: true };
}

/**
 * Map a broker symbol onto an instrument, and fix its volume divisor.
 *
 * `units_per_qty` is the number that decides how large every bot-recorded trade
 * is. It is taken from a human, never inferred, because "one lot" on an index
 * CFD is the broker's contract definition and need not be what this journal
 * counts as one contract. Getting it wrong is a P&L wrong by orders of
 * magnitude, presented as fact — the failure this repo is built around.
 */
const symbolMapSchema = z.object({
  brokerSymbol: z.string().trim().min(1, "Simbol je obavezan"),
  instrument: z.string().trim().min(1, "Instrument je obavezan"),
  unitsPerQty: z
    .number()
    .finite("Količina po lotu mora biti broj")
    .positive("Količina po lotu mora biti veća od nule"),
});

export async function upsertBrokerSymbolMap(input: {
  brokerSymbol: string;
  instrument: string;
  unitsPerQty: number;
  broker?: string;
}): Promise<Result> {
  const parsed = symbolMapSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Neispravan unos" };
  }

  const brokerSymbol = cleanBrokerSymbol(parsed.data.brokerSymbol);
  if (!brokerSymbol) return { ok: false, error: "Simbol nema nijedan upotrebljiv znak" };

  const supabase = await createClient();
  const { error } = await supabase.from("tj_broker_symbol_map").upsert(
    {
      broker: input.broker?.trim() || "ctrader",
      broker_symbol: brokerSymbol,
      instrument: parsed.data.instrument,
      units_per_qty: parsed.data.unitsPerQty,
    },
    { onConflict: "user_id,broker,broker_symbol" },
  );

  if (error) {
    // The composite FK to (user_id, symbol) on tj_instruments. Mapping to an
    // instrument that does not exist would produce trades priced at a null
    // point value, which the view reports as 'missing' — better refused here.
    if (error.code === "23503") {
      return { ok: false, error: "Taj instrument ne postoji — dodaj ga prvo u Instruments" };
    }
    return { ok: false, error: error.message };
  }
  revalidateAll();
  return { ok: true };
}

export async function deleteBrokerSymbolMap(id: string): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.from("tj_broker_symbol_map").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}

/**
 * Clear quarantined events.
 *
 * There is deliberately no "re-apply" here. The bot still holds these events in
 * its own outbox only until they are answered, and they were answered — with a
 * refusal. Re-running them from the journal would need the journal to replay a
 * broker fact it never witnessed, which is the guessing this design exists to
 * avoid. The supported recovery is: add the mapping, then let the bot resend
 * (its event keys make a resend free) or enter the trade by hand.
 */
export async function clearQuarantinedEvents(ids: string[]): Promise<Result> {
  if (ids.length === 0) return { ok: true };
  const supabase = await createClient();
  const { error } = await supabase.from("tj_bot_events").delete().in("id", ids);
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}
