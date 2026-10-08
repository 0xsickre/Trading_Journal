import { describe, expect, it } from "vitest";
import {
  TOPSTEPX_ORDER_HEADERS,
  bracketFor,
  isTopstepXOrders,
  readTopstepXOrders,
} from "./topstepx-orders";

const row = (o: Partial<Record<string, string>>) => ({
  Id: "1",
  AccountName: "ACC",
  ContractName: "MNQZ6",
  Status: "",
  Type: "",
  Size: "3",
  Side: "",
  CreatedAt: "",
  TradeDay: "",
  FilledAt: "",
  CancelledAt: "",
  TriggeredAt: "",
  StopPrice: "",
  LimitPrice: "",
  ExecutePrice: "",
  TriggeredPrice: "",
  PositionDisposition: "",
  CreationDisposition: "",
  RejectionReason: "",
  ExchangeOrderId: "",
  PlatformOrderId: "",
  ...o,
});

/** Trade #1 on the 50K Combine, 07.10.2026: target hit, the stop raised during the trade. */
const TRADE_1 = readTopstepXOrders([
  row({ Id: "3614074691", Status: "Filled", Type: "Market", Side: "Bid", CreatedAt: "10/07/2026 16:20:37 +02:00", FilledAt: "10/07/2026 16:20:37 +02:00", ExecutePrice: "31246.500000000", PositionDisposition: "Opening", CreationDisposition: "Trader" }),
  row({ Id: "3614074698", Status: "Filled", Type: "Limit", Side: "Ask", CreatedAt: "10/07/2026 16:20:37 +02:00", FilledAt: "10/07/2026 17:49:06 +02:00", LimitPrice: "31366.500000000", ExecutePrice: "31366.500000000", PositionDisposition: "Closing", CreationDisposition: "TakeProfit" }),
  row({ Id: "3614074697", Status: "Cancelled", Type: "Stop", Side: "Ask", CreatedAt: "10/07/2026 16:20:37 +02:00", CancelledAt: "10/07/2026 17:49:06 +02:00", StopPrice: "31227.500000000", PositionDisposition: "Undetermined", CreationDisposition: "StopLoss" }),
]);

/** Practice, 07.10.2026: stopped out. */
const PRACTICE = readTopstepXOrders([
  row({ Id: "3612966143", Status: "Filled", Type: "Market", Size: "4", Side: "Bid", CreatedAt: "10/07/2026 14:46:01 +02:00", FilledAt: "10/07/2026 14:46:01 +02:00", ExecutePrice: "31240.250000000", PositionDisposition: "Opening", CreationDisposition: "Trader" }),
  row({ Id: "3612966144", Status: "Filled", Type: "Stop", Size: "4", Side: "Ask", CreatedAt: "10/07/2026 14:46:01 +02:00", FilledAt: "10/07/2026 15:37:47 +02:00", StopPrice: "31207.000000000", ExecutePrice: "31207.000000000", PositionDisposition: "Closing", CreationDisposition: "StopLoss" }),
  row({ Id: "3612966145", Status: "Cancelled", Type: "Limit", Size: "4", Side: "Ask", CreatedAt: "10/07/2026 14:46:01 +02:00", LimitPrice: "31375.500000000", PositionDisposition: "Undetermined", CreationDisposition: "TakeProfit" }),
]);

/** The trader's test, 08.10.2026: the stop moved to breakeven, closed by hand. */
const BREAKEVEN = readTopstepXOrders([
  row({ Id: "3621599190", Status: "Filled", Type: "Market", Side: "Bid", CreatedAt: "10/08/2026 21:57:01 +02:00", FilledAt: "10/08/2026 21:57:01 +02:00", ExecutePrice: "30969.75", PositionDisposition: "Opening", CreationDisposition: "Trader" }),
  row({ Id: "3621599192", Status: "Cancelled", Type: "Stop", Side: "Ask", CreatedAt: "10/08/2026 21:57:01 +02:00", StopPrice: "30969.75", PositionDisposition: "Undetermined", CreationDisposition: "StopLoss" }),
  row({ Id: "3621599193", Status: "Cancelled", Type: "Limit", Side: "Ask", CreatedAt: "10/08/2026 21:57:01 +02:00", LimitPrice: "31103", PositionDisposition: "Undetermined", CreationDisposition: "TakeProfit" }),
  row({ Id: "3621604010", Status: "Filled", Type: "Market", Side: "Ask", CreatedAt: "10/08/2026 21:58:21 +02:00", FilledAt: "10/08/2026 21:58:21 +02:00", ExecutePrice: "30978.50", PositionDisposition: "Closing", CreationDisposition: "Trader" }),
]);

describe("recognising the orders export", () => {
  it("is its header, and not the trades export's", () => {
    expect(isTopstepXOrders([...TOPSTEPX_ORDER_HEADERS, "AccountName"])).toBe(true);
    expect(isTopstepXOrders(["Id", "ContractName", "EnteredAt", "ExitedAt"])).toBe(false);
  });
});

describe("the bracket of a trade", () => {
  it("trade #1: market entry, target filled, the last stop below the entry", () => {
    const b = bracketFor(
      { symbol: "MNQ", direction: "Long", entryTime: "2026-10-07T16:20:37+02:00", exitTime: "2026-10-07T17:49:06+02:00", entryPrice: 31246.5 },
      TRADE_1,
    );
    expect(b).toEqual({ entryType: "market", finalStop: 31227.5, target: 31366.5, exitKind: "target", stopMovedToProfit: false });
  });

  it("practice: stopped out at the stop", () => {
    const b = bracketFor(
      { symbol: "MNQ", direction: "Long", entryTime: "2026-10-07T14:46:01+02:00", exitTime: "2026-10-07T15:37:47+02:00", entryPrice: 31240.25 },
      PRACTICE,
    );
    expect(b).toEqual({ entryType: "market", finalStop: 31207, target: 31375.5, exitKind: "stop", stopMovedToProfit: false });
  });

  it("the breakeven test: a stop at the entry was moved, and the close was by hand", () => {
    const b = bracketFor(
      { symbol: "MNQ", direction: "Long", entryTime: "2026-10-08T21:57:01+02:00", exitTime: "2026-10-08T21:58:21+02:00", entryPrice: 30969.75 },
      BREAKEVEN,
    );
    expect(b?.stopMovedToProfit).toBe(true);
    expect(b?.exitKind).toBe("manual");
    expect(b?.finalStop).toBe(30969.75);
  });

  it("finds nothing for a trade the file does not cover", () => {
    expect(
      bracketFor(
        { symbol: "MES", direction: "Long", entryTime: "2026-10-07T16:20:37+02:00", exitTime: "2026-10-07T17:49:06+02:00", entryPrice: 6000 },
        TRADE_1,
      ),
    ).toBeNull();
  });
});
