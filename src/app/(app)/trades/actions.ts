"use server";

import { excursionSourcePatch } from "@/lib/journal/excursion-source";
import { revalidatePath } from "next/cache";
import { revalidateTrades } from "@/lib/journal/revalidate";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/types";
import { getFieldDefs } from "@/lib/journal/field-defs";
import { buildPositionPatch, mergeCustom } from "@/lib/journal/trade-fields";
import {
  addsExposure,
  asFillSource,
  computeStatus,
  isValidFill,
  type FillSource,
  type PositionStatus,
} from "@/lib/journal/trade-lifecycle";
import { getEquityAtEntryPatch } from "@/lib/journal/equity";
import { isFtmoAccountFrozen } from "@/lib/journal/ftmo-status";
import { parseScaleOutLevels } from "@/lib/journal/scale-out";
import { getInstrumentSpecs, instrumentSnapshot } from "@/lib/journal/instruments";
import { getAccountCurrency } from "@/lib/journal/accounts";
import {
  firstIssue,
  invalidTradeNumber,
  tradeInputSchema,
} from "@/lib/journal/trade-input-schema";
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
  /** Origin of the fill. Absent means typed here — `manual`. */
  source?: FillSource;
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
  /** Planned scale-out levels: `[{pct, price}]`. Validated in `scaleOutPatch`. */
  scale_out_levels?: unknown;
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
  return { playbook_id: input.playbook_id || null };
}

/**
 * Coerce the scale-out levels.
 *
 * Kept out of `sanitizeFields` for the same reason as the playbook columns: a
 * jsonb array of objects is not a form-config field type, and routing it
 * through the field whitelist would mean declaring a definition for a shape no
 * `FieldType` can express.
 *
 * `parseScaleOutLevels` drops anything malformed, so a hand-crafted request
 * cannot write junk into the column. The "sums to 100" rule is NOT enforced
 * here — it is a planning aid, not an integrity rule, and a trade imported or
 * edited around it must still be saveable. The form blocks it before the round
 * trip; see `scale-out.ts` for why the database cannot.
 */
function scaleOutPatch(input: TradeInput) {
  return { scale_out_levels: parseScaleOutLevels(input.scale_out_levels) };
}

/**
 * Rule answers as the rows `tj_save_trade` expects.
 *
 * Delete-then-insert rather than upsert — that half lives in the function — for
 * the reason the payload shape makes plain: a rule the trader UN-answered has
 * no key here at all, so an upsert would leave the old answer standing and the
 * follow rate would keep counting a judgement that was withdrawn.
 */
function ruleRows(answers: Record<string, boolean> | undefined) {
  return Object.entries(answers ?? {}).map(([rule_id, followed]) => ({
    rule_id,
    followed,
  }));
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

/**
 * Both write paths, prepared and checked in one place.
 *
 * A server action is a public endpoint, and until now this one accepted any
 * finite number. Measured against the live view before the fix: entry −5000,
 * exit −4990 on ES priced at 50 came back as `gross_pl = 500`, `realized_r =
 * 1.00` — a wrong figure wearing the shape of a right one, which then feeds
 * profit factor, expectancy and the score. The DB now carries the same rules as
 * CHECK constraints; this copy exists to answer in a sentence.
 *
 * Structure is checked BEFORE anything touches the database. `account_id` used
 * to go straight into `isFtmoAccountFrozen`, so a non-uuid produced a Postgres
 * type error instead of a message about the account.
 */
async function prepareTrade(input: TradeInput) {
  const parsed = tradeInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: firstIssue(parsed.error) };
  }

  const patch = await sanitizeFields(input.fields);
  const rangeError = invalidTradeNumber(patch.columns);
  if (rangeError) return { ok: false as const, error: rangeError };

  const execs = cleanExecs(input.executions);
  return {
    ok: true as const,
    patch,
    execs,
    statusPatch: resolveStatus(execs, input.trade_phase, input.current_status),
  };
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
      // Kept, not stamped. `tj_save_trade` replaces every fill on each save, so
      // hard-coding `manual` here relabelled an imported trade's fills the
      // first time anyone saved a note on it.
      source: asFillSource(e.source),
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
  const prep = await prepareTrade(input);
  if (!prep.ok) return prep;

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
  const { patch, execs, statusPatch } = prep;

  // Freeze the contract spec onto the trade. Without this, later edits to the
  // instrument would retroactively rewrite this trade's P&L.
  const symbol =
    typeof patch.columns.instrument === "string" ? patch.columns.instrument : null;
  const snapshot = instrumentSnapshot(
    symbol,
    await getInstrumentSpecs([symbol]),
    await getAccountCurrency(input.account_id),
  );

  const images = validateTradeImages(input.images);
  if (!images.ok) return { ok: false as const, error: images.error };

  // ONE call, and therefore one transaction. This was four round trips with a
  // compensating `delete` after each — and the compensation is itself a network
  // call that can fail, leaving a position with no fills: a trade that reads as
  // planned, with empty money, that nobody asked for.
  const { data: id, error } = await supabase.rpc("tj_save_trade", {
    // No `p_id` — its absence is what tells the function to create.
    p_position: {
      ...patch.columns,
      // Cast: the bag is `unknown`-valued by design (a def can declare any
      // field type); PostgREST serializes it as jsonb either way.
      custom: mergeCustom({}, patch.custom) as Json,
      account_id: input.account_id,
      trade_no: input.trade_no,
      ...statusPatch,
      ...snapshot,
      ...playbookPatch(input),
      ...scaleOutPatch(input),
      ...excursionSourcePatch(patch.columns, null),
      // The risk denominator, frozen the moment the trade has an entry fill.
      // A trade saved as a plan gets nothing, and picks one up on the save that
      // gives it fills.
      ...(await getEquityAtEntryPatch(
        input.account_id,
        String(statusPatch.status) as PositionStatus,
        execs,
        null,
      )),
      source: "manual",
    } as Json,
    p_executions: execs as unknown as Json,
    p_rules: ruleRows(input.rule_answers) as unknown as Json,
    p_images: images.rows as unknown as Json,
  });
  if (error || !id) {
    return { ok: false as const, error: error?.message ?? "Insert failed" };
  }

  revalidateTrades();
  return { ok: true as const, id };
}

/**
 * Check the chart links captured on a not-yet-saved trade, and normalise them.
 *
 * Re-validates with `validateTradingViewSnapshotUrl` — the same function the
 * client already ran. That is not duplication: the client check is there to
 * give a fast, specific message, and this one is there because a server action
 * is a public endpoint. The column also carries a CHECK, so a bad URL would be
 * refused regardless; validating here turns a constraint violation into the
 * sentence that says what to paste instead.
 *
 * Pure now — it hands back rows instead of writing them, because the write
 * belongs to `tj_save_trade` along with everything else. It used to insert on
 * its own and the caller compensated by deleting the position, which is the
 * pattern this whole step exists to remove.
 */
function validateTradeImages(
  images: TradeInput["images"],
):
  | { ok: true; rows: { kind: string; image_url: string }[] }
  | { ok: false; error: string } {
  const rows: { kind: string; image_url: string }[] = [];
  for (const img of images ?? []) {
    if (!TRADE_IMAGE_KINDS.includes(img.kind as TradeImageKind)) {
      return { ok: false, error: `Unknown chart slot: ${img.kind}` };
    }
    const validated = validateTradingViewSnapshotUrl(img.image_url);
    if (!validated.ok) return { ok: false, error: validated.message };
    rows.push({ kind: img.kind, image_url: validated.url });
  }
  return { ok: true, rows };
}

export async function updateTrade(id: string, input: TradeInput) {
  const prep = await prepareTrade(input);
  if (!prep.ok) return prep;

  const supabase = await createClient();
  const { patch, execs, statusPatch } = prep;

  // The freeze guard, narrowed. Editing a planned trade into a live one — or
  // putting more size on — opens exposure on the account, which is what the
  // FTMO freeze exists to stop. Everything else is record-keeping: this used to
  // refuse EVERY save on a frozen account, so the trader could not even write
  // up the trade that breached the rule.
  if (await isFtmoAccountFrozen(input.account_id)) {
    const [{ data: prevState }, { data: prevFills }] = await Promise.all([
      supabase.from("tj_positions").select("status").eq("id", id).maybeSingle(),
      supabase.from("tj_executions").select("side, qty").eq("position_id", id),
    ]);
    const entryQty = (rows: { side: string; qty: number }[]) =>
      rows.filter((r) => r.side === "entry").reduce((s, r) => s + Number(r.qty), 0);
    if (
      addsExposure(
        { status: prevState?.status ?? null, entryQty: entryQty(prevFills ?? []) },
        { status: String(statusPatch.status), entryQty: entryQty(execs) },
      )
    ) {
      return {
        ok: false as const,
        error:
          "The FTMO account is frozen — a rule was breached. Notes and review can still be edited, but no new position or size. Reset the challenge in Settings to continue.",
      };
    }
  }

  // Re-snapshot the contract spec ONLY when the trade moves to a different
  // symbol, or when it predates the snapshot column. Re-stamping on every save
  // would pull in an edited point value and undo the whole point of freezing it.
  // `custom` is read in the same round trip: a jsonb write replaces the whole
  // document, so the previous bag has to be the base or every key this form did
  // not render would be erased.
  const { data: prevPos } = await supabase
    .from("tj_positions")
    .select(
      "instrument, point_value_at_trade, custom, max_drawdown_price, max_profit_price, equity_at_entry",
    )
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
      ? instrumentSnapshot(
          symbol,
          await getInstrumentSpecs([symbol]),
          await getAccountCurrency(input.account_id),
        )
      : {};

  // Fields, fills and rule answers in ONE transaction — the fix this path
  // needed most. As three round trips the position UPDATE was already committed
  // by the time the fills and the answers were written, so a failure in either
  // could not be undone even in principle: the action returned an error while
  // half the edit stood in the database. The user read "not saved" over a trade
  // that had changed.
  //
  // Proven on the live database before the change: an update carrying a
  // non-existent rule id left `instrument = NQ`, `entry_price = 21000` and one
  // fill behind. Through `tj_save_trade` the same call leaves ES / 5000 / two
  // fills — untouched.
  const { error: saveErr } = await supabase.rpc("tj_save_trade", {
    p_id: id,
    p_position: {
      ...patch.columns,
      custom: mergeCustom(prevPos.custom, patch.custom) as Json,
      account_id: input.account_id,
      trade_no: input.trade_no,
      ...statusPatch,
      ...snapshot,
      ...playbookPatch(input),
      ...scaleOutPatch(input),
      ...(execs.length > 0 ? { needs_review: false } : {}),
      ...excursionSourcePatch(patch.columns, prevPos),
      // Stamped on the save that first gives the trade fills, and never
      // restated afterwards — editing a fill changes how much was risked, not
      // what the account was worth on the day it was risked.
      ...(await getEquityAtEntryPatch(
        input.account_id,
        String(statusPatch.status) as PositionStatus,
        execs,
        prevPos,
      )),
    } as Json,
    p_executions: execs as unknown as Json,
    p_rules: ruleRows(input.rule_answers) as unknown as Json,
  });
  if (saveErr) return { ok: false as const, error: saveErr.message };

  revalidatePath(`/trades/${id}/edit`);
  revalidateTrades();
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

  revalidatePath(`/trades/${id}/edit`);
  revalidateTrades();
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

  revalidatePath(`/trades/${id}/edit`);
  revalidateTrades();
  return { ok: true as const, id };
}

export async function deleteTrade(id: string) {
  const supabase = await createClient();
  const { error, count } = await supabase
    .from("tj_positions")
    .delete({ count: "exact" })
    .eq("id", id);
  if (error) return { ok: false as const, error: error.message };
  // Zero rows is a trade that was already gone (another tab, an import undo) —
  // saying "deleted" over it would confirm something that did not happen here.
  if (!count) return { ok: false as const, error: "Trade not found — refresh the page" };
  revalidateTrades();
  return { ok: true as const };
}

/** Same delete, many trades — one round trip, no explicit `user_id` filter (RLS-only, same convention as `deleteTrade`). */
export async function bulkDeleteTrades(ids: string[]) {
  if (ids.length === 0) return { ok: true as const, deleted: 0 };
  const supabase = await createClient();
  const { error, count } = await supabase
    .from("tj_positions")
    .delete({ count: "exact" })
    .in("id", ids);
  if (error) return { ok: false as const, error: error.message };
  revalidateTrades();
  return { ok: true as const, deleted: count ?? ids.length };
}

/**
 * Two rows that are the same trade become one.
 *
 * `keepId` keeps its identity — its number, grade, plan and notes — and
 * `fillsFromId` supplies the fills, the money and the instrument snapshot, then
 * disappears. What the survivor has no answer for is filled in from it; what it
 * has is never overwritten. The decision of which side is which is made in
 * `merge-positions.ts` and shown in the dialog before this is called.
 *
 * One RPC, one transaction: a merge that stopped halfway would leave fills on a
 * row that no longer describes them. There is no undo, and the dialog says so.
 */
export async function mergeTrades(keepId: string, fillsFromId: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("tj_merge_positions", {
    p_keep: keepId,
    p_fills_from: fillsFromId,
  });
  if (error) return { ok: false as const, error: error.message };
  revalidateTrades();
  return { ok: true as const };
}

export type BulkTagKind = "technical" | "psychology" | "mistake";

/**
 * Appends `values` to whichever tag column `kind` maps to, across every id,
 * deduped per row. Existing tags on each trade are kept — this is additive,
 * never a replace.
 */
export async function bulkAddTag(ids: string[], kind: BulkTagKind, values: string[]) {
  if (ids.length === 0 || values.length === 0) return { ok: true as const };
  const supabase = await createClient();
  const { error } = await supabase.rpc("tj_bulk_add_tag", {
    p_ids: ids,
    p_kind: kind,
    p_values: values,
  });
  if (error) return { ok: false as const, error: error.message };
  revalidateTrades();
  return { ok: true as const };
}
