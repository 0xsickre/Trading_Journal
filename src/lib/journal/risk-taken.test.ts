import { describe, expect, it } from "vitest";

import {
  equityAtEntry,
  riskDispersion,
  riskMoneyAtEntry,
  riskPctTaken,
} from "./risk-taken";
import type { PositionStat, TradeRow } from "./types";

type StatSpec = Partial<PositionStat>;

/**
 * A closed trade with a stop 10 points below the entry, one contract, a point
 * value of 10 and no FX conversion — so the risk is a round 100.
 */
function mkRow(
  overrides: Record<string, unknown> = {},
  stats: StatSpec | null = {},
): TradeRow {
  return {
    id: "p1",
    account_id: "a1",
    trade_no: 1,
    status: "closed",
    source: "manual",
    needs_review: false,
    created_at: "2026-03-02T09:00:00Z",
    entry_price: 100,
    stop_price: 90,
    equity_at_entry: 10_000,
    ...overrides,
    stats:
      stats == null
        ? null
        : ({
            avg_entry: 100,
            entry_qty: 1,
            point_value: 10,
            fx_rate: 1,
            ...stats,
          } as PositionStat),
  } as TradeRow;
}

describe("riskMoneyAtEntry", () => {
  it("multiplies stop distance by size, point value and rate", () => {
    expect(riskMoneyAtEntry(mkRow())).toBe(100);
  });

  it("scales with the quantity actually filled, not the one planned", () => {
    // The risk was whatever was entered. A half fill risked half.
    expect(riskMoneyAtEntry(mkRow({}, { entry_qty: 0.5 }))).toBe(50);
  });

  it("converts into account currency through the rate", () => {
    expect(riskMoneyAtEntry(mkRow({}, { fx_rate: 1.5 }))).toBe(150);
  });

  it("falls back to the average fill when no entry was planned", () => {
    // plannedRiskPts prefers the plan and only then the fill — a trade taken
    // without a written entry still has a measurable distance to its stop.
    expect(riskMoneyAtEntry(mkRow({ entry_price: null }, { avg_entry: 95 }))).toBe(50);
  });

  it("refuses without a stop — no stop is no measurable risk", () => {
    expect(riskMoneyAtEntry(mkRow({ stop_price: null }))).toBeNull();
  });

  it("refuses a stop sitting on the entry", () => {
    expect(riskMoneyAtEntry(mkRow({ stop_price: 100 }))).toBeNull();
  });

  it("refuses an unpriced instrument rather than standing in a 1", () => {
    // The same refusal computePositionSize makes. A point value of 1 on an
    // index future understates the risk fiftyfold.
    expect(riskMoneyAtEntry(mkRow({}, { point_value: null }))).toBeNull();
    expect(riskMoneyAtEntry(mkRow({}, { point_value: 0 }))).toBeNull();
  });

  it("refuses when the rate is unknown", () => {
    expect(riskMoneyAtEntry(mkRow({}, { fx_rate: null }))).toBeNull();
  });

  it("refuses a trade with no fills at all", () => {
    expect(riskMoneyAtEntry(mkRow({}, { entry_qty: null }))).toBeNull();
    expect(riskMoneyAtEntry(mkRow({}, null))).toBeNull();
  });
});

describe("equityAtEntry", () => {
  it("reads the frozen column", () => {
    expect(equityAtEntry(mkRow())).toBe(10_000);
  });

  it("treats an absent or non-positive denominator as unanswered", () => {
    expect(equityAtEntry(mkRow({ equity_at_entry: null }))).toBeNull();
    expect(equityAtEntry(mkRow({ equity_at_entry: 0 }))).toBeNull();
  });
});

describe("riskPctTaken", () => {
  it("expresses the risk against the day's opening equity", () => {
    expect(riskPctTaken(mkRow())).toBe(1);
  });

  it("is null when the denominator was never frozen", () => {
    // A trade that predates the column, or one whose equity could not be known.
    expect(riskPctTaken(mkRow({ equity_at_entry: null }))).toBeNull();
  });

  it("is null when the numerator cannot be computed", () => {
    expect(riskPctTaken(mkRow({ stop_price: null }))).toBeNull();
  });
});

describe("riskDispersion", () => {
  it("is the population sigma of the risks taken", () => {
    // mean 2, deviations ±1 → sigma 1.
    expect(riskDispersion([1, 3])).toBe(1);
  });

  it("is zero for a book that sized every trade identically", () => {
    expect(riskDispersion([1, 1, 1])).toBe(0);
  });

  it("ignores trades whose risk is unknown", () => {
    expect(riskDispersion([1, null, 3])).toBe(1);
  });

  it("refuses below two values — one point has no spread to report", () => {
    expect(riskDispersion([1])).toBeNull();
    expect(riskDispersion([])).toBeNull();
    expect(riskDispersion([null, null])).toBeNull();
  });
});

describe("the sealed plan is what the risk is measured against", () => {
  it("keeps the stop the trade was entered with, however the row reads now", () => {
    // The trade was entered with a 10-point stop. Afterwards the stop was
    // widened to 20 — which halves every R on the trade if the live column is
    // read. The seal is the answer.
    const row = mkRow({
      stop_price: 80,
      plan_snapshot: { entry_price: 100, stop_price: 90 },
    });
    expect(riskMoneyAtEntry(row)).toBe(100);
  });

  it("falls back to the live columns for a trade written before the seal", () => {
    expect(riskMoneyAtEntry(mkRow({ plan_snapshot: null }))).toBe(100);
  });

  it("reads a field an import's seal never carried from the live row", () => {
    // An imported trade seals only what the file knew. The stop it was sized
    // at is still readable from the plan typed around it.
    const row = mkRow({ plan_snapshot: { target_price: 130 } });
    expect(riskMoneyAtEntry(row)).toBe(100);
  });
});

