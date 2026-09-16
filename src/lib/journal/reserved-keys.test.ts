import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RESERVED_KEYS } from "./reserved-keys";

/**
 * The list of reserved names has to follow the schema, and that has failed twice
 * already.
 *
 * The first time: `thesis`, `invalidation`, `time_stop_days`, `scale_out_plan`
 * added on 2026-08-13, with the list written before that. The second time:
 * `quote_currency_at_trade`, `fx_rate_at_trade` and `gross_pnl_override` added on
 * 08-15 — in the same run of steps in which the first omission was fixed. The
 * same mistake, twice, two days apart; that is no longer an oversight but a
 * missing check.
 *
 * Instead of updating the list by hand again, this test reads it from the
 * GENERATED `types.ts`, which mirrors the live schema. The next `ADD COLUMN`
 * fails the test until the name is added.
 *
 * Why parse the source rather than the type: `Database["public"]["Tables"]["tj_positions"]["Row"]`
 * exists only at compile time. Its keys cannot be enumerated at run time, so
 * reading the file is the only way to make the claim executable.
 */
function columnsFromGeneratedTypes(): string[] {
  const path = fileURLToPath(new URL("../supabase/types.ts", import.meta.url));
  const src = readFileSync(path, "utf8");

  const table = src.indexOf("      tj_positions: {");
  expect(table, "tj_positions was not found in the generated types").toBeGreaterThan(-1);

  // The first `Row: {` after the table name, up to its closing brace.
  const rowStart = src.indexOf("Row: {", table);
  const rowEnd = src.indexOf("\n        }", rowStart);
  expect(rowEnd).toBeGreaterThan(rowStart);

  const body = src.slice(rowStart, rowEnd);
  return [...body.matchAll(/^\s{10}([a-z_][a-z0-9_]*)\??:/gm)].map((m) => m[1]);
}

describe("RESERVED_KEYS follows the tj_positions schema", () => {
  it("covers every column from the generated types", () => {
    const columns = columnsFromGeneratedTypes();

    // Sanity before the claim: if the parser returned too few names, the test
    // would pass having proven nothing.
    expect(columns.length).toBeGreaterThanOrEqual(35);
    expect(columns).toContain("gross_pnl_override");
    expect(columns).toContain("entry_price");

    const missing = columns.filter((c) => !RESERVED_KEYS.has(c));
    expect(
      missing,
      `Columns on tj_positions that RESERVED_KEYS does not cover: ${missing.join(", ")}. ` +
        "A user field with that key would be written into `custom` and read from " +
        "the column — permanently invisible. Add them to src/lib/journal/reserved-keys.ts.",
    ).toEqual([]);
  });

  it("does not reserve names that do not exist on the table", () => {
    // The opposite direction: a reserved name with no column forbids the user a
    // key that would be perfectly valid, for no reason.
    const columns = new Set(columnsFromGeneratedTypes());
    const stale = [...RESERVED_KEYS].filter((k) => !columns.has(k));
    expect(stale, `Reserved names with no column: ${stale.join(", ")}`).toEqual([]);
  });
});
