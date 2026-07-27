import { describe, expect, it } from "vitest";
import {
  buildBalanceTimeline,
  computeDrawdown,
  currentEquity,
  netCashFlow,
  type CashEvent,
} from "./balance";

const trade = (at: string, pnl: number) => ({ at, pnl });

const cash = (
  at: string,
  amount: number,
  event_type: CashEvent["event_type"] = amount > 0 ? "deposit" : "withdrawal",
): CashEvent => ({
  id: at + amount,
  account_id: "acc",
  event_type,
  amount,
  occurred_at: at,
  note: null,
});

describe("buildBalanceTimeline", () => {
  it("starts at the starting balance before any event", () => {
    const tl = buildBalanceTimeline(10_000, [], []);
    expect(tl).toHaveLength(1);
    expect(tl[0].equity).toBe(10_000);
  });

  it("keeps cash flow out of realized P&L", () => {
    const tl = buildBalanceTimeline(
      10_000,
      [trade("2026-01-02T00:00:00Z", 500)],
      [cash("2026-01-03T00:00:00Z", 5_000)],
    );
    const last = tl[tl.length - 1];
    expect(last.realizedPnl).toBe(500);
    expect(last.cashFlow).toBe(5_000);
    expect(last.equity).toBe(15_500);
  });

  it("sorts unsorted input and funds a same-instant deposit first", () => {
    const at = "2026-01-02T00:00:00Z";
    const tl = buildBalanceTimeline(
      1_000,
      [trade(at, -100), trade("2026-01-01T00:00:00Z", 50)],
      [cash(at, 500)],
    );
    expect(tl.map((p) => p.kind)).toEqual([
      "start",
      "trade",
      "cash",
      "trade",
    ]);
    expect(currentEquity(tl)).toBe(1_450);
  });

  it("subtracts withdrawals and payouts", () => {
    const tl = buildBalanceTimeline(
      10_000,
      [],
      [cash("2026-02-01T00:00:00Z", -2_000, "payout")],
    );
    expect(currentEquity(tl)).toBe(8_000);
  });
});

describe("computeDrawdown", () => {
  it("returns zeros for an empty timeline", () => {
    const dd = computeDrawdown(buildBalanceTimeline(10_000, [], []));
    expect(dd.maxMoney).toBe(0);
    expect(dd.maxPctOfEquity).toBe(0);
  });

  it("measures the worst peak-to-trough drop in money and dates it", () => {
    const tl = buildBalanceTimeline(10_000, [
      trade("2026-01-01T00:00:00Z", 1_000), // peak +1000
      trade("2026-01-02T00:00:00Z", -400),
      trade("2026-01-03T00:00:00Z", -300), // trough +300, drop -700
      trade("2026-01-04T00:00:00Z", 900), // recovers to +1200
    ]);
    const dd = computeDrawdown(tl);
    expect(dd.maxMoney).toBe(-700);
    expect(dd.maxAt).toBe("2026-01-03T00:00:00Z");
  });

  it("leaves the money drawdown untouched by a deposit but moves the percentage", () => {
    const trades = [
      trade("2026-01-01T00:00:00Z", 1_000),
      trade("2026-01-03T00:00:00Z", -700),
    ];
    const without = computeDrawdown(buildBalanceTimeline(10_000, trades, []));
    const withDeposit = computeDrawdown(
      buildBalanceTimeline(10_000, trades, [
        cash("2026-01-02T00:00:00Z", 90_000),
      ]),
    );

    // Same dollars lost either way.
    expect(withDeposit.maxMoney).toBe(without.maxMoney);
    // But -700 against an 11k account is not the same as against a 101k account.
    expect(without.maxPctOfEquity).toBeCloseTo(6.364, 3);
    expect(withDeposit.maxPctOfEquity).toBeCloseTo(0.693, 3);
  });

  it("computes the Zella base off peak cumulative P&L, not equity", () => {
    const dd = computeDrawdown(
      buildBalanceTimeline(10_000, [
        trade("2026-01-01T00:00:00Z", 1_000),
        trade("2026-01-02T00:00:00Z", -500),
      ]),
    );
    // 500 / 1000 = 50 %, independent of the 10k starting balance.
    expect(dd.maxPctZella).toBe(50);
    expect(dd.maxPctOfEquity).toBeCloseTo(4.545, 3);
  });

  it("averages across drawdown episodes, not across every point", () => {
    const dd = computeDrawdown(
      buildBalanceTimeline(0, [
        trade("2026-01-01T00:00:00Z", 100), // peak 100
        trade("2026-01-02T00:00:00Z", -20), // episode 1 depth -20
        trade("2026-01-03T00:00:00Z", 50), // new peak 130
        trade("2026-01-04T00:00:00Z", -60), // episode 2 depth -60
        trade("2026-01-05T00:00:00Z", 100), // new peak
      ]),
    );
    expect(dd.avgMoney).toBe(-40);
    expect(dd.maxMoney).toBe(-60);
  });

  it("reports the open drawdown at the end of the period", () => {
    const dd = computeDrawdown(
      buildBalanceTimeline(10_000, [
        trade("2026-01-01T00:00:00Z", 1_000),
        trade("2026-01-02T00:00:00Z", -250),
      ]),
    );
    expect(dd.currentMoney).toBe(-250);
    expect(dd.currentPctOfEquity).toBeCloseTo(2.273, 3);
  });

  it("is zero when the curve only goes up", () => {
    const dd = computeDrawdown(
      buildBalanceTimeline(10_000, [
        trade("2026-01-01T00:00:00Z", 100),
        trade("2026-01-02T00:00:00Z", 200),
      ]),
    );
    expect(dd.maxMoney).toBe(0);
    expect(dd.currentMoney).toBe(0);
    expect(dd.avgMoney).toBe(0);
  });
});

describe("netCashFlow", () => {
  it("nets deposits against withdrawals", () => {
    expect(
      netCashFlow([
        cash("2026-01-01T00:00:00Z", 5_000),
        cash("2026-02-01T00:00:00Z", -1_500),
      ]),
    ).toBe(3_500);
  });
});
