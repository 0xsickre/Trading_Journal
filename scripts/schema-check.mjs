#!/usr/bin/env node
/**
 * Does `supabase/schema/production_base_tables.sql` still describe the real database?
 *
 * That file is the only record of ten tables built directly against the live
 * project before `supabase/migrations/` existed — the oldest migration in the
 * folder is a DROP, not a CREATE, so `CREATE TABLE public.tj_positions` appears
 * nowhere else. It calls itself authoritative and ends with "if a base table
 * ever changes, change it here too", and until now nothing enforced that.
 *
 * It had drifted: six columns added by later migrations were missing, and it
 * described `tj_column_mappings`, a table that does not exist in production at
 * all. A record nobody checks becomes a record nobody can trust, and this one
 * is the last line of defence for the part of the schema migrations do not
 * cover.
 *
 * WHAT IT CHECKS AGAINST, AND WHY NOT THE DATABASE
 *
 * `src/lib/supabase/types.ts` is generated from the live project by
 * `supabase gen types` and committed. It is what the whole app type-checks
 * against, so it cannot quietly fall behind: a stale copy breaks the build the
 * moment code reads a new column.
 *
 * Querying the database directly would need the service role key, and
 * `.env.example` refuses to let one into this repo for a good reason — it
 * bypasses row-level security entirely. So the comparison is record vs
 * generated types, which needs no secret and runs anywhere.
 *
 * Run with `npm run schema:check`. Exits non-zero on any disagreement.
 */

import { readFileSync } from "node:fs";

const RECORD = "supabase/schema/production_base_tables.sql";
const TYPES = "src/lib/supabase/types.ts";

// Line endings normalised on the way in. Git checks these out as CRLF on
// Windows, and every pattern below anchors on a bare newline; without this the
// script parses nothing and reports it as a shape change.
const read = (p) =>
  readFileSync(p, "utf8").split("\r\n").join("\n");

const sql = read(RECORD);
const types = read(TYPES);

/** Columns the record declares, per table. */
function recordedTables() {
  const out = new Map();
  const re = /^CREATE TABLE IF NOT EXISTS public\.(\w+) \(\n([\s\S]*?)^\);/gm;
  for (const m of sql.matchAll(re)) {
    const cols = [];
    for (const raw of m[2].split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("--")) continue;
      // Table-level constraints and the continuation lines of a column's
      // REFERENCES clause are not columns.
      if (/^(CONSTRAINT|PRIMARY KEY|UNIQUE|CHECK|FOREIGN KEY|REFERENCES|ON DELETE|DEFERRABLE)\b/i.test(line)) {
        continue;
      }
      const col = /^(\w+)\s+\S/.exec(line);
      if (col) cols.push(col[1]);
    }
    out.set(m[1], cols);
  }
  return out;
}

/**
 * Columns the generated types declare, per table.
 *
 * Read from each table's `Row:` block, which is the complete shape as it exists
 * — `Insert` and `Update` mark optionality and would answer a different
 * question.
 */
function typedTables() {
  const out = new Map();
  const re = /^ {6}(tj_\w+): \{\n {8}Row: \{\n([\s\S]*?)^ {8}\}/gm;
  for (const m of types.matchAll(re)) {
    const cols = [];
    for (const raw of m[2].split("\n")) {
      const col = /^ {10}(\w+)(\?)?:/.exec(raw);
      if (col) cols.push(col[1]);
    }
    out.set(m[1], cols);
  }
  return out;
}

const recorded = recordedTables();
const typed = typedTables();

if (recorded.size === 0) {
  console.error(`schema:check: parsed no tables out of ${RECORD} — has its shape changed?`);
  process.exit(1);
}
if (typed.size === 0) {
  console.error(`schema:check: parsed no tables out of ${TYPES} — has its shape changed?`);
  process.exit(1);
}

const problems = [];

for (const [table, cols] of recorded) {
  const live = typed.get(table);
  if (!live) {
    problems.push(
      `${table}: recorded here, but absent from the generated types — the table does not exist. Delete the block.`,
    );
    continue;
  }
  const missing = live.filter((c) => !cols.includes(c));
  const extra = cols.filter((c) => !live.includes(c));
  if (missing.length) {
    problems.push(`${table}: in the database, missing from the record — ${missing.join(", ")}`);
  }
  if (extra.length) {
    problems.push(`${table}: in the record, absent from the database — ${extra.join(", ")}`);
  }
}

if (problems.length === 0) {
  console.log(
    `schema:check: clean — ${recorded.size} recorded base tables match the generated types`,
  );
  process.exit(0);
}

console.error(`${RECORD} disagrees with ${TYPES}:\n`);
for (const p of problems) console.error(`  ${p}`);
console.error(
  `\n${problems.length} disagreement(s). Fix the record, or regenerate the types if the database is what moved.`,
);
process.exit(1);
