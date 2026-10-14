import { describe, expect, it } from "vitest";
import {
  arrayFieldNames,
  getAllFormFields,
  numericFieldNames,
  positionFieldNames,
} from "./form-config";
import type { FieldDef } from "./field-def-types";
import { SEEDED_FIELD_DEFS } from "./field-defs.fixture";

const def = (over: Partial<FieldDef> & { key: string }): FieldDef => ({
  id: over.key,
  label: over.key,
  field_type: "select",
  list_key: null,
  show_phase: "always",
  sort_order: 0,
  is_active: true,
  show_when: "always",
  ...over,
});

describe("field inventory", () => {
  const names = positionFieldNames(SEEDED_FIELD_DEFS);

  it("carries every field the export and the mentor pack rely on", () => {
    // `setup_grade` is not here on purpose: the grade is derived from the
    // playbook criteria in `setup-score.ts`, never asked for.
    for (const key of [
      "instrument",
      "entry_price",
      "stop_price",
      "direction",
      "target_price",
      "planned_rr",
      "thesis",
      "technical_tags",
      "miss_reason",
      "exit_reason",
      "max_drawdown_price",
      "max_profit_price",
      "mistake",
      "psychology_tags",
      "execution_rating",
      "trade_journal_notes",
    ]) {
      expect(names).toContain(key);
    }
  });

  it("no longer carries the plan-before-entry fields (phase P)", () => {
    // A trade comes in by import; nothing plans it in the journal any more.
    for (const key of ["position_size", "scale_out_plan", "invalidation", "time_stop"]) {
      expect(names).not.toContain(key);
    }
  });

  it("no longer carries the manual result field", () => {
    // The outcome is derived, not declared: `classifyOutcome` reads net P&L
    // against the account's breakeven band.
    expect(names).not.toContain("result");
  });

  it("lists every field once", () => {
    expect(new Set(names).size).toBe(names.length);
  });

  it("delivers every user category, in the trader's sort_order", () => {
    const built = positionFieldNames([def({ key: "zulu", sort_order: 0 }), def({ key: "alpha", sort_order: 1 })]);
    expect(built.indexOf("zulu")).toBeLessThan(built.indexOf("alpha"));
  });

  it("keeps a category of every phase — the readers describe all trades at once", () => {
    expect(positionFieldNames([def({ key: "only_missed", show_phase: "missed" })])).toContain("only_missed");
  });
});

describe("mistake is a tags field, not a select", () => {
  it("SITS IN arrayFieldNames, which is what reroutes it to a text[] column", () => {
    expect(arrayFieldNames(SEEDED_FIELD_DEFS)).toContain("mistake");
  });

  it("is one column wide, like every category beside it", () => {
    const mistake = getAllFormFields(SEEDED_FIELD_DEFS).find((f) => f.name === "mistake")!;
    expect(mistake.type).toBe("tags");
    expect(mistake.colSpan).toBe(1);
  });
});

describe("execution rating", () => {
  it("SITS IN numericFieldNames, which is what coerces it for a smallint column", () => {
    expect(numericFieldNames(SEEDED_FIELD_DEFS)).toContain("execution_rating");
  });
});
