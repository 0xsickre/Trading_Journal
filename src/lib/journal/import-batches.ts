import "server-only";
import { createClient } from "@/lib/supabase/server";

export type ImportBatchSummary = {
  total?: number;
  created?: number;
  merged?: number;
  skipped?: number;
  failed?: number;
};

export type ImportBatch = {
  id: string;
  filename: string | null;
  account_id: string | null;
  created_at: string;
  summary: ImportBatchSummary | null;
  /** Rows whose replaced fills were captured — i.e. merges this undo can restore. */
  restorableMerges: number;
  /** Merges from before the snapshot column; undo cannot put these back. */
  unrestorableMerges: number;
};

export async function getImportBatches(limit = 20): Promise<ImportBatch[]> {
  const supabase = await createClient();

  const { data: batches } = await supabase
    .from("tj_import_batches")
    .select("id,filename,account_id,created_at,summary")
    .order("created_at", { ascending: false })
    .limit(limit);

  const ids = (batches ?? []).map((b) => b.id);
  if (ids.length === 0) return [];

  const [{ data: rows }, { data: createdPositions }] = await Promise.all([
    supabase
      .from("tj_import_rows")
      .select("batch_id, matched_position_id, prev_executions")
      .in("batch_id", ids),
    supabase.from("tj_positions").select("id").in("import_batch_id", ids),
  ]);

  // A created row also carries a matched_position_id (the row it just made), so
  // merges are identified by exclusion: matched, but not created by this import.
  const createdIds = new Set((createdPositions ?? []).map((p) => p.id));

  const restorable = new Map<string, number>();
  const unrestorable = new Map<string, number>();
  for (const r of rows ?? []) {
    if (!r.matched_position_id || createdIds.has(r.matched_position_id)) continue;
    const bucket = r.prev_executions == null ? unrestorable : restorable;
    bucket.set(r.batch_id, (bucket.get(r.batch_id) ?? 0) + 1);
  }

  return (batches ?? []).map((b) => ({
    id: b.id,
    filename: b.filename,
    account_id: b.account_id,
    created_at: b.created_at,
    summary: (b.summary ?? null) as ImportBatchSummary | null,
    restorableMerges: restorable.get(b.id) ?? 0,
    unrestorableMerges: unrestorable.get(b.id) ?? 0,
  }));
}
