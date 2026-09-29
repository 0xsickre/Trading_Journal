/**
 * The decisions `commitImport` makes that need no database — pure, so they are
 * tested here rather than trusted inside a server action nobody can run in a
 * unit test.
 */

/** What an import batch records about itself, summed over every chunk sent. */
export type ImportSummary = {
  total: number;
  created: number;
  merged: number;
  skipped: number;
  failed: number;
  errors: { row: number; instrument: string | null; error: string }[];
};

/** Errors kept on a batch — enough to diagnose, not a second copy of the file. */
const MAX_ERRORS = 50;

const count = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;

/**
 * A batch's summary after one more chunk.
 *
 * A large file is committed in chunks so no single request runs into the
 * platform's time limit, and every chunk lands in the same batch — so its
 * summary is the running total, not the last chunk's. `prev` is whatever the
 * batch holds (jsonb, possibly written by an older version), read defensively.
 */
export function mergeImportSummary(prev: unknown, chunk: ImportSummary): ImportSummary {
  const p = (prev && typeof prev === "object" ? prev : {}) as Record<string, unknown>;
  const prevErrors = Array.isArray(p.errors) ? (p.errors as ImportSummary["errors"]) : [];
  return {
    total: count(p.total) + chunk.total,
    created: count(p.created) + chunk.created,
    merged: count(p.merged) + chunk.merged,
    skipped: count(p.skipped) + chunk.skipped,
    failed: count(p.failed) + chunk.failed,
    errors: [...prevErrors, ...chunk.errors].slice(0, MAX_ERRORS),
  };
}

/**
 * Why a merge must not run, or null when it may.
 *
 * Each of these used to go wrong quietly:
 *   - no target: counted as "skipped" with nothing said;
 *   - no fills: `tj_replace_executions([])` deleted every fill of the trade;
 *   - a second row into the same trade: the second overwrote the first, and
 *     undo could only put back one of the two.
 */
export function mergeRefusal(
  item: { matched_position_id: string | null; executions: readonly unknown[] },
  mergedInThisBatch: ReadonlySet<string>,
): string | null {
  if (!item.matched_position_id) return "No trade chosen to merge into.";
  if (item.executions.length === 0) {
    return "Nothing to merge: the row has no readable fills — the trade was left as it was.";
  }
  if (mergedInThisBatch.has(item.matched_position_id)) {
    return "Another row of this import already merged into this trade.";
  }
  return null;
}

/**
 * The plan a trade CREATED by the import gets from the file (K3).
 *
 * A trade that was never written as a plan in the journal used to arrive with
 * an empty plan — no entry, no stop, no target — so its R, its slippage and
 * the `stop_loss_set` rule had nothing to read. The entry is the size-weighted
 * average of the entry fills (the price the trade was taken at); the stop and
 * the target are the file's when it carries them, and absent otherwise. Only a
 * key with a value is returned, so nothing is written as null.
 */
export function importedPlan(item: {
  executions: readonly { side: "entry" | "exit"; price: number; qty: number }[];
  stop_price?: number | null;
  target_price?: number | null;
}): { entry_price?: number; stop_price?: number; target_price?: number } {
  const entries = item.executions.filter((e) => e.side === "entry" && e.qty > 0 && e.price > 0);
  const qty = entries.reduce((s, e) => s + e.qty, 0);
  const out: { entry_price?: number; stop_price?: number; target_price?: number } = {};
  if (qty > 0) out.entry_price = entries.reduce((s, e) => s + e.price * e.qty, 0) / qty;
  if (item.stop_price != null && item.stop_price > 0) out.stop_price = item.stop_price;
  if (item.target_price != null && item.target_price > 0) out.target_price = item.target_price;
  return out;
}
