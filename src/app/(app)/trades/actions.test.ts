import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The blown-account guard on the trade edit path.
 *
 * A breached prop-firm account blocks NEW EXPOSURE, never the record: an edit
 * that turns a plan into a live position is refused, a record-only edit goes
 * through. (Creating a trade by hand left with the plan form in phase O.)
 */

const topstepFailed = vi.fn<(id: string | null | undefined) => Promise<boolean>>();
const rpc = vi.fn();
const budgetPatch = vi.fn(async (..._a: unknown[]): Promise<Record<string, number | null>> => ({}));
/** Answers per table, in call order: each `from(table)` takes the next one. */
let tableAnswers: Record<string, unknown[]> = {};

function chain(table: string) {
  const answer = () => ({ data: (tableAnswers[table] ?? []).shift() ?? null, error: null });
  const c: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "order", "range", "update"]) c[m] = () => c;
  c.maybeSingle = async () => answer();
  c.then = (ok: (v: unknown) => unknown) => Promise.resolve(answer()).then(ok);
  return c;
}

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/journal/revalidate", () => ({ revalidateTrades: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc, from: (t: string) => chain(t) }),
}));
vi.mock("@/lib/journal/field-defs", () => ({ getFieldDefs: async () => [] }));
vi.mock("@/lib/journal/equity", () => ({ getEquityAtEntryPatch: async () => ({}) }));
vi.mock("@/lib/journal/accounts", () => ({ getAccountCurrency: async () => "USD" }));
vi.mock("@/lib/journal/instruments", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/journal/instruments")>()),
  getInstrumentSpecs: async () => new Map(),
}));
vi.mock("@/lib/journal/topstep-status", () => ({
  isTopstepAccountFailed: (id: string | null | undefined) => topstepFailed(id),
  getTopstepEntryPatch: (...a: unknown[]) => budgetPatch(...a),
}));

const { updateTrade } = await import("./actions");
type Input = Parameters<typeof updateTrade>[1];

const ACCOUNT = "11111111-1111-4111-8111-111111111111";
const fill = (side: "entry" | "exit", qty = 1) => ({
  side,
  price: 100,
  qty,
  executed_at: side === "entry" ? "2026-09-28T14:00:00.000Z" : "2026-09-28T14:10:00.000Z",
  fee: 0,
});

/** A limit written before price got there — no fills yet. */
const plan: Input = {
  account_id: ACCOUNT,
  trade_no: null,
  fields: {},
  executions: [],
  trade_phase: "planned",
  current_status: null,
};
/** A trade logged after it closed: entry and exit, same size. */
const logged: Input = {
  ...plan,
  executions: [fill("entry"), fill("exit")],
  trade_phase: "active",
};

beforeEach(() => {
  topstepFailed.mockReset().mockResolvedValue(false);
  rpc.mockReset().mockResolvedValue({ data: "new-id", error: null });
  budgetPatch.mockReset().mockResolvedValue({});
  tableAnswers = {};
});

describe("updateTrade on a Topstep account that hit its MLL", () => {
  beforeEach(() => topstepFailed.mockResolvedValue(true));

  it("refuses an edit that turns a plan into a live position", async () => {
    tableAnswers = { tj_positions: [{ status: "planned" }], tj_executions: [[]] };
    const res = await updateTrade("pos-1", { ...plan, executions: [fill("entry")], trade_phase: "active" });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.error).toMatch(/Topstep account hit its Maximum Loss Limit/);
    expect(!res.ok && res.error).toMatch(/Notes and review can still be edited/);
  });

  it("lets a record-only edit past the guard", async () => {
    // Same fills as before: no new exposure. The next read finds no row, which
    // proves the guard let it through to the write path.
    tableAnswers = {
      tj_positions: [{ status: "closed" }, null],
      tj_executions: [[{ side: "entry", qty: 1 }, { side: "exit", qty: 1 }]],
    };
    const res = await updateTrade("pos-1", logged);
    expect(res).toEqual({ ok: false, error: "Trade not found" });
  });
});

describe("the risk budget at entry is sealed on the write (F3, E4)", () => {
  it("updateTrade hands it the stored seal, so a sealed budget is never rewritten", async () => {
    tableAnswers = { tj_positions: [{ status: "closed", risk_budget_at_entry: 180, custom: {} }] };
    rpc.mockResolvedValue({ data: null, error: null });
    await updateTrade("pos-1", logged);
    expect(budgetPatch).toHaveBeenCalledWith(
      ACCOUNT,
      "closed",
      expect.any(Array),
      expect.objectContaining({ risk_budget_at_entry: 180 }),
    );
  });
});
