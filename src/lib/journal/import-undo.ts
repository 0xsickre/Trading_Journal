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
  /**
   * Whether THIS row filled in a target the position did not have.
   *
   * Undo empties it again. The flag exists rather than a "clear it if it is
   * set" rule because the trader may have typed a target of their own since,
   * and an undo that erased that would be a second edit rather than a reversal.
   */
  target_written?: boolean | null;
  /** Whether THIS row wrote MAE/MFE onto a position that had none — the same rule as the target. */
  excursion_written?: boolean | null;
  /**
   * The position's status and review flag before THIS row merged into it.
   *
   * Recorded since the merge order was fixed, inside the audit row's `parsed`
   * jsonb. Without it undo recomputed the status from the restored fills, so a
   * MISSED plan came back as `planned`. Absent on older batches, which then
   * fall back to that recomputation.
   */
  prev_status?: string | null;
  prev_needs_review?: boolean | null;
};

export type UndoPlan<T = unknown> = {
  /** Positions to delete outright. */
  deleteIds: string[];
  /** Positions to restore, with the fills to put back and whether the target
   *  and the MAE/MFE this import wrote have to go back to empty. */
  restore: {
    positionId: string;
    executions: T[];
    clearTarget: boolean;
    clearExcursion: boolean;
    /** The status to put back, when the audit row recorded one. */
    prevStatus: string | null;
    prevNeedsReview: boolean | null;
  }[];
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

  /**
   * Every row that touched one position, IN THE ORDER THEY WERE WRITTEN — the
   * caller hands rows oldest first. More than one row can merge into the same
   * trade (older batches allowed it), and then only the FIRST row's snapshot is
   * the state before the import; a later one holds what the earlier row wrote.
   * This used to keep whichever row came first by uuid, which is random, and
   * could hand back the import's own fills as "the original".
   *
   * The two "this import wrote it" flags are the opposite: any row having
   * written the target means the target is the import's, so they are OR-ed.
   */
  const byPosition = new Map<string, UndoAuditRow[]>();
  for (const row of rows) {
    const pid = row.matched_position_id;
    if (!pid) continue; // skipped row
    if (created.has(pid)) continue; // handled by deleteIds
    const list = byPosition.get(pid) ?? [];
    list.push(row);
    byPosition.set(pid, list);
  }

  for (const [pid, list] of byPosition) {
    // The earliest row WITH a snapshot is the state before the import. A row
    // without one is a skip that still named the trade — the wizard sends the
    // matched id on a duplicate — and it used to sit first in this list, so
    // the merge after it was reported unrestorable and never put back. Only a
    // position no row ever snapshotted (a batch older than the column) is
    // unrestorable.
    const first = list.find((r) => r.prev_executions != null);
    if (!first) {
      plan.unrestorableIds.push(pid);
      continue;
    }
    plan.restore.push({
      positionId: pid,
      executions: (first.prev_executions as T[]) ?? [],
      clearTarget: list.some((r) => r.target_written === true),
      clearExcursion: list.some((r) => r.excursion_written === true),
      prevStatus: first.prev_status ?? null,
      prevNeedsReview: first.prev_needs_review ?? null,
    });
  }

  return plan;
}
