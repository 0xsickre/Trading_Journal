import { describe, expect, it } from "vitest";
import {
  DEFAULT_VIEW,
  inBounds,
  parseViewState,
  periodBounds,
  summarizeTrades,
  tradeDayKey,
} from "./trades-view";
import { mkTrade } from "./reports/test-helpers";
import type { Account, TradeRow } from "./types";

const NY = "America/New_York";

function account(over: Partial<Account> & { id: string }): Account {
  return {
    name: "A",
    currency: "USD",
    starting_balance: 10_000,
    timezone: NY,
    is_active: true,
    breakeven_from: 0,
    breakeven_to: 0,
    breakeven_unit: "currency",
    ...over,
  } as unknown as Account;
}

describe("periodBounds", () => {
  // 2026-09-16 02:00 UTC is still Tuesday the 15th in New York.
  const now = new Date("2026-09-16T02:00:00Z");

  it("counts 'today' on the trader's clock, not UTC's", () => {
    expect(periodBounds("today", now, NY)).toEqual({ from: "2026-09-15", to: "2026-09-15" });
  });

  it("starts the week on Monday and the month on the 1st", () => {
    expect(periodBounds("week", now, NY)).toEqual({ from: "2026-09-14", to: "2026-09-15" });
    expect(periodBounds("month", now, NY)).toEqual({ from: "2026-09-01", to: "2026-09-15" });
    expect(periodBounds("ytd", now, NY)).toEqual({ from: "2026-01-01", to: "2026-09-15" });
  });

  it("makes 'last 30 days' thirty calendar days including today", () => {
    expect(periodBounds("30d", now, NY)).toEqual({ from: "2026-08-17", to: "2026-09-15" });
  });

  it("leaves an open side of a custom range open", () => {
    expect(periodBounds("custom", now, NY, { from: "2026-01-01", to: "" })).toEqual({
      from: "2026-01-01",
      to: null,
    });
    expect(periodBounds("all", now, NY)).toEqual({ from: null, to: null });
  });
});

describe("inBounds", () => {
  it("is inclusive on both ends", () => {
    const b = { from: "2026-09-01", to: "2026-09-15" };
    expect(inBounds("2026-09-01", b)).toBe(true);
    expect(inBounds("2026-09-15", b)).toBe(true);
    expect(inBounds("2026-08-31", b)).toBe(false);
    expect(inBounds("2026-09-16", b)).toBe(false);
  });
  it("keeps an undated row only when nothing is bounded", () => {
    expect(inBounds("", { from: null, to: null })).toBe(true);
    expect(inBounds("", { from: "2026-01-01", to: null })).toBe(false);
  });
});

describe("tradeDayKey", () => {
  it("is the OPEN day in the account's timezone", () => {
    const row = mkTrade({ id: "t" }).row;
    const t = {
      ...row,
      stats: { ...row.stats!, opened_at: "2026-09-16T02:00:00Z" },
    } as TradeRow;
    expect(tradeDayKey(t, NY)).toBe("2026-09-15");
  });
});

describe("summarizeTrades", () => {
  const A = account({ id: "acc-1" });

  it("computes over closed trades and counts the rest separately", () => {
    const rows = [
      mkTrade({ id: "w", net: 100, accountId: "acc-1" }).row,
      mkTrade({ id: "l", net: -50, accountId: "acc-1" }).row,
      mkTrade({ id: "o", net: 20, accountId: "acc-1", status: "open" }).row,
      { ...mkTrade({ id: "p", accountId: "acc-1" }).row, status: "planned", stats: null },
    ] as TradeRow[];
    const s = summarizeTrades(rows, [A]);
    expect(s.closed).toBe(2);
    expect(s.live).toBe(1);
    expect(s.notTaken).toBe(1);
    expect(s.stats?.netSum).toBe(50);
    expect(s.stats?.wins).toBe(1);
    expect(s.currency).toBe("USD");
  });

  it("refuses to name a currency when the trades span two", () => {
    const rows = [
      mkTrade({ id: "u", net: 100, accountId: "acc-1" }).row,
      mkTrade({ id: "e", net: 100, accountId: "acc-2" }).row,
    ];
    const s = summarizeTrades(rows, [A, account({ id: "acc-2", currency: "EUR" })]);
    expect(s.currency).toBeNull();
  });

  it("uses only the accounts actually in the set for the currency", () => {
    const rows = [mkTrade({ id: "u", net: 100, accountId: "acc-1" }).row];
    const s = summarizeTrades(rows, [A, account({ id: "acc-2", currency: "EUR" })]);
    expect(s.currency).toBe("USD");
  });

  it("has no stats for an empty set", () => {
    expect(summarizeTrades([], [A]).stats).toBeNull();
  });
});

describe("parseViewState", () => {
  it("falls back to the default for missing or broken storage", () => {
    expect(parseViewState(null)).toEqual(DEFAULT_VIEW);
    expect(parseViewState("{not json")).toEqual(DEFAULT_VIEW);
    expect(parseViewState("42")).toEqual(DEFAULT_VIEW);
  });

  it("keeps valid fields and drops malformed ones field by field", () => {
    const v = parseViewState(
      JSON.stringify({
        search: "nq",
        period: "bogus",
        filters: { instrument: "NQ", bad: 3 },
        sort: [{ id: "net", desc: false }, { id: 1 }],
        pageSize: 7,
        pageIndex: 2,
      }),
    );
    expect(v.search).toBe("nq");
    expect(v.period).toBe("all");
    expect(v.filters).toEqual({ instrument: "NQ" });
    expect(v.sort).toEqual([{ id: "net", desc: false }]);
    expect(v.pageSize).toBe(DEFAULT_VIEW.pageSize);
    expect(v.pageIndex).toBe(2);
  });
});
