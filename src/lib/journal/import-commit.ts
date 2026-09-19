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
