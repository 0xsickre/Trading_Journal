import { describe, expect, it } from "vitest";
import {
  computeEntrySlippage,
  fmtSlippageR,
  slippageFromTrade,
  fmtSlippagePts,
} from "./entry-slippage";
import type { TradeRow } from "./types";

describe("computeEntrySlippage", () => {
  it("long adverse fill: avg above planned", () => {
    const r = computeEntrySlippage({
      direction: "long",
      plannedEntry: 1.1,
      avgEntry: 1.1003,
      stopPrice: 1.099,
      entryQty: 1,
      pointValue: 100000,
    });
    expect(r).not.toBeNull();
    expect(r!.adversePts).toBeCloseTo(0.0003);
    expect(r!.slippageR).toBeCloseTo(0.3);
    expect(r!.favorable).toBe(false);
    expect(r!.slippageMoney).toBeCloseTo(0.0003 * 100000);
  });

  it("short adverse fill: avg below planned", () => {
    const r = computeEntrySlippage({
      direction: "short",
      plannedEntry: 1.1,
      avgEntry: 1.0997,
      stopPrice: 1.101,
      entryQty: 2,
    });
    expect(r!.adversePts).toBeCloseTo(0.0003);
    expect(r!.favorable).toBe(false);
  });

  it("favorable long fill: negative adversePts", () => {
    const r = computeEntrySlippage({
      direction: "long",
      plannedEntry: 1.1,
      avgEntry: 1.0998,
      stopPrice: 1.099,
    });
    expect(r!.adversePts).toBeCloseTo(-0.0002);
    expect(r!.favorable).toBe(true);
    expect(r!.slippageR).toBeCloseTo(-0.2);
  });

  it("returns null without planned or avg", () => {
    expect(
      computeEntrySlippage({
        direction: "long",
        plannedEntry: null,
        avgEntry: 1.1,
        stopPrice: 1.09,
      }),
    ).toBeNull();
    expect(
      computeEntrySlippage({
        direction: "long",
        plannedEntry: 1.1,
        avgEntry: null,
        stopPrice: 1.09,
      }),
    ).toBeNull();
  });

  it("slippageR null when stop missing or zero risk", () => {
    const noStop = computeEntrySlippage({
      direction: "long",
      plannedEntry: 1.1,
      avgEntry: 1.1001,
      stopPrice: null,
    });
    expect(noStop!.slippageR).toBeNull();

    const zeroRisk = computeEntrySlippage({
      direction: "long",
      plannedEntry: 1.1,
      avgEntry: 1.1001,
      stopPrice: 1.1,
    });
    expect(zeroRisk!.slippageR).toBeNull();
  });
});

describe("slippageFromTrade", () => {
  it("reads fields from TradeRow", () => {
    const row = {
      id: "1",
      entry_price: 100,
      stop_price: 98,
      direction: "long",
      stats: { avg_entry: 100.5, entry_qty: 1, point_value: 1 },
    } as unknown as TradeRow;
    const r = slippageFromTrade(row);
    expect(r!.adversePts).toBe(0.5);
    expect(r!.slippageR).toBeCloseTo(0.25);
  });
});

describe("slippage is measured against the SEALED plan", () => {
  const sealed = {
    id: "1",
    entry_price: 100.5,
    stop_price: 98,
    direction: "long",
    // Entered planning 100; the entry was later edited up to the fill price,
    // which would read as a perfect entry off the live column.
    plan_snapshot: { entry_price: 100, stop_price: 98 },
    stats: { avg_entry: 100.5, entry_qty: 1, point_value: 1 },
  } as unknown as TradeRow;

  it("does not let an entry edited after the fill erase the slippage", () => {
    expect(slippageFromTrade(sealed)!.adversePts).toBe(0.5);
  });

  it("still reads the live columns for a trade that has no seal", () => {
    const unsealed = { ...sealed, plan_snapshot: null } as unknown as TradeRow;
    expect(slippageFromTrade(unsealed)!.adversePts).toBe(0);
  });
});

describe("fmtSlippageR", () => {
  it("inverts adverse to negative display", () => {
    expect(fmtSlippageR(0.08)).toBe("-0.08R");
    expect(fmtSlippageR(-0.03)).toBe("+0.03R");
  });
});

describe("slippage money needs a contract spec", () => {
  it("returns null money, but a real R, when point value is unknown", () => {
    const r = computeEntrySlippage({
      direction: "long",
      plannedEntry: 5000,
      avgEntry: 5001,
      stopPrice: 4990,
      entryQty: 2,
      pointValue: null,
    });
    expect(r!.slippageMoney).toBeNull();
    expect(r!.slippageR).toBeCloseTo(0.1);
  });

  it("slippageFromTrade does not price a trade the view refused to price", () => {
    const row = {
      id: "1",
      entry_price: 5000,
      stop_price: 4990,
      direction: "long",
      stats: { avg_entry: 5001, entry_qty: 2, point_value: null },
    } as unknown as TradeRow;
    const r = slippageFromTrade(row);
    expect(r!.slippageMoney).toBeNull();
    expect(r!.adversePts).toBeCloseTo(1);
  });
});

describe("fmtSlippagePts", () => {
  it("marks the direction of the slip with an explicit sign", () => {
    // Adverse is positive here: the number answers "how much worse than plan",
    // so a bare "0.0025" would read as an improvement to half the readers.
    expect(fmtSlippagePts(0.0025)).toBe("+0.0025 pts");
    expect(fmtSlippagePts(0)).toBe("+0.0000 pts");
  });

  it("keeps the minus for a fill better than the plan", () => {
    expect(fmtSlippagePts(-0.0012)).toBe("-0.0012 pts");
  });

  it("holds four decimals, because FX slippage lives there", () => {
    // Two decimals would render every EURUSD slip as 0.00.
    expect(fmtSlippagePts(0.00001)).toBe("+0.0000 pts");
    expect(fmtSlippagePts(1.23456)).toBe("+1.2346 pts");
  });
});

describe("fmtSlippageR inverts the sign so a cost reads as a cost", () => {
  it("shows adverse slippage as negative R", () => {
    // The stored value is "how much worse than plan", positive-is-bad. On
    // screen it joins other R figures where positive-is-good, so it is flipped.
    expect(fmtSlippageR(0.2)).toBe("-0.20R");
    expect(fmtSlippageR(-0.2)).toBe("+0.20R");
  });

  it("shows an em dash for a missing measurement", () => {
    expect(fmtSlippageR(null)).toBe("—");
    expect(fmtSlippageR(undefined)).toBe("—");
    expect(fmtSlippageR(Number.NaN)).toBe("—");
  });
});
