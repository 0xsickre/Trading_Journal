import { describe, expect, it } from "vitest";
import { planUndo, type UndoAuditRow } from "./import-undo";

const exec = (price: number) => ({
  side: "entry" as const,
  price,
  qty: 1,
  executed_at: "2026-01-01T00:00:00Z",
  fee: 0,
  swap_funding: 0,
});

describe("planUndo", () => {
  it("deletes positions the batch created", () => {
    const rows: UndoAuditRow[] = [
      { matched_position_id: "new-1", prev_executions: null },
      { matched_position_id: "new-2", prev_executions: null },
    ];
    const plan = planUndo(rows, ["new-1", "new-2"]);
    expect(plan.deleteIds.sort()).toEqual(["new-1", "new-2"]);
    expect(plan.restore).toEqual([]);
    expect(plan.unrestorableIds).toEqual([]);
  });

  it("does not mistake a created row for an unrestorable merge", () => {
    // Regression guard: created rows also carry a matched_position_id with a
    // null snapshot, which looks exactly like a pre-snapshot merge.
    const rows: UndoAuditRow[] = [
      { matched_position_id: "new-1", prev_executions: null },
    ];
    const plan = planUndo(rows, ["new-1"]);
    expect(plan.unrestorableIds).toEqual([]);
    expect(plan.deleteIds).toEqual(["new-1"]);
  });

  it("restores the fills a merge replaced", () => {
    const rows: UndoAuditRow[] = [
      { matched_position_id: "old-1", prev_executions: [exec(100), exec(101)] },
    ];
    const plan = planUndo<ReturnType<typeof exec>>(rows, []);
    expect(plan.deleteIds).toEqual([]);
    expect(plan.restore).toHaveLength(1);
    expect(plan.restore[0].positionId).toBe("old-1");
    expect(plan.restore[0].executions.map((e) => e.price)).toEqual([100, 101]);
  });

  it("restores a merge that displaced an empty fill set", () => {
    const rows: UndoAuditRow[] = [
      { matched_position_id: "old-1", prev_executions: [] },
    ];
    const plan = planUndo(rows, []);
    expect(plan.restore).toEqual([
      { positionId: "old-1", executions: [], clearTarget: false, clearExcursion: false },
    ]);
    expect(plan.unrestorableIds).toEqual([]);
  });

  it("flags merges from before the snapshot column instead of guessing", () => {
    const rows: UndoAuditRow[] = [
      { matched_position_id: "old-1", prev_executions: null },
    ];
    const plan = planUndo(rows, []);
    expect(plan.restore).toEqual([]);
    expect(plan.unrestorableIds).toEqual(["old-1"]);
  });

  it("ignores skipped rows", () => {
    const plan = planUndo([{ matched_position_id: null, prev_executions: null }], []);
    expect(plan).toEqual({ deleteIds: [], restore: [], unrestorableIds: [] });
  });

  it("restores a position only once when several rows touched it", () => {
    const rows: UndoAuditRow[] = [
      { matched_position_id: "old-1", prev_executions: [exec(100)] },
      { matched_position_id: "old-1", prev_executions: [exec(999)] },
    ];
    const plan = planUndo<ReturnType<typeof exec>>(rows, []);
    expect(plan.restore).toHaveLength(1);
    // The first row wins: it holds the state as it was before the batch ran.
    expect(plan.restore[0].executions[0].price).toBe(100);
  });

  it("handles a mixed batch", () => {
    const rows: UndoAuditRow[] = [
      { matched_position_id: "new-1", prev_executions: null },
      { matched_position_id: "old-1", prev_executions: [exec(100)] },
      { matched_position_id: "old-2", prev_executions: null },
      { matched_position_id: null, prev_executions: null },
    ];
    const plan = planUndo(rows, ["new-1"]);
    expect(plan.deleteIds).toEqual(["new-1"]);
    expect(plan.restore.map((r) => r.positionId)).toEqual(["old-1"]);
    expect(plan.unrestorableIds).toEqual(["old-2"]);
  });
});

describe("a target the import filled in", () => {
  it("is emptied again on undo, and only where this import wrote it", () => {
    const plan = planUndo(
      [
        { matched_position_id: "p1", prev_executions: [], target_written: true },
        { matched_position_id: "p2", prev_executions: [], target_written: false },
        // Batches imported before the flag existed carry no field at all.
        { matched_position_id: "p3", prev_executions: [] },
      ],
      [],
    );
    expect(plan.restore.map((r) => [r.positionId, r.clearTarget])).toEqual([
      ["p1", true],
      ["p2", false],
      ["p3", false],
    ]);
  });
});

describe("MAE/MFE the import filled in", () => {
  it("is emptied again on undo, and only where this import wrote it", () => {
    const plan = planUndo(
      [
        { matched_position_id: "p1", prev_executions: [], excursion_written: true },
        { matched_position_id: "p2", prev_executions: [], excursion_written: false },
        { matched_position_id: "p3", prev_executions: [] },
      ],
      [],
    );
    expect(plan.restore.map((r) => [r.positionId, r.clearExcursion])).toEqual([
      ["p1", true],
      ["p2", false],
      ["p3", false],
    ]);
  });
});
