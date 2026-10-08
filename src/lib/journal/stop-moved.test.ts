import { describe, expect, it } from "vitest";
import { needsOriginalStop, stopStatus } from "./stop-moved";
import type { TradeRow } from "./types";

const row = (over: Record<string, unknown>, avgEntry = 31246.5): TradeRow =>
  ({
    id: "t",
    direction: "Long",
    status: "closed",
    stop_price: null,
    final_stop_price: null,
    max_drawdown_price: null,
    exit_reason: null,
    stats: { avg_entry: avgEntry },
    ...over,
  }) as unknown as TradeRow;

describe("stopStatus", () => {
  it("trade #1: the price went past the last stop and the target closed it — moved", () => {
    expect(
      stopStatus(row({ final_stop_price: 31227.5, max_drawdown_price: 31206.5, exit_reason: "Pogođen target" })),
    ).toBe("moved_mae");
  });

  it("a last stop at the entry is breakeven — moved", () => {
    expect(stopStatus(row({ final_stop_price: 30969.75 }, 30969.75))).toBe("moved_be");
  });

  it("a short reads the other way", () => {
    expect(stopStatus(row({ direction: "Short", final_stop_price: 100 }, 101))).toBe("moved_be");
    expect(stopStatus(row({ direction: "Short", final_stop_price: 105 }, 101))).toBe("unchanged");
  });

  it("stopped out a little past the stop is slippage, not a move", () => {
    expect(
      stopStatus(row({ final_stop_price: 31207, max_drawdown_price: 31206, exit_reason: "Pogođen stop" }, 31240.25)),
    ).toBe("unchanged");
  });

  it("is unknown with no last stop", () => {
    expect(stopStatus(row({}))).toBe("unknown");
  });
});

describe("needsOriginalStop", () => {
  it("asks for the original while the trade has none, or only the last price", () => {
    const moved = { final_stop_price: 31227.5, max_drawdown_price: 31206.5, exit_reason: "Pogođen target" };
    expect(needsOriginalStop(row({ ...moved, stop_price: null }))).toBe(true);
    expect(needsOriginalStop(row({ ...moved, stop_price: 31227.5 }))).toBe(true);
    expect(needsOriginalStop(row({ ...moved, stop_price: 31196.25 }))).toBe(false);
  });

  it("never for a stop the file shows unmoved", () => {
    expect(needsOriginalStop(row({ final_stop_price: 31200, stop_price: 31200 }))).toBe(false);
  });
});
