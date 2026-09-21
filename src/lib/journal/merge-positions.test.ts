import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import {
  MERGE_COALESCE_COLUMNS,
  MERGE_UNION_COLUMNS,
  defaultMergeChoice,
  describeSide,
  mergeRefusal,
  type MergeSide,
} from "./merge-positions";

const side = (over: Partial<MergeSide> & { id: string }): MergeSide => ({
  tradeNo: 1,
  instrument: "XAUUSD",
  direction: "Long",
  accountId: "acc-1",
  source: "manual",
  createdAt: "2026-09-18T19:42:00Z",
  openedAt: "2026-03-07T14:00:00Z",
  avgEntry: 1327.45,
  avgExit: 1317.62,
  entryQty: 1,
  netPl: -983.4,
  ...over,
});

describe("what may not be merged", () => {
  it("refuses a trade into itself", () => {
    const a = side({ id: "a" });
    expect(mergeRefusal(a, a)).toMatch(/into itself/);
  });

  it("refuses two instruments — a merge deletes one of the two rows", () => {
    expect(
      mergeRefusal(side({ id: "a" }), side({ id: "b", instrument: "NAS100" })),
    ).toMatch(/Different instruments/);
  });

  it("refuses a long and a short", () => {
    expect(
      mergeRefusal(side({ id: "a" }), side({ id: "b", direction: "Short" })),
    ).toMatch(/long and a short/);
  });

  it("refuses two accounts — two books are two books", () => {
    expect(
      mergeRefusal(side({ id: "a" }), side({ id: "b", accountId: "acc-2" })),
    ).toMatch(/different accounts/);
  });

  it("allows the pair this exists for: one typed, one imported", () => {
    expect(
      mergeRefusal(side({ id: "a" }), side({ id: "b", source: "import" })),
    ).toBeNull();
  });
});

describe("which side keeps its identity", () => {
  it("the imported row supplies the fills, the typed one keeps the judgement", () => {
    const typed = side({ id: "typed", source: "manual" });
    const imported = side({ id: "imported", source: "import" });
    expect(defaultMergeChoice(typed, imported)).toEqual({
      keepId: "typed",
      fillsFromId: "imported",
    });
    // Order of the arguments must not change the answer.
    expect(defaultMergeChoice(imported, typed)).toEqual({
      keepId: "typed",
      fillsFromId: "imported",
    });
  });

  it("with two of a kind the newer one is the correction", () => {
    const older = side({ id: "older", createdAt: "2026-01-01T00:00:00Z" });
    const newer = side({ id: "newer", createdAt: "2026-02-01T00:00:00Z" });
    expect(defaultMergeChoice(older, newer)).toEqual({
      keepId: "older",
      fillsFromId: "newer",
    });
  });
});

describe("how a trade is named in the dialog", () => {
  it("carries what the trader would recognise it by", () => {
    const text = describeSide(side({ id: "a", tradeNo: 5 }), () => "03/07 14:00");
    expect(text).toBe("#5 · 03/07 14:00 · 1327.45→1317.62 · 1 lots");
  });
});

/**
 * ONE ANSWER PER QUESTION.
 *
 * The SQL does the merging and this module states the rule. Two lists of field
 * names would drift, and the drift would be invisible: a column added to one
 * and not the other simply stops being carried over, on a screen where nothing
 * says it should have been.
 */
describe("the migration and this module agree on the fields", () => {
  /**
   * The LATEST definition of the function, FOUND rather than named.
   *
   * This used to hold a filename, and it went stale the first time the
   * function was restated afterwards — the test then guarded a body that no
   * longer runs, which is worse than no guard because it still passes.
   * Migrations sort by their timestamp prefix, so the last file that defines
   * the function is the one the database has.
   */
  const sql = (() => {
    const dir = "supabase/migrations";
    const defines = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .filter((f) =>
        readFileSync(`${dir}/${f}`, "utf8").includes(
          "CREATE OR REPLACE FUNCTION public.tj_merge_positions",
        ),
      );
    expect(defines.length).toBeGreaterThan(0);
    return readFileSync(`${dir}/${defines[defines.length - 1]}`, "utf8");
  })();

  it("fills in every listed column from the other trade, and no other", () => {
    const found = [...sql.matchAll(/^\s{4}(\w+)\s*= COALESCE\(k\.\1, v_other\.\1\)/gm)].map(
      (m) => m[1],
    );
    expect(found.sort()).toEqual([...MERGE_COALESCE_COLUMNS].sort());
  });

  it("unions every tag column", () => {
    for (const col of MERGE_UNION_COLUMNS) {
      expect(sql).toContain(`unnest(k.${col} || v_other.${col})`);
    }
  });

  it("takes the money from the fills, including a null", () => {
    // Not COALESCE: an override that describes fills which are no longer on the
    // trade is a wrong number presented as fact.
    expect(sql).toContain("gross_pnl_override      = v_other.gross_pnl_override");
  });

  it("deletes the trade that gave up its fills", () => {
    expect(sql).toContain("DELETE FROM public.tj_positions WHERE id = p_fills_from");
  });

  it("refuses in SQL what the dialog refuses on screen", () => {
    expect(sql).toContain("Different instruments are not one trade.");
    expect(sql).toContain("A long and a short are not one trade.");
    expect(sql).toContain("These trades are on two different accounts.");
  });
});
