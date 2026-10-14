"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { revalidateTrades } from "@/lib/journal/revalidate";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/types";
import { getFieldDefs } from "@/lib/journal/field-defs";
import { categoryPatch, mergeCustom } from "@/lib/journal/trade-fields";
import { ruleAnswerWrites } from "@/lib/journal/rule-answer-writes";
import { getCurrentUser } from "@/lib/supabase/user";
import { getInstrumentSpecs, instrumentSnapshot } from "@/lib/journal/instruments";
import { getAccountCurrency } from "@/lib/journal/accounts";
import type { MergeMode } from "@/lib/journal/merge-positions";
import { firstIssue } from "@/lib/journal/trade-input-schema";
import {
  MAX_TRADE_IMAGES,
  TRADE_IMAGE_KIND,
  validateTradeImageList,
} from "@/lib/journal/tradingview-snapshot";

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
 * `mode` "combine" is the other kind of merge: two positions opened as one
 * trade, whose fills are ADDED rather than one set replacing the other.
 *
 * One RPC, one transaction: a merge that stopped halfway would leave fills on a
 * row that no longer describes them. There is no undo, and the dialog says so.
 */
/**
 * Where each trade's fills came from ('manual' | 'import'), for the merge
 * dialog's default: two sets of imported fills are two positions of one trade.
 */
export async function tradeFillSources(ids: string[]): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = Object.fromEntries(ids.map((id) => [id, []]));
  if (ids.length === 0) return out;
  const supabase = await createClient();
  const { data } = await supabase.from("tj_executions").select("position_id, source").in("position_id", ids);
  for (const row of data ?? []) out[row.position_id]?.push(row.source ?? "manual");
  return out;
}

export async function mergeTrades(keepId: string, fillsFromId: string, mode: MergeMode = "replace") {
  const supabase = await createClient();
  const { error } = await supabase.rpc("tj_merge_positions", {
    p_keep: keepId,
    p_fills_from: fillsFromId,
    p_combine: mode === "combine",
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

const tradeReviewSchema = z.object({
  playbook_id: z.uuid().nullable(),
  execution_rating: z.number().int().min(1).max(5).nullable(),
  mistake: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
  psychology_tags: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
  trade_journal_notes: z.string().max(20_000).nullable(),
  /** Written only where the trade has none — never over the trader's own answer. */
  exit_reason: z.string().trim().min(1).max(200).nullable().optional(),
  /**
   * The trader's categories by definition key (phase P) — `categoryPatch` routes
   * each to its column or to `custom`. Absent leaves every category as it is.
   */
  categories: z
    .record(
      z.string().min(1).max(100),
      z.union([z.string().max(5_000), z.number().finite(), z.array(z.string().max(200)).max(50), z.null()]),
    )
    .optional(),
  /**
   * Rule id → followed, for every rule the page's checklist offered. Absent
   * leaves the answers alone (unless the playbook changed — P-3).
   */
  rule_answers: z.record(z.uuid(), z.boolean()).optional(),
  /** Charts to ADD, in order, after the ones the trade already has. */
  images: z.array(z.string()).max(MAX_TRADE_IMAGES),
  /**
   * From the recording (phase O): the stop and target as they stood at the entry,
   * and what was said before the click. Optional: an older client omits them,
   * and omitted leaves the trade as it is.
   */
  stop_price: z.number().finite().positive().nullable().optional(),
  target_price: z.number().finite().positive().nullable().optional(),
  thesis: z.string().max(5_000).nullable().optional(),
});

export type TradeReviewInput = z.infer<typeof tradeReviewSchema>;

/**
 * The review half of a trade — setup, grade, mistakes, note, exit chart — and
 * nothing else.
 *
 * For the trades the day's export brought in: their fills are already exact, so
 * this must not go through `tj_save_trade`, which rewrites every fill and every
 * rule answer on each save. One UPDATE of these columns, and new charts
 * appended to the trade's list.
 */
export async function saveTradeReview(id: string, input: TradeReviewInput) {
  const parsed = tradeReviewSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: firstIssue(parsed.error) };
  const r = parsed.data;

  const images = validateTradeImageList(r.images);
  if (!images.ok) return { ok: false as const, error: images.error };

  const supabase = await createClient();
  const { data: prev } = await supabase
    .from("tj_positions")
    .select("exit_reason, plan_snapshot, playbook_id, custom")
    .eq("id", id)
    .maybeSingle();
  if (!prev) return { ok: false as const, error: "Trade not found" };

  const cats = r.categories ? categoryPatch(r.categories, await getFieldDefs(false)) : null;
  if (cats && !cats.ok) return { ok: false as const, error: cats.error };
  // A stop sealed EMPTY at entry (a quick-logged trade saved without one) hides
  // every stop written later — every R reads the seal first. The recording's stop
  // is the stop at entry, so it goes into the seal too.
  const seal = prev.plan_snapshot as Record<string, unknown> | null;
  const sealedEmptyStop = seal != null && "stop_price" in seal && seal.stop_price == null;

  const { error } = await supabase
    .from("tj_positions")
    .update({
      playbook_id: r.playbook_id,
      execution_rating: r.execution_rating,
      ...(r.mistake !== undefined ? { mistake: r.mistake } : {}),
      ...(r.psychology_tags !== undefined ? { psychology_tags: r.psychology_tags } : {}),
      trade_journal_notes: r.trade_journal_notes?.trim() || null,
      ...(r.exit_reason !== undefined && !prev.exit_reason ? { exit_reason: r.exit_reason } : {}),
      ...(cats?.ok ? { ...cats.columns, custom: mergeCustom(prev.custom, cats.custom) as Json } : {}),
      ...(r.stop_price !== undefined ? { stop_price: r.stop_price } : {}),
      ...(r.target_price !== undefined ? { target_price: r.target_price } : {}),
      ...(r.thesis !== undefined ? { thesis: r.thesis?.trim() || null } : {}),
      ...(sealedEmptyStop && r.stop_price != null ? { plan_snapshot: { ...seal, stop_price: r.stop_price } } : {}),
    })
    .eq("id", id);
  if (error) return { ok: false as const, error: error.message };

  const ruleError = await saveRuleAnswers(id, prev.playbook_id, r.playbook_id, r.rule_answers);
  if (ruleError) return { ok: false as const, error: ruleError };

  if (images.urls.length > 0) {
    // Appended after the trade's own: a review adds pictures, never replaces them.
    const { data: last } = await supabase
      .from("tj_trade_images")
      .select("sort_order")
      .eq("position_id", id)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const start = (last?.sort_order ?? -1) + 1;
    const { error: imgErr } = await supabase.from("tj_trade_images").insert(
      images.urls.map((image_url, i) => ({
        position_id: id,
        kind: TRADE_IMAGE_KIND,
        image_url,
        sort_order: start + i,
      })),
    );
    if (imgErr) return { ok: false as const, error: imgErr.message };
  }

  revalidatePath(`/trades/${id}`);
  revalidateTrades();
  return { ok: true as const, id };
}

/**
 * The checklist half of a trade page save — see `ruleAnswerWrites` for what is
 * written and what is removed. Never through `tj_save_trade`, which deletes
 * every answer on the trade first.
 */
async function saveRuleAnswers(
  positionId: string,
  prevPlaybookId: string | null,
  playbookId: string | null,
  sent: Record<string, boolean> | undefined,
): Promise<string | null> {
  const playbookChanged = prevPlaybookId !== playbookId;
  if (sent === undefined && !playbookChanged) return null;

  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) return "Not signed in";
  const [{ data: links, error: linkErr }, { data: answered, error: ansErr }] = await Promise.all([
    playbookId
      ? supabase.from("tj_playbook_rule_links").select("rule_id").eq("playbook_id", playbookId)
      : Promise.resolve({ data: [] as { rule_id: string }[], error: null }),
    supabase.from("tj_position_rules").select("rule_id").eq("position_id", positionId),
  ]);
  if (linkErr || ansErr) return (linkErr ?? ansErr)!.message;

  const writes = ruleAnswerWrites({
    bookRuleIds: new Set((links ?? []).map((l) => l.rule_id)),
    sent: sent ?? {},
    previous: (answered ?? []).map((a) => a.rule_id),
    playbookChanged,
  });
  if (writes.upsert.length > 0) {
    const { error } = await supabase.from("tj_position_rules").upsert(
      writes.upsert.map((w) => ({ ...w, position_id: positionId, user_id: user.id })),
      { onConflict: "position_id,rule_id" },
    );
    if (error) return error.message;
  }
  if (writes.remove.length > 0) {
    const { error } = await supabase
      .from("tj_position_rules")
      .delete()
      .eq("position_id", positionId)
      .in("rule_id", writes.remove);
    if (error) return error.message;
  }
  return null;
}

const missedSetupSchema = z.object({
  account_id: z.uuid(),
  instrument: z.string().trim().min(1).max(40),
  direction: z.enum(["Long", "Short"]),
  entry_price: z.number().finite().positive(),
  stop_price: z.number().finite().positive(),
  target_price: z.number().finite().positive(),
  seen_at: z.iso.datetime({ offset: true }),
  playbook_id: z.uuid().nullable(),
  miss_reason: z.string().trim().max(200).nullable(),
  trade_journal_notes: z.string().max(20_000).nullable(),
});

export type MissedSetupPayload = z.infer<typeof missedSetupSchema>;

/**
 * A setup seen and not taken, written from the recording (phase O).
 *
 * `status = 'missed'` with no fills — what "Mark as missed" made of a plan — so
 * the R2 walk in futures-trading prices it, and the reports, the playbooks and
 * the mentor pack count it, unchanged. The contract spec is frozen onto it like
 * any trade's.
 */
export async function createMissedSetup(input: MissedSetupPayload) {
  const parsed = missedSetupSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: firstIssue(parsed.error) };
  const m = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tj_positions")
    .insert({
      account_id: m.account_id,
      instrument: m.instrument,
      direction: m.direction,
      status: "missed",
      source: "manual",
      needs_review: false,
      entry_price: m.entry_price,
      stop_price: m.stop_price,
      target_price: m.target_price,
      missed_at: m.seen_at,
      miss_reason: m.miss_reason || null,
      playbook_id: m.playbook_id,
      trade_journal_notes: m.trade_journal_notes?.trim() || null,
      ...instrumentSnapshot(
        m.instrument,
        await getInstrumentSpecs([m.instrument]),
        await getAccountCurrency(m.account_id),
      ),
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false as const, error: error?.message ?? "Could not save the setup." };

  revalidateTrades();
  return { ok: true as const, id: data.id };
}

const missedLevelsSchema = missedSetupSchema.pick({
  direction: true,
  entry_price: true,
  stop_price: true,
  target_price: true,
  seen_at: true,
});

export type MissedLevelsPayload = z.infer<typeof missedLevelsSchema>;

/**
 * The levels of a missed setup, changed on the trade page (phase P).
 *
 * Account and instrument stay as written: the contract spec was frozen onto the
 * row with them. Setup, checklist, categories (the miss reason among them) and the note go through
 * `saveTradeReview` like on any trade. Only a `missed` row is touched — a trade
 * with fills has its levels from the exchange.
 */
export async function updateMissedSetup(id: string, input: MissedLevelsPayload) {
  const parsed = missedLevelsSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: firstIssue(parsed.error) };
  const m = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tj_positions")
    .update({
      direction: m.direction,
      entry_price: m.entry_price,
      stop_price: m.stop_price,
      target_price: m.target_price,
      missed_at: m.seen_at,
    })
    .eq("id", id)
    .eq("status", "missed")
    .select("id");
  if (error) return { ok: false as const, error: error.message };
  if (!data?.length) return { ok: false as const, error: "Missed setup not found" };

  revalidateTrades();
  return { ok: true as const, id };
}
