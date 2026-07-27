"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

import { computeStatus } from "@/lib/journal/trade-lifecycle";
import { normalizeInstrumentSymbol } from "@/lib/journal/instrument-aliases";
import { planUndo } from "@/lib/journal/import-undo";

export type ImportExec = {
  side: "entry" | "exit";
  price: number;
  qty: number;
  executed_at: string; // UTC ISO
  fee: number;
  swap_funding: number;
};

export type ImportItem = {
  decision: "create" | "merge" | "skip";
  match_status: "new" | "match" | "duplicate" | "ambiguous";
  matched_position_id: string | null;
  instrument: string | null;
  direction: string | null;
  executions: ImportExec[];
  raw: Record<string, string>;
};

export type CommitInput = {
  account_id: string | null;
  filename: string;
  items: ImportItem[];
};

function statusOf(execs: ImportExec[]) {
  return computeStatus(execs);
}

export async function commitImport(input: CommitInput) {
  const supabase = await createClient();

  const { data: batch, error: batchErr } = await supabase
    .from("tj_import_batches")
    .insert({
      account_id: input.account_id,
      filename: input.filename,
      summary: { total: input.items.length },
    })
    .select("id")
    .single();
  if (batchErr || !batch)
    return { ok: false as const, error: batchErr?.message ?? "Batch failed" };

  let created = 0,
    merged = 0,
    skipped = 0,
    failed = 0;

  for (const item of input.items) {
    let matchedId = item.matched_position_id;
    // Fills this row displaced, kept so `undoImportBatch` can put them back.
    let replacedExecs: ImportExec[] | null = null;

    try {
      if (item.decision === "create") {
        const instrument = normalizeInstrumentSymbol(item.instrument);
        const { data: pos, error } = await supabase
          .from("tj_positions")
          .insert({
            instrument,
            direction: item.direction,
            account_id: input.account_id,
            source: "import",
            import_batch_id: batch.id,
            needs_review: item.executions.length === 0,
            status: statusOf(item.executions),
          })
          .select("id")
          .single();
        if (error || !pos) throw new Error(error?.message);
        matchedId = pos.id;
        if (item.executions.length > 0) {
          const { error: exErr } = await supabase.from("tj_executions").insert(
            item.executions.map((e) => ({ ...e, position_id: pos.id, source: "import" })),
          );
          if (exErr) throw new Error(exErr.message);
        }
        created++;
      } else if (item.decision === "merge" && matchedId) {
        const pid: string = matchedId;
        // Replace ONLY the objective fills; subjective position fields untouched.
        // Snapshot first so a failed re-insert rolls back instead of wiping fills.
        const { data: prevExecs } = await supabase
          .from("tj_executions")
          .select("side,price,qty,executed_at,fee,swap_funding,source")
          .eq("position_id", pid);
        replacedExecs = (prevExecs ?? []) as unknown as ImportExec[];
        await supabase.from("tj_executions").delete().eq("position_id", pid);
        if (item.executions.length > 0) {
          const { error: exErr } = await supabase.from("tj_executions").insert(
            item.executions.map((e) => ({ ...e, position_id: pid, source: "import" })),
          );
          if (exErr) {
            if (prevExecs && prevExecs.length > 0) {
              await supabase
                .from("tj_executions")
                .insert(prevExecs.map((e) => ({ ...e, position_id: pid })));
            }
            throw new Error(exErr.message);
          }
        }
        await supabase
          .from("tj_positions")
          .update({
            status: statusOf(item.executions),
            needs_review: item.executions.length === 0,
          })
          .eq("id", pid);
        merged++;
      } else {
        skipped++;
      }

      await supabase.from("tj_import_rows").insert({
        batch_id: batch.id,
        raw: item.raw,
        parsed: {
          instrument: item.instrument,
          direction: item.direction,
          executions: item.executions,
        },
        match_status: item.match_status,
        matched_position_id: matchedId,
        prev_executions: replacedExecs,
      });
    } catch {
      failed++;
    }
  }

  await supabase
    .from("tj_import_batches")
    .update({ summary: { total: input.items.length, created, merged, skipped, failed } })
    .eq("id", batch.id);

  revalidatePath("/journal");
  revalidatePath("/", "layout");
  return { ok: true as const, created, merged, skipped, failed };
}

export type UndoResult =
  | {
      ok: true;
      deletedPositions: number;
      restoredPositions: number;
      /** Merges whose pre-import fills were never captured (batches predating
       *  the snapshot column) — these could not be put back. */
      unrestorableMerges: number;
    }
  | { ok: false; error: string };

/**
 * Roll a batch back: delete the positions it created, restore the fills it
 * replaced, then drop the batch and its audit rows.
 *
 * Only objective fills are touched. A position that existed before the import
 * keeps its plan, psychology and notes — the import never owned those.
 */
export async function undoImportBatch(batchId: string): Promise<UndoResult> {
  const supabase = await createClient();

  const { data: batch } = await supabase
    .from("tj_import_batches")
    .select("id")
    .eq("id", batchId)
    .maybeSingle();
  if (!batch) return { ok: false, error: "Import batch not found." };

  // Positions this batch created. Deleting them cascades to their executions.
  const { data: createdRows, error: createdErr } = await supabase
    .from("tj_positions")
    .select("id")
    .eq("import_batch_id", batchId);
  if (createdErr) return { ok: false, error: createdErr.message };
  const createdIds = new Set((createdRows ?? []).map((p) => p.id));

  const { data: rows, error: rowsErr } = await supabase
    .from("tj_import_rows")
    .select("matched_position_id, prev_executions")
    .eq("batch_id", batchId);
  if (rowsErr) return { ok: false, error: rowsErr.message };

  const plan = planUndo<ImportExec>(rows ?? [], createdIds);

  for (const { positionId, executions } of plan.restore) {
    await supabase.from("tj_executions").delete().eq("position_id", positionId);
    if (executions.length > 0) {
      const { error: insErr } = await supabase.from("tj_executions").insert(
        executions.map((e) => ({
          side: e.side,
          price: e.price,
          qty: e.qty,
          executed_at: e.executed_at,
          fee: e.fee,
          swap_funding: e.swap_funding,
          position_id: positionId,
        })),
      );
      if (insErr) return { ok: false, error: insErr.message };
    }
    await supabase
      .from("tj_positions")
      .update({
        status: statusOf(executions),
        needs_review: executions.length === 0,
      })
      .eq("id", positionId);
  }

  if (plan.deleteIds.length > 0) {
    const { error: delErr } = await supabase
      .from("tj_positions")
      .delete()
      .in("id", plan.deleteIds);
    if (delErr) return { ok: false, error: delErr.message };
  }

  await supabase.from("tj_import_rows").delete().eq("batch_id", batchId);
  const { error: batchDelErr } = await supabase
    .from("tj_import_batches")
    .delete()
    .eq("id", batchId);
  if (batchDelErr) return { ok: false, error: batchDelErr.message };

  revalidatePath("/journal");
  revalidatePath("/import");
  revalidatePath("/", "layout");

  return {
    ok: true,
    deletedPositions: plan.deleteIds.length,
    restoredPositions: plan.restore.length,
    unrestorableMerges: plan.unrestorableIds.length,
  };
}
