import { describe, expect, it } from "vitest";
import { importedPlan, mergeImportSummary, mergeRefusal, type ImportSummary } from "./import-commit";

const chunk = (over: Partial<ImportSummary> = {}): ImportSummary => ({
  total: 50,
  created: 40,
  merged: 5,
  skipped: 3,
  failed: 2,
  errors: [{ row: 7, instrument: "XAUUSD", error: "bad" }],
  ...over,
});

describe("a batch's summary over several chunks", () => {
  it("the first chunk is the summary", () => {
    expect(mergeImportSummary({ total: 0 }, chunk())).toEqual(chunk());
  });

  it("adds each chunk to what the batch already holds", () => {
    const after = mergeImportSummary(chunk(), chunk({ total: 15, created: 15, merged: 0, skipped: 0, failed: 0, errors: [] }));
    expect(after).toMatchObject({ total: 65, created: 55, merged: 5, skipped: 3, failed: 2 });
    expect(after.errors).toHaveLength(1);
  });

  it("keeps at most 50 errors, oldest first", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ row: i + 1, instrument: null, error: "x" }));
    const after = mergeImportSummary({ errors: many }, chunk({ errors: many.map((e) => ({ ...e, row: e.row + 50 })) }));
    expect(after.errors).toHaveLength(50);
    expect(after.errors[0].row).toBe(1);
  });

  it("reads a summary written by an older version, or none, as zeros", () => {
    expect(mergeImportSummary(null, chunk()).total).toBe(50);
    expect(mergeImportSummary({ total: "7", created: -3 }, chunk()).total).toBe(50);
  });
});

describe("when a merge must not run", () => {
  const fills = [{ side: "entry" }];

  it("without a target", () => {
    expect(mergeRefusal({ matched_position_id: null, executions: fills }, new Set())).toMatch(/No trade chosen/);
  });

  it("without a single fill — it would have deleted every fill of the trade", () => {
    expect(mergeRefusal({ matched_position_id: "p", executions: [] }, new Set())).toMatch(/Nothing to merge/);
  });

  it("into a trade another row of this import already merged into", () => {
    expect(mergeRefusal({ matched_position_id: "p", executions: fills }, new Set(["p"]))).toMatch(
      /already merged/,
    );
  });

  it("otherwise it may", () => {
    expect(mergeRefusal({ matched_position_id: "p", executions: fills }, new Set(["q"]))).toBeNull();
  });
});

describe("a trade the import creates gets its plan from the file (K3)", () => {
  const fill = (side: "entry" | "exit", price: number, qty: number) => ({ side, price, qty });

  it("takes the entry the trade was filled at, size-weighted over the entry fills", () => {
    expect(
      importedPlan({ executions: [fill("entry", 100, 1), fill("entry", 106, 2), fill("exit", 120, 3)] }),
    ).toEqual({ entry_price: 104 });
  });

  it("adds the stop and the target when the file carries them", () => {
    expect(
      importedPlan({ executions: [fill("entry", 100, 1)], stop_price: 95, target_price: 110 }),
    ).toEqual({ entry_price: 100, stop_price: 95, target_price: 110 });
  });

  it("writes nothing it does not have — never a null or a zero", () => {
    expect(importedPlan({ executions: [], stop_price: null, target_price: 0 })).toEqual({});
  });
});
