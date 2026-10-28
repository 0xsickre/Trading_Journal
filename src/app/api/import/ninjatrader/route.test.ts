import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The NinjaTrader sync's door (phase I3): who gets past it. Everything after
 * the token is the import path, tested in `ninjatrader-sync.test.ts`.
 */

let getClaims: (token: string) => Promise<unknown>;
const from = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getClaims: (t: string) => getClaims(t) }, from }),
}));
vi.mock("@/app/(app)/import/actions", () => ({ commitImport: vi.fn() }));
// The query modules are not what this tests, and loading them would put them
// under the src/lib coverage floor unexercised (v8 counts files a test imports).
vi.mock("@/lib/journal/trades", () => ({ getTradesWithStats: vi.fn() }));
vi.mock("@/lib/journal/instruments", () => ({ getInstruments: vi.fn() }));
vi.mock("@/lib/supabase/paginate", () => ({ selectAllByIds: vi.fn() }));

const { POST } = await import("./route");

const post = (headers: Record<string, string>, body: unknown = { account: "TDFY1", fills: [], orders: [] }) =>
  POST(new Request("http://x/api/import/ninjatrader", { method: "POST", headers, body: JSON.stringify(body) }));

beforeEach(() => {
  from.mockReset();
  getClaims = async () => ({ data: { claims: { sub: "u1" } }, error: null });
});

describe("POST /api/import/ninjatrader — the token", () => {
  it("no Authorization header: 401, nothing read", async () => {
    const res = await post({});
    expect(res.status).toBe(401);
    expect(from).not.toHaveBeenCalled();
  });

  it("a malformed token is a 401, not a 500 (general check, 28.10.2026)", async () => {
    // getClaims throws on a token it cannot decode ("Invalid UTF-8 sequence").
    getClaims = async () => {
      throw new Error("Invalid UTF-8 sequence");
    };
    const res = await post({ authorization: "Bearer abc.def.ghi" });
    expect(res.status).toBe(401);
    expect(from).not.toHaveBeenCalled();
  });

  it("a token Supabase refuses: 401", async () => {
    getClaims = async () => ({ data: null, error: new Error("expired") });
    expect((await post({ authorization: "Bearer x" })).status).toBe(401);
  });

  it("a valid token with a body that is not the script's shape: 400", async () => {
    const res = await post({ authorization: "Bearer ok" }, { account: "", fills: "no" });
    expect(res.status).toBe(400);
    expect(from).not.toHaveBeenCalled();
  });
});
