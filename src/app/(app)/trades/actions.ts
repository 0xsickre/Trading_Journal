"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/types";
import { getFieldDefs } from "@/lib/journal/field-defs";
import { buildPositionPatch, mergeCustom } from "@/lib/journal/trade-fields";
import { computeStatus, isValidFill } from "@/lib/journal/trade-lifecycle";
import { isFtmoAccountFrozen } from "@/lib/journal/ftmo-status";
import { getInstrumentSpecs, instrumentSnapshot } from "@/lib/journal/instruments";
import {
  TRADE_IMAGE_KINDS,
  validateTradingViewSnapshotUrl,
  type TradeImageKind,
} from "@/lib/journal/tradingview-snapshot";

export type ExecutionInput = {
  side: "entry" | "exit";
  price: number;
  qty: number;
  executed_at: string; // UTC ISO
  fee: number;
  swap_funding: number;
};

export type TradeInput = {
  account_id: string | null;
  trade_no: number | null;
  fields: Record<string, string | number | string[] | null>;
  executions: ExecutionInput[];
  /** User choice when no fills: planned vs active (maps to planned/open). */
  trade_phase?: "planned" | "active" | null;
  current_status?: string | null;
  playbook_id?: string | null;
  conviction?: number | null;
  /** Rule id → followed. Absent key means the rule was not answered. */
  rule_answers?: Record<string, boolean>;
  /**
   * Chart snapshot links captured before the trade existed.
   *
   * Create only. Once the position has an id, `TradeImages` owns these rows and
   * writes them itself — accepting them on update as well would give one row two
   * writers with no rule for which wins.
   */
  images?: { kind: string; image_url: string }[];
};

/**
 * Coerce the playbook columns.
 *
 * Kept out of `sanitizeFields` because they are not form-config fields: the
 * checklist is its own component with its own behaviour, and routing it through
 * the field whitelist would mean declaring definitions for values that are
 * real columns.
 */
function playbookPatch(input: TradeInput) {
  const conviction =
    input.conviction != null &&
    Number.isInteger(input.conviction) &&
    input.conviction >= 1 &&
    input.conviction <= 5
      ? input.conviction
      : null;
  return { playbook_id: input.playbook_id || null, conviction };
}

/**
 * Replace a trade's rule answers.
 *
 * Delete-then-insert rather than upsert: a rule the trader UN-answered has no
 * key in the payload at all, so an upsert would leave the old answer standing
 * and the follow rate would keep counting a judgement that was withdrawn.
 *
 * Both halves run inside `tj_replace_position_rules`, for the same reason fills
 * got `tj_replace_executions`. As two round trips, a DELETE that committed and
 * an INSERT that then failed destroyed every recorded answer for the trade — and
 * in `updateTrade` the position write has already landed by then, so returning
 * the error undoes nothing. A function body is one transaction: either the new
 * answers land or the old ones were never removed.
 */
async function saveRuleAnswers(
  supabase: Awaited<ReturnType<typeof createClient>>,
  positionId: string,
  answers: Record<string, boolean> | undefined,
) {
  const rules = Object.entries(answers ?? {}).map(([rule_id, followed]) => ({
    rule_id,
    followed,
  }));

  const { error } = await supabase.rpc("tj_replace_position_rules", {
    p_position_id: positionId,
    p_rules: rules,
  });
  return error?.message ?? null;
}

/**
 * Sanitize a submission into a row patch.
 *
 * Definitions are read with `activeOnly = false`: a field the user deactivated
 * yesterday must still be writable today, or editing an old trade would silently
 * strip the value it was recorded with.
 */
async function sanitizeFields(
  fields: Record<string, string | number | string[] | null>,
) {
  return buildPositionPatch(fields, await getFieldDefs(false));
}

function cleanExecs(execs: ExecutionInput[]) {
  return execs
    .filter(isValidFill)
    .map((e) => ({
      side: e.side,
      price: Number(e.price),
      qty: Number(e.qty),
      executed_at: e.executed_at,
      fee: Number(e.fee) || 0,
      swap_funding: Number(e.swap_funding) || 0,
      source: "manual" as const,
    }));
}

function resolveStatus(
  execs: ExecutionInput[],
  tradePhase?: "planned" | "active" | null,
  currentStatus?: string | null,
) {
  const phase = execs.length > 0 ? "active" : tradePhase;
  const manual =
    currentStatus === "missed" && execs.length === 0
      ? "missed"
      : phase === "active"
        ? "open"
        : "planned";

  const status = computeStatus(execs, manual);
  const patch: Record<string, string | null> = { status };

  if (execs.length > 0) {
    patch.missed_at = null;
    patch.miss_reason = null;
  } else if (status === "planned") {
    patch.missed_at = null;
    patch.miss_reason = null;
  }

  return patch;
}

export async function createTrade(input: TradeInput) {
  // Freeze: block new trades on an FTMO account that broke a rule. Scoped to
  // the one account being written to — this used to evaluate every account.
  if (await isFtmoAccountFrozen(input.account_id)) {
    return {
      ok: false as const,
      error:
        "The FTMO account is frozen — a rule was breached. Reset the challenge in Settings to continue.",
    };
  }

  const supabase = await createClient();
  const patch = await sanitizeFields(input.fields);
  const execs = cleanExecs(input.executions);
  const statusPatch = resolveStatus(
    execs,
    input.trade_phase,
    input.current_status,
  );

  // Freeze the contract spec onto the trade. Without this, later edits to the
  // instrument would retroactively rewrite this trade's P&L.
  const symbol =
    typeof patch.columns.instrument === "string" ? patch.columns.instrument : null;
  const snapshot = instrumentSnapshot(
    symbol,
    await getInstrumentSpecs([symbol]),
  );

  const { data: pos, error: posErr } = await supabase
    .from("tj_positions")
    .insert({
      ...patch.columns,
      // Cast: the bag is `unknown`-valued by design (a def can declare any
      // field type); PostgREST serializes it as jsonb either way.
      custom: mergeCustom({}, patch.custom) as Json,
      account_id: input.account_id,
      trade_no: input.trade_no,
      ...statusPatch,
      ...snapshot,
      ...playbookPatch(input),
      source: "manual",
    })
    .select("id")
    .single();
  if (posErr || !pos) return { ok: false as const, error: posErr?.message ?? "Insert failed" };

  if (execs.length > 0) {
    const { error: exErr } = await supabase
      .from("tj_executions")
      .insert(execs.map((e) => ({ ...e, position_id: pos.id })));
    if (exErr) {
      await supabase.from("tj_positions").delete().eq("id", pos.id);
      return { ok: false as const, error: exErr.message };
    }
  }

  const ruleErr = await saveRuleAnswers(supabase, pos.id, input.rule_answers);
  if (ruleErr) {
    await supabase.from("tj_positions").delete().eq("id", pos.id);
    return { ok: false as const, error: ruleErr };
  }

  const imgErr = await saveTradeImages(supabase, pos.id, input.images);
  if (imgErr) {
    await supabase.from("tj_positions").delete().eq("id", pos.id);
    return { ok: false as const, error: imgErr };
  }

  revalidatePath("/journal");
  revalidatePath("/", "layout");
  return { ok: true as const, id: pos.id };
}

/**
 * Persist the chart links captured on a not-yet-saved trade.
 *
 * Re-validates with `validateTradingViewSnapshotUrl` — the same function the
 * client already ran. That is not duplication: the client check is there to
 * give a fast, specific message, and this one is there because a server action
 * is a public endpoint. The column also carries a CHECK, so a bad URL would be
 * refused regardless; validating here turns a constraint violation into the
 * sentence that says what to paste instead.
 *
 * Returns an error string so the caller can roll the position back. A trade
 * whose chart silently vanished is worse than one that failed loudly: the
 * screenshot is often the only record of what the setup looked like.
 */
async function saveTradeImages(
  supabase: Awaited<ReturnType<typeof createClient>>,
  positionId: string,
  images: TradeInput["images"],
): Promise<string | null> {
  const rows: { position_id: string; kind: string; image_url: string }[] = [];
  for (const img of images ?? []) {
    if (!TRADE_IMAGE_KINDS.includes(img.kind as TradeImageKind)) {
      return `Unknown chart slot: ${img.kind}`;
    }
    const validated = validateTradingViewSnapshotUrl(img.image_url);
    if (!validated.ok) return validated.message;
    rows.push({
      position_id: positionId,
      kind: img.kind,
      image_url: validated.url,
    });
  }
  if (rows.length === 0) return null;

  const { error } = await supabase.from("tj_trade_images").insert(rows);
  return error?.message ?? null;
}

export async function updateTrade(id: string, input: TradeInput) {
  // Same freeze guard as `createTrade`, and for the same reason: editing a
  // planned trade into an active one opens a position on the account, which is
  // exactly what the FTMO freeze exists to stop. Only `createTrade` had it, so
  // the rule was enforceable through one door and not the other.
  if (await isFtmoAccountFrozen(input.account_id)) {
    return {
      ok: false as const,
      error:
        "The FTMO account is frozen — a rule was breached. Reset the challenge in Settings to continue.",
    };
  }

  const supabase = await createClient();
  const patch = await sanitizeFields(input.fields);
  const execs = cleanExecs(input.executions);
  const statusPatch = resolveStatus(
    execs,
    input.trade_phase,
    input.current_status,
  );

  // Re-snapshot the contract spec ONLY when the trade moves to a different
  // symbol, or when it predates the snapshot column. Re-stamping on every save
  // would pull in an edited point value and undo the whole point of freezing it.
  // `custom` is read in the same round trip: a jsonb write replaces the whole
  // document, so the previous bag has to be the base or every key this form did
  // not render would be erased.
  const { data: prevPos } = await supabase
    .from("tj_positions")
    .select("instrument, point_value_at_trade, custom")
    .eq("id", id)
    .maybeSingle();

  // A missing row is not an empty previous state, it is a trade that is not
  // there. Without this the code walked on: `symbolChanged` false, the snapshot
  // re-taken, the UPDATE matching zero rows, PostgREST returning no error — and
  // the action answering `{ ok: true }` for a save that wrote nothing. The
  // sibling lifecycle actions have always returned "Trade not found" here.
  if (!prevPos) return { ok: false as const, error: "Trade not found" };

  const symbol =
    typeof patch.columns.instrument === "string" ? patch.columns.instrument : null;
  // `prevPos` is non-null past the guard above, so the optional chains that
  // used to paper over the missing-row case are gone with it.
  const symbolChanged = prevPos.instrument !== symbol;
  const snapshot =
    symbolChanged || prevPos.point_value_at_trade == null
      ? instrumentSnapshot(symbol, await getInstrumentSpecs([symbol]))
      : {};

  const { error: upErr } = await supabase
    .from("tj_positions")
    .update({
      ...patch.columns,
      custom: mergeCustom(prevPos.custom, patch.custom) as Json,
      account_id: input.account_id,
      trade_no: input.trade_no,
      ...statusPatch,
      ...snapshot,
      ...playbookPatch(input),
      ...(execs.length > 0 ? { needs_review: false } : {}),
    })
    .eq("id", id);
  if (upErr) return { ok: false as const, error: upErr.message };

  // Delete + insert in ONE transaction. Doing it as two round trips left a
  // window where the trade had no fills at all — reading as planned with null
  // P&L to any concurrent render — and the application-level rollback could
  // itself fail and lose the fills for good.
  const { error: exErr } = await supabase.rpc("tj_replace_executions", {
    p_position_id: id,
    p_executions: execs,
  });
  if (exErr) return { ok: false as const, error: exErr.message };

  const ruleErr = await saveRuleAnswers(supabase, id, input.rule_answers);
  if (ruleErr) return { ok: false as const, error: ruleErr };

  revalidatePath("/journal");
  revalidatePath(`/trades/${id}`);
  revalidatePath("/", "layout");
  return { ok: true as const, id };
}

export async function markTradeMissed(
  id: string,
  input?: { miss_reason?: string | null; notes?: string | null },
) {
  const supabase = await createClient();

  const [{ data: pos }, { count }] = await Promise.all([
    supabase.from("tj_positions").select("status, trade_journal_notes").eq("id", id).maybeSingle(),
    supabase
      .from("tj_executions")
      .select("id", { count: "exact", head: true })
      .eq("position_id", id),
  ]);

  if (!pos) return { ok: false as const, error: "Trade not found" };
  if ((count ?? 0) > 0) {
    return { ok: false as const, error: "Cannot mark a trade with fills as missed" };
  }
  if (pos.status === "missed") {
    return { ok: false as const, error: "Trade is already missed" };
  }

  const notes = input?.notes?.trim();
  const mergedNotes =
    notes && notes.length > 0
      ? [pos.trade_journal_notes, notes].filter(Boolean).join("\n\n")
      : pos.trade_journal_notes;

  // The status predicate rides ALONG WITH the write, not before it. Read-then-
  // update let a second tab (or an import merge) change the row in between, and
  // the update then landed on a state nobody checked. `.select()` makes
  // PostgREST return the affected rows, so zero rows means the predicate no
  // longer held — a stale page, not a database error.
  //
  // The fill half of the guard is not expressible here and does not need to be:
  // `20260730140000_integrity_guards` refuses `status = 'missed'` on a position
  // that has fills, with a row lock that serialises against the fill insert. The
  // check above this only exists to produce a better message than the trigger's.
  const { data: changed, error } = await supabase
    .from("tj_positions")
    .update({
      status: "missed",
      missed_at: new Date().toISOString(),
      miss_reason: input?.miss_reason?.trim() || null,
      trade_journal_notes: mergedNotes,
    })
    .eq("id", id)
    .neq("status", "missed")
    .select("id");

  if (error) return { ok: false as const, error: error.message };
  if (!changed || changed.length === 0) {
    return { ok: false as const, error: "Trade changed — refresh the page" };
  }

  revalidatePath("/journal");
  revalidatePath(`/trades/${id}`);
  revalidatePath("/", "layout");
  return { ok: true as const, id };
}

export async function restoreTradeToPlanned(id: string) {
  const supabase = await createClient();

  const [{ data: pos }, { count }] = await Promise.all([
    supabase.from("tj_positions").select("status").eq("id", id).maybeSingle(),
    supabase
      .from("tj_executions")
      .select("id", { count: "exact", head: true })
      .eq("position_id", id),
  ]);

  if (!pos) return { ok: false as const, error: "Trade not found" };
  if (pos.status !== "missed") {
    return { ok: false as const, error: "Only missed trades can be restored to planned" };
  }
  if ((count ?? 0) > 0) {
    return { ok: false as const, error: "Cannot restore a trade with fills" };
  }

  const { data: changed, error } = await supabase
    .from("tj_positions")
    .update({
      status: "planned",
      missed_at: null,
      miss_reason: null,
    })
    .eq("id", id)
    .eq("status", "missed")
    .select("id");

  if (error) return { ok: false as const, error: error.message };
  if (!changed || changed.length === 0) {
    return { ok: false as const, error: "Trade changed — refresh the page" };
  }

  revalidatePath("/journal");
  revalidatePath(`/trades/${id}`);
  revalidatePath("/", "layout");
  return { ok: true as const, id };
}

/** Planned → Active without fills (manual) or confirm after import. */
export async function activateTrade(id: string) {
  const supabase = await createClient();

  const [{ data: pos }, { count }] = await Promise.all([
    supabase.from("tj_positions").select("status").eq("id", id).maybeSingle(),
    supabase
      .from("tj_executions")
      .select("id", { count: "exact", head: true })
      .eq("position_id", id),
  ]);

  if (!pos) return { ok: false as const, error: "Trade not found" };
  if (pos.status === "missed") {
    return { ok: false as const, error: "Missed trade — restore to planned first" };
  }
  if (pos.status !== "planned") {
    return { ok: true as const, id };
  }
  if ((count ?? 0) > 0) {
    return { ok: false as const, error: "Trade already has fills — refresh the page" };
  }

  const { data: changed, error } = await supabase
    .from("tj_positions")
    .update({ status: "open", needs_review: false })
    .eq("id", id)
    .eq("status", "planned")
    .select("id");

  if (error) return { ok: false as const, error: error.message };
  if (!changed || changed.length === 0) {
    return { ok: false as const, error: "Trade changed — refresh the page" };
  }

  revalidatePath("/journal");
  revalidatePath(`/trades/${id}`);
  revalidatePath("/", "layout");
  return { ok: true as const, id };
}

export async function deleteTrade(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("tj_positions").delete().eq("id", id);
  if (error) return { ok: false as const, error: error.message };
  revalidatePath("/journal");
  revalidatePath("/", "layout");
  return { ok: true as const };
}
