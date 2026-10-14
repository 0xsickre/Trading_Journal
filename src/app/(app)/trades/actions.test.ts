import { beforeEach, describe, expect, it, vi } from "vitest";
import { SEEDED_FIELD_DEFS } from "@/lib/journal/field-defs.fixture";
import type { FieldDef } from "@/lib/journal/field-def-types";

/**
 * The trade page's save (phase P). It must never go through `tj_save_trade`,
 * which deletes every rule answer first: trade #1 carries answers to rules since
 * unlinked and retired, and a save of its note must leave them standing.
 */

type Call = { table: string; op: string; args: unknown[]; filters: [string, unknown][] };
let calls: Call[] = [];
/** Answers per table, in call order: each read of a table takes the next one. */
let reads: Record<string, unknown[]> = {};

function chain(table: string) {
  const call: Call = { table, op: "select", args: [], filters: [] };
  const answer = () => ({ data: (reads[table] ?? []).shift() ?? null, error: null });
  const c: Record<string, unknown> = {};
  for (const op of ["update", "upsert", "delete", "insert"]) {
    c[op] = (...args: unknown[]) => {
      call.op = op;
      call.args = args;
      calls.push(call);
      return c;
    };
  }
  c.select = () => c;
  for (const f of ["eq", "in"]) {
    c[f] = (col: string, v: unknown) => {
      call.filters.push([col, v]);
      return c;
    };
  }
  for (const m of ["order", "limit"]) c[m] = () => c;
  c.maybeSingle = async () => answer();
  c.then = (ok: (v: unknown) => unknown) =>
    Promise.resolve(call.op === "select" ? answer() : { data: null, error: null }).then(ok);
  return c;
}

const rpc = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/journal/revalidate", () => ({ revalidateTrades: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc, from: (t: string) => chain(t) }),
}));
vi.mock("@/lib/supabase/user", () => ({ getCurrentUser: async () => ({ id: "user-1" }) }));
const DEFS: FieldDef[] = [
  ...SEEDED_FIELD_DEFS,
  { id: "htf", key: "htf_bias", label: "Bias dana", field_type: "select", list_key: "htf_bias", show_phase: "always", sort_order: 0, is_active: true, show_when: "always" },
];
vi.mock("@/lib/journal/field-defs", () => ({ getFieldDefs: async () => DEFS }));

const { saveTradeReview } = await import("./actions");

const BOOK = "00000000-0000-4000-8000-0000000000aa";
const R1 = "00000000-0000-4000-8000-0000000000b1";
const R2 = "00000000-0000-4000-8000-0000000000b2";

const base = {
  playbook_id: BOOK,
  execution_rating: 3,
  trade_journal_notes: "beleška",
  images: [],
};

beforeEach(() => {
  calls = [];
  rpc.mockReset();
  reads = {
    tj_positions: [{ exit_reason: null, plan_snapshot: null, playbook_id: BOOK, custom: { old_key: "x" } }],
    tj_playbook_rule_links: [[{ rule_id: R1 }, { rule_id: R2 }]],
    // R1 of this book, plus two retired rules no longer linked (trade #1).
    tj_position_rules: [[{ rule_id: R1 }, { rule_id: "retired-1" }, { rule_id: "retired-2" }]],
  };
});

describe("saveTradeReview", () => {
  it("writes the checklist without touching answers to rules outside the playbook", async () => {
    const res = await saveTradeReview("pos-1", { ...base, rule_answers: { [R1]: true, [R2]: false } });
    expect(res.ok).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
    const upsert = calls.find((c) => c.table === "tj_position_rules" && c.op === "upsert")!;
    expect(upsert.args[0]).toEqual([
      { rule_id: R1, followed: true, position_id: "pos-1", user_id: "user-1" },
      { rule_id: R2, followed: false, position_id: "pos-1", user_id: "user-1" },
    ]);
    expect(calls.some((c) => c.table === "tj_position_rules" && c.op === "delete")).toBe(false);
  });

  it("removes the previous playbook's answers when the playbook changed (P-3)", async () => {
    reads.tj_positions = [{ exit_reason: null, plan_snapshot: null, playbook_id: "old-book", custom: null }];
    await saveTradeReview("pos-1", { ...base, rule_answers: { [R1]: true, [R2]: true } });
    const del = calls.find((c) => c.table === "tj_position_rules" && c.op === "delete")!;
    expect(del.filters).toContainEqual(["rule_id", ["retired-1", "retired-2"]]);
  });

  it("routes categories to their column or the custom bag, keeping keys it did not send", async () => {
    await saveTradeReview("pos-1", {
      ...base,
      categories: { technical_tags: ["FVG"], htf_bias: "Bearish", exit_reason: "Pogođen stop" },
    });
    const update = calls.find((c) => c.table === "tj_positions" && c.op === "update")!;
    expect(update.args[0]).toMatchObject({
      technical_tags: ["FVG"],
      exit_reason: "Pogođen stop",
      custom: { old_key: "x", htf_bias: "Bearish" },
    });
  });

  it("refuses a category no definition claims", async () => {
    const res = await saveTradeReview("pos-1", { ...base, categories: { entry_price: "1" } });
    expect(res).toEqual({ ok: false, error: "Unknown category: entry_price" });
    expect(calls.some((c) => c.op === "update")).toBe(false);
  });
});
