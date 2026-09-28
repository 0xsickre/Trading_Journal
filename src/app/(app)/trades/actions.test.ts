import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The blown-account guard on the two trade write paths.
 *
 * A breached prop-firm account blocks NEW EXPOSURE, never the record: a plan
 * written on `/trades/new` is refused, a trade logged after it closed
 * (`/trades/log`, `origin: "log"`) goes through — including the very trade that
 * took the account through its limit. One rule for FTMO and Topstep.
 */

const ftmoFrozen = vi.fn<(id: string | null | undefined) => Promise<boolean>>();
const topstepFailed = vi.fn<(id: string | null | undefined) => Promise<boolean>>();
const rpc = vi.fn();
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
vi.mock("@/lib/journal/ftmo-status", () => ({
  isFtmoAccountFrozen: (id: string | null | undefined) => ftmoFrozen(id),
}));
vi.mock("@/lib/journal/topstep-status", () => ({
  isTopstepAccountFailed: (id: string | null | undefined) => topstepFailed(id),
}));

const { createTrade, updateTrade } = await import("./actions");
type Input = Parameters<typeof createTrade>[0];

const ACCOUNT = "11111111-1111-4111-8111-111111111111";
const fill = (side: "entry" | "exit", qty = 1) => ({
  side,
  price: 100,
  qty,
  executed_at: side === "entry" ? "2026-09-28T14:00:00.000Z" : "2026-09-28T14:10:00.000Z",
  fee: 0,
  swap_funding: 0,
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
  origin: "log",
};

beforeEach(() => {
  ftmoFrozen.mockReset().mockResolvedValue(false);
  topstepFailed.mockReset().mockResolvedValue(false);
  rpc.mockReset().mockResolvedValue({ data: "new-id", error: null });
  tableAnswers = {};
});

describe("createTrade on a Topstep account that hit its MLL", () => {
  beforeEach(() => topstepFailed.mockResolvedValue(true));

  it("refuses a plan", async () => {
    const res = await createTrade(plan);
    expect(res.ok).toBe(false);
    expect(!res.ok && res.error).toMatch(/Topstep account hit its Maximum Loss Limit/);
    expect(!res.ok && res.error).toMatch(/Settings/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("treats an input with no origin as a plan", async () => {
    const { origin: _origin, ...noOrigin } = logged;
    const res = await createTrade(noOrigin);
    expect(res.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("lets a trade logged after the close through — the record, not new exposure", async () => {
    const res = await createTrade(logged);
    expect(res).toEqual({ ok: true, id: "new-id" });
    expect(rpc).toHaveBeenCalledOnce();
  });

  it("does not let `log` carry a position that is still open", async () => {
    // A server action is a public endpoint: the exemption is for a closed trade,
    // and an entry with no exit is exposure whatever the caller calls it.
    const res = await createTrade({ ...logged, executions: [fill("entry")] });
    expect(res.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("createTrade on a frozen FTMO account", () => {
  beforeEach(() => ftmoFrozen.mockResolvedValue(true));

  it("still refuses a plan, with the same message", async () => {
    const res = await createTrade(plan);
    expect(res.ok).toBe(false);
    expect(!res.ok && res.error).toMatch(/The FTMO account is frozen/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("now lets a trade logged after the close through", async () => {
    const res = await createTrade(logged);
    expect(res).toEqual({ ok: true, id: "new-id" });
  });
});

describe("createTrade on a healthy account", () => {
  it("writes a plan", async () => {
    expect(await createTrade(plan)).toEqual({ ok: true, id: "new-id" });
  });

  it("rejects an origin it does not know", async () => {
    const res = await createTrade({ ...plan, origin: "import" as unknown as "log" });
    expect(res.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
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
