import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getFieldDefs } from "./field-defs";
import { getAllFormFields } from "./form-config";
import {
  optionFieldTargets,
  type OptionFieldTarget,
  type OptionUsage,
} from "./option-usage";

/**
 * Counted with `head: true`, not by reading rows and measuring the array.
 *
 * PostgREST caps a response at `db-max-rows` (1000) and returns the truncated
 * page with HTTP 200 — so counting client-side would report "1000 trades" for
 * any popular tag, and the dialog would understate what it is about to change.
 * A head count is answered by the server and has no such ceiling. Same reason,
 * and same shape, as `account-usage-queries.ts`.
 */

/**
 * The column and operator that match one value in one field.
 *
 * Returned as a description rather than applied to a builder, so the caller
 * keeps PostgREST's own types all the way through — a helper taking the
 * builder would have to name a type PostgREST does not export.
 */
function filterFor(
  target: OptionFieldTarget,
): { column: string; op: "eq" | "contains" } {
  if (target.array) {
    // `->` and not `->>`: a jsonb array has to stay jsonb for `@>` to match.
    return {
      column: target.custom ? `custom->${target.key}` : target.key,
      op: "contains",
    };
  }
  return {
    column: target.custom ? `custom->>${target.key}` : target.key,
    op: "eq",
  };
}

/**
 * The trade fields fed by `listKey`, resolved against this user's field defs.
 *
 * Shared by the usage count and the rename cascade so the two can never
 * disagree about where a value lives — a count that missed a field would
 * understate the cost of a delete, and a cascade that missed the same field
 * would leave those trades behind.
 *
 * Archived defs included: a field the trader archived still has its old values
 * sitting on old trades, and a rename has to reach them too.
 */
export async function getOptionFieldTargets(
  listKey: string,
): Promise<OptionFieldTarget[]> {
  const defs = await getFieldDefs(false);
  return optionFieldTargets(getAllFormFields(defs), listKey);
}

/**
 * How many trades carry each of `values`, for the fields fed by `listKey`.
 *
 * One count per (value × field) rather than a GROUP BY, because a grouped read
 * comes back as ROWS and is subject to the same 1000-row cap the head count
 * exists to escape.
 *
 * A value can legitimately appear in more than one field — the psychology tags
 * merge two lists into one column — so per-field counts are summed. That can
 * double-count a trade holding the same value in two different fields, which is
 * the safe direction to be wrong in: it overstates the cost of a delete, and
 * this number's only job is to make the user careful.
 */
export async function getOptionUsage(
  listKey: string,
  values: string[],
): Promise<Record<string, OptionUsage>> {
  const out: Record<string, OptionUsage> = {};
  if (values.length === 0) return out;

  const targets = await getOptionFieldTargets(listKey);

  // A list no field reads can be deleted freely — there is nothing to warn
  // about, and it is the honest answer rather than a failed lookup.
  if (targets.length === 0) {
    for (const v of values) out[v] = { trades: 0 };
    return out;
  }

  const supabase = await createClient();

  await Promise.all(
    values.map(async (value) => {
      const counts = await Promise.all(
        targets.map((t) => {
          const { column, op } = filterFor(t);
          const q = supabase
            .from("tj_positions")
            .select("id", { count: "exact", head: true });
          return op === "contains" ? q.contains(column, [value]) : q.eq(column, value);
        }),
      );

      let total = 0;
      for (const c of counts) {
        // A failed count must not read as zero: that is the difference between
        // "nothing uses this" and "we could not find out", and only one of them
        // is safe to offer a one-click delete for.
        if (c.error) {
          total = -1;
          break;
        }
        total += c.count ?? 0;
      }
      out[value] = { trades: total };
    }),
  );

  return out;
}
