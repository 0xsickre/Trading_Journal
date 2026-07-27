/**
 * Undo planning for an import batch — pure, so the decision is testable without
 * a database.
 *
 * Three kinds of audit row exist and each unwinds differently:
 *
 *   created  — the batch made the position; delete it (fills cascade)
 *   merged   — the batch replaced an existing position's fills; put the
 *              snapshot back and leave every subjective field alone
 *   skipped  — nothing happened; nothing to undo
 *
 * A created row also carries a matched_position_id (the row it just made), so
 * "merged" is identified by exclusion, never by the presence of that id alone.
 */

export type UndoAuditRow = {
  matched_position_id: string | null;
  /** Fills displaced by a merge. `null` for created/skipped rows, and for
   *  batches imported before the snapshot column existed. */
  prev_executions: unknown;
};

export type UndoPlan<T = unknown> = {
  /** Positions to delete outright. */
  deleteIds: string[];
  /** Positions to restore, with the fills to put back. */
  restore: { positionId: string; executions: T[] }[];
  /** Merged positions whose previous fills were never captured. */
  unrestorableIds: string[];
};

export function planUndo<T = unknown>(
  rows: UndoAuditRow[],
  createdPositionIds: Iterable<string>,
): UndoPlan<T> {
  const created = new Set(createdPositionIds);
  const plan: UndoPlan<T> = {
    deleteIds: [...created],
    restore: [],
    unrestorableIds: [],
  };

  const seen = new Set<string>();

  for (const row of rows) {
    const pid = row.matched_position_id;
    if (!pid) continue; // skipped row
    if (created.has(pid)) continue; // handled by deleteIds
    if (seen.has(pid)) continue; // one restore per position
    seen.add(pid);

    if (row.prev_executions == null) {
      plan.unrestorableIds.push(pid);
      continue;
    }
    plan.restore.push({
      positionId: pid,
      executions: (row.prev_executions as T[]) ?? [],
    });
  }

  return plan;
}
