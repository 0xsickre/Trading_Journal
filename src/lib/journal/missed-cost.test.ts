import { describe, expect, it } from "vitest";
import { missedCost, missedRows, stalePlanCount } from "./missed-cost";
import type { TradeRow } from "./types";

/**
 * The panel's whole job is to be honest about what it does not know, so most
 * of this is about the unmeasured half.
 */

type Spec = {
  id: string;
  status?: string;
  reason?: string | null;
  outcome?: string | null;
  r?: number | null;
  createdAt?: string;
  tradeNo?: number | null;
};

const row = (s: Spec): TradeRow =>
  ({
    id: s.id,
    trade_no: s.tradeNo ?? null,
    instrument: "XAUUSD",
    status: s.status ?? "missed",
    created_at: s.createdAt ?? "2026-03-02T09:00:00Z",
    miss_reason: s.reason === undefined ? "Oklevanje" : s.reason,
    missed_outcome: s.outcome === undefined ? "target" : s.outcome,
    missed_r: s.r === undefined ? 3 : s.r,
    stats: null,
  }) as unknown as TradeRow;

describe("missedRows", () => {
  it("is about plans that were marked missed, and nothing else", () => {
    const rows = [row({ id: "m" }), row({ id: "p", status: "planned" }), row({ id: "c", status: "closed" })];
    expect(missedRows(rows).map((r) => r.id)).toEqual(["m"]);
  });
});

describe("missedCost", () => {
  it("adds the measured misses and says how many they were", () => {
    const cost = missedCost([
      row({ id: "a", r: 3 }),
      row({ id: "b", outcome: "stop", r: -1 }),
      row({ id: "c", outcome: "neither", r: 0 }),
    ]);
    expect(cost.totalR).toBe(2);
    expect(cost.measured).toBe(3);
    expect(cost.wouldHaveWorked).toBe(1);
  });

  it("counts an unmeasured miss rather than adding it as zero", () => {
    const cost = missedCost([
      row({ id: "a", r: 3 }),
      row({ id: "none", outcome: null, r: null }),
    ]);
    expect(cost.totalR).toBe(3);
    expect(cost.measured).toBe(1);
    expect(cost.unmeasured).toBe(1);
  });

  it("is null, not zero, when nothing has been measured at all", () => {
    // The state every book is in before the script has ever run.
    const cost = missedCost([row({ id: "a", outcome: null, r: null })]);
    expect(cost.totalR).toBeNull();
    expect(cost.unmeasured).toBe(1);
  });

  it("refuses half a measurement", () => {
    // An R with no outcome, or an outcome with no R: the pair is what the
    // database keeps coherent, and half of it is not a finding.
    expect(missedCost([row({ id: "a", outcome: null, r: 3 })]).totalR).toBeNull();
    expect(missedCost([row({ id: "b", r: null })]).totalR).toBeNull();
  });

  it("ignores an outcome it does not recognise", () => {
    expect(missedCost([row({ id: "a", outcome: "maybe", r: 3 })]).measured).toBe(0);
  });

  it("splits by reason, the most expensive first", () => {
    const cost = missedCost([
      row({ id: "a", reason: "Oklevanje", r: 3 }),
      row({ id: "b", reason: "Oklevanje", r: 2 }),
      row({ id: "c", reason: "Nisam bio za ekranom", r: 1 }),
    ]);
    expect(cost.byReason).toEqual([
      { reason: "Oklevanje", totalR: 5, n: 2 },
      { reason: "Nisam bio za ekranom", totalR: 1, n: 1 },
    ]);
  });

  it("keeps a miss with no reason as its own group rather than blaming one", () => {
    const cost = missedCost([row({ id: "a", reason: null, r: 3 })]);
    expect(cost.byReason).toEqual([{ reason: "", totalR: 3, n: 1 }]);
  });

  it("labels a miss by its trade number, falling back to the id", () => {
    const cost = missedCost([row({ id: "abcdef1234", tradeNo: 7 }), row({ id: "abcdef1234" })]);
    expect(cost.trades.map((t) => t.label)).toEqual(["#7", "abcdef12"]);
  });
});

describe("stalePlanCount — the denominator that keeps the sum honest", () => {
  it("counts plans left unresolved past the window", () => {
    const rows = [
      row({ id: "old", status: "planned", createdAt: "2026-02-01T09:00:00Z" }),
      row({ id: "fresh", status: "planned", createdAt: "2026-03-01T09:00:00Z" }),
      row({ id: "missed" }),
    ];
    expect(stalePlanCount(rows, "2026-03-05")).toBe(1);
  });

  it("says nothing about a plan with no written date", () => {
    const noDate = { ...row({ id: "x", status: "planned" }), created_at: null } as unknown as TradeRow;
    expect(stalePlanCount([noDate], "2026-03-05")).toBe(0);
  });
});
