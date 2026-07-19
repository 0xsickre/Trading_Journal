"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

import { computeStatus } from "@/lib/journal/trade-lifecycle";

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

    try {
      if (item.decision === "create") {
        const { data: pos, error } = await supabase
          .from("tj_positions")
          .insert({
            instrument: item.instrument,
            direction: item.direction,
            source: "import",
            import_batch_id: batch.id,
            needs_review: true,
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
        await supabase.from("tj_executions").delete().eq("position_id", pid);
        if (item.executions.length > 0) {
          const { error: exErr } = await supabase.from("tj_executions").insert(
            item.executions.map((e) => ({ ...e, position_id: pid, source: "import" })),
          );
          if (exErr) throw new Error(exErr.message);
        }
        await supabase
          .from("tj_positions")
          .update({ status: statusOf(item.executions), needs_review: true })
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
