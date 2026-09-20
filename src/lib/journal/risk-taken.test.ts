import { describe, expect, it } from "vitest";

import {
  RISK_INTENT_TOLERANCE,
  equityAtEntry,
  matchedRiskIntent,
  riskDispersion,
  riskIntentGap,
  riskIntentPct,
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
    risk_pct: "1%",
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

describe("riskIntentPct", () => {
  it("parses the dropdown's own spelling", () => {
    expect(riskIntentPct(mkRow({ risk_pct: "1.5%" }))).toBe(1.5);
  });

  it("is null when nothing was chosen", () => {
    expect(riskIntentPct(mkRow({ risk_pct: null }))).toBeNull();
    expect(riskIntentPct(mkRow({ risk_pct: "" }))).toBeNull();
  });
});

describe("riskIntentGap", () => {
  it("is zero when the trade sized itself to its own plan", () => {
    expect(riskIntentGap(mkRow())).toBe(0);
  });

  it("is unsigned, so oversizing and undersizing cannot cancel", () => {
    // 2 % taken against 1 % intended, and 0.5 % against 1 %: both are misses,
    // and averaging them with a sign would report a perfectly sized book.
    const over = riskIntentGap(mkRow({}, { entry_qty: 2 }));
    const under = riskIntentGap(mkRow({}, { entry_qty: 0.5 }));
    expect(over).toBeCloseTo(1, 10);
    expect(under).toBeCloseTo(0.5, 10);
  });

  it("is null when either side is unknown", () => {
    expect(riskIntentGap(mkRow({ risk_pct: null }))).toBeNull();
    expect(riskIntentGap(mkRow({ equity_at_entry: null }))).toBeNull();
  });
});

describe("matchedRiskIntent", () => {
  it("forgives lot granularity", () => {
    // 1.005 lots' worth of risk against a 1 % intention.
    expect(matchedRiskIntent(mkRow({}, { entry_qty: 1 + RISK_INTENT_TOLERANCE / 2 }))).toBe(true);
  });

  it("refuses a decision-sized miss", () => {
    expect(matchedRiskIntent(mkRow({}, { entry_qty: 1.5 }))).toBe(false);
  });

  it("answers null rather than false when the risk is unknown", () => {
    // Unknown is not a breach: the tracker reports it as not scored.
    expect(matchedRiskIntent(mkRow({ stop_price: null }))).toBeNull();
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
