import { beforeEach, describe, expect, it, vi } from "vitest";

/** Bias dana (faza D): a forecast is only ever inserted, only for today, never on a locked day. */

const USER = "97edd6db-12db-4156-9f89-77d2dcaa66d7";
const inserted: Record<string, unknown>[] = [];
let lockedAt: string | null = null;

const client = {
  from: vi.fn((table: string) => {
    if (table === "tj_daily_reports") {
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: lockedAt ? { locked_at: lockedAt } : null }) }) }),
      };
    }
    return {
      insert: async (row: Record<string, unknown>) => {
        inserted.push(row);
        return { error: null };
      },
    };
  }),
};

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => client }));
vi.mock("@/lib/supabase/user", () => ({ getCurrentUser: async () => ({ id: USER }) }));
vi.mock("@/lib/journal/accounts", () => ({ getPrimaryAccount: async () => null }));
vi.mock("@/lib/journal/time", async (orig) => ({
  ...(await orig<typeof import("@/lib/journal/time")>()),
  todayFor: () => "2026-10-19",
}));

const { addDailyBias } = await import("./bias-actions");

beforeEach(() => {
  inserted.length = 0;
  lockedAt = null;
});

describe("addDailyBias", () => {
  it("inserts today's forecast; the time is the database's, not sent", async () => {
    const res = await addDailyBias("2026-10-19", { root: "NQ", bias: "gore", reason: "  PDH iznad " });
    expect(res).toEqual({ ok: true });
    expect(inserted).toEqual([{ user_id: USER, trading_day: "2026-10-19", root: "NQ", bias: "gore", reason: "PDH iznad" }]);
  });

  it("refuses another day, a locked day, an unknown root or direction", async () => {
    expect(await addDailyBias("2026-10-18", { root: "NQ", bias: "gore" })).toEqual({
      ok: false,
      error: "Bias se upisuje samo za današnji dan.",
    });
    lockedAt = "2026-10-19T20:00:00Z";
    expect((await addDailyBias("2026-10-19", { root: "ES", bias: "dole" })).ok).toBe(false);
    lockedAt = null;
    expect((await addDailyBias("2026-10-19", { root: "6E" as "NQ", bias: "dole" })).ok).toBe(false);
    expect((await addDailyBias("2026-10-19", { root: "GC", bias: "long" as "gore" })).ok).toBe(false);
    expect(inserted).toEqual([]);
  });
});
