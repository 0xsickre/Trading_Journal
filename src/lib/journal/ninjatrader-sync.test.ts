import { describe, expect, it } from "vitest";
import { ntImportItems, ntTrades, type NtFill, type NtOrder } from "./ninjatrader-sync";
import type { MatchCandidate } from "./import-match";

/**
 * Phase I3: the shapes the PC script posts, cut into trades. The first case is
 * the trader's MGC trade of 26.10.2026 as NinjaTrader stored it: one limit
 * entry filled in five pieces, an ATM bracket split 7 + 3, both stops hit.
 */
const T = (hhmmss: string, day = "2026-10-26") => `${day}T${hhmmss}.000Z`;
const fill = (over: Partial<NtFill> & Pick<NtFill, "id" | "time" | "side" | "qty" | "price">): NtFill => ({
  order_id: "o-entry",
  instrument: "MGCZ6",
  ...over,
});
const order = (over: Partial<NtOrder> & Pick<NtOrder, "id" | "type" | "side" | "time">): NtOrder => ({
  instrument: "MGCZ6",
  limit_price: null,
  stop_price: null,
  first_stop_price: null,
  ...over,
});

const mgcFills: NtFill[] = [
  fill({ id: "e1", time: T("10:09:07"), side: "buy", qty: 4, price: 4031.7 }),
  fill({ id: "e2", time: T("10:09:07"), side: "buy", qty: 1, price: 4031.7 }),
  fill({ id: "e3", time: T("10:09:08"), side: "buy", qty: 2, price: 4031.7 }),
  fill({ id: "e4", time: T("10:09:10"), side: "buy", qty: 3, price: 4031.7 }),
  fill({ id: "x1", order_id: "o-stop-a", time: T("10:23:12"), side: "sell", qty: 3, price: 4029.7 }),
  fill({ id: "x2", order_id: "o-stop-b", time: T("10:23:12"), side: "sell", qty: 7, price: 4029.7 }),
];
const mgcOrders: NtOrder[] = [
  order({ id: "o-entry", type: "limit", side: "buy", time: T("10:08:50"), limit_price: 4031.7 }),
  order({ id: "o-stop-b", type: "stop", side: "sell", time: T("10:09:07"), stop_price: 4029.8, first_stop_price: 4026.8 }),
  order({ id: "o-tgt-b", type: "limit", side: "sell", time: T("10:09:07"), limit_price: 4036.1 }),
  order({ id: "o-stop-a", type: "stop", side: "sell", time: T("10:09:10"), stop_price: 4029.8, first_stop_price: 4026.8 }),
  order({ id: "o-tgt-a", type: "limit", side: "sell", time: T("10:09:10"), limit_price: 4036.1 }),
];

describe("ntTrades: fills cut flat → flat, with the bracket read off the orders", () => {
  it("one MGC long of 10, out on its stops", () => {
    const [t, ...rest] = ntTrades(mgcFills, mgcOrders);
    expect(rest).toEqual([]);
    expect(t.key).toBe("e1");
    expect(t.direction).toBe("Long");
    expect(t.open).toBe(false);
    expect(t.fills.filter((f) => f.side === "entry").reduce((s, f) => s + f.qty, 0)).toBe(10);
    expect(t.fills.filter((f) => f.side === "exit").reduce((s, f) => s + f.qty, 0)).toBe(10);
    expect(t.entry_order_type).toBe("limit");
    expect(t.exit_kind).toBe("stop");
    // The stop the risk was taken with is the FIRST price, before it was moved.
    expect(t.stop_price).toBe(4026.8);
    expect(t.final_stop_price).toBe(4029.8);
    expect(t.target_price).toBe(4036.1);
  });

  it("a fill through flat closes one trade and opens the next", () => {
    const trades = ntTrades(
      [
        fill({ id: "a", time: T("14:00:00"), side: "buy", qty: 2, price: 100 }),
        fill({ id: "b", order_id: "m", time: T("14:05:00"), side: "sell", qty: 3, price: 101 }),
        fill({ id: "c", order_id: "m2", time: T("14:10:00"), side: "buy", qty: 1, price: 99 }),
      ],
      [order({ id: "m", type: "market", side: "sell", time: T("14:05:00") })],
    );
    expect(trades.map((t) => [t.key, t.direction, t.open])).toEqual([
      ["a", "Long", false],
      ["b#2", "Short", false],
    ]);
    expect(trades[0].exit_kind).toBe("manual");
    expect(trades[1].fills.map((f) => [f.external_id, f.side, f.qty])).toEqual([
      ["b#2", "entry", 1],
      ["c", "exit", 1],
    ]);
  });

  it("a position still on is a trade too, marked open, with no exit kind", () => {
    const [t] = ntTrades([fill({ id: "a", time: T("14:00:00"), side: "sell", qty: 1, price: 100 })], []);
    expect([t.direction, t.open, t.exit_kind]).toEqual(["Short", true, null]);
  });

  it("keeps contracts apart and leaves out an unreadable fill", () => {
    const trades = ntTrades(
      [
        fill({ id: "a", time: T("14:00:00"), side: "buy", qty: 1, price: 100 }),
        fill({ id: "b", instrument: "MNQZ6", time: T("14:01:00"), side: "buy", qty: 1, price: 29000 }),
        fill({ id: "z", time: "not a time", side: "sell", qty: 1, price: 101 }),
      ],
      [],
    );
    expect(trades.map((t) => [t.instrument, t.open])).toEqual([
      ["MGCZ6", true],
      ["MNQZ6", true],
    ]);
  });
});

describe("ntImportItems: what a run writes", () => {
  const same = (a: string, b: string) => a.replace(/Z6$/, "") === b.replace(/Z6$/, "");
  const [mgc] = ntTrades(mgcFills, mgcOrders);
  const run = (known: Map<string, string>, candidates: MatchCandidate[] = []) =>
    ntImportItems([mgc], known, candidates, "acc", () => 0.96, same);

  it("a new trade is created, with the fee from the commission per lot", () => {
    const { items, skipped } = run(new Map());
    expect(skipped).toEqual([]);
    expect(items).toHaveLength(1);
    expect(items[0].decision).toBe("create");
    expect(items[0].executions[0]).toMatchObject({ external_id: "e1", fee: 3.84, side: "entry" });
    expect(items[0].stop_price).toBe(4026.8);
    expect(items[0].stop_moved_to_profit).toBe(false);
  });

  it("the same fills again write nothing", () => {
    const known = new Map(mgc.fills.map((f) => [f.external_id, "pos-1"]));
    expect(run(known).items).toEqual([]);
  });

  it("an open trade that has closed since is merged into its trade", () => {
    const known = new Map(mgc.fills.filter((f) => f.side === "entry").map((f) => [f.external_id, "pos-1"]));
    const { items } = run(known);
    expect(items[0]).toMatchObject({ decision: "merge", matched_position_id: "pos-1" });
    expect(items[0].executions).toHaveLength(6);
  });

  it("fills spread over two journal trades are not merged", () => {
    const known = new Map([
      ["e1", "pos-1"],
      ["e2", "pos-2"],
    ]);
    const { items, skipped } = run(known);
    expect(items).toEqual([]);
    expect(skipped).toEqual([{ key: "e1", reason: expect.any(String) }]);
  });

  it("a trade already in the journal from another import is merged into (I-8)", () => {
    const existing: MatchCandidate = {
      id: "pos-csv",
      instrument: "MGC",
      direction: "Long",
      avgEntry: 4031.7,
      avgExit: 4029.7,
      openedAt: T("10:09:07"),
      totalFees: 0,
      grossPl: null,
      netPl: null,
      accountId: "acc",
      entryQty: 10,
    };
    const { items } = run(new Map(), [existing]);
    expect(items[0]).toMatchObject({ decision: "merge", match_status: "match", matched_position_id: "pos-csv" });
  });

  it("a trade that only looks like one an hour away is created, not merged", () => {
    const later: MatchCandidate = {
      id: "pos-later",
      instrument: "MGC",
      direction: "Long",
      avgEntry: 4031.7,
      avgExit: 4029.7,
      openedAt: T("11:30:00"),
      totalFees: 0,
      grossPl: null,
      netPl: null,
      accountId: "acc",
      entryQty: 10,
    };
    expect(run(new Map(), [later]).items[0].decision).toBe("create");
  });
});
