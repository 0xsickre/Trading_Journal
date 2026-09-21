import { describe, expect, it } from "vitest";
import {
  planAmendedPatch,
  planAmendments,
  planFieldsOf,
  planSnapshotPatch,
  sealedNumber,
  sealedPlan,
  sealedText,
  sealedValue,
  PLAN_FIELDS,
  type PlanSnapshot,
} from "./plan-snapshot";
import type { TradeRow } from "./types";

/**
 * The point of the seal is that a number measured against the plan cannot be
 * improved after the outcome is known. Every test here is one way that could
 * still happen.
 */

const NOW = "2026-03-02T09:00:00Z";
const LATER = "2026-03-05T18:00:00Z";

const plan = (over: PlanSnapshot = {}): PlanSnapshot => ({
  entry_price: 100,
  stop_price: 90,
  target_price: 130,
  risk_pct: "1%",
  time_stop_days: 5,
  thesis: "Sweep of Friday's low, then reclaim",
  invalidation: "Close back below the low",
  scale_out_levels: null,
  ...over,
});

const row = (over: Record<string, unknown> = {}): TradeRow =>
  ({ id: "t1", ...plan(), ...over }) as unknown as TradeRow;

describe("planFieldsOf", () => {
  it("takes exactly the fields a plan is made of", () => {
    const fields = planFieldsOf({ ...plan(), instrument: "XAUUSD", notes: "after the fact" });
    expect(Object.keys(fields).sort()).toEqual([...PLAN_FIELDS].sort());
  });

  it("keeps a field the trader deliberately left empty, and drops one nobody sent", () => {
    const fields = planFieldsOf({ entry_price: 100, target_price: null });
    expect(fields).toEqual({ entry_price: 100, target_price: null });
    expect("stop_price" in fields).toBe(false);
  });
});

describe("planSnapshotPatch — written once, never rewritten, cleared on the way back", () => {
  it("seals on the save that first gives the trade a fill", () => {
    const patch = planSnapshotPatch("open", { plan_snapshot: null }, plan(), NOW);
    expect(patch.plan_sealed_at).toBe(NOW);
    expect(patch.plan_snapshot).toEqual(plan());
  });

  it("says nothing while the trade is still only a plan", () => {
    expect(planSnapshotPatch("planned", { plan_snapshot: null }, plan(), NOW)).toEqual({});
    expect(planSnapshotPatch("missed", { plan_snapshot: null }, plan(), NOW)).toEqual({});
  });

  it("never restates a seal — this is the whole feature", () => {
    const sealed = { plan_snapshot: plan({ stop_price: 90 }) };
    // A later save moves the stop. The seal does not move with it.
    const patch = planSnapshotPatch("closed", sealed, plan({ stop_price: 95 }), LATER);
    expect(patch).toEqual({});
  });

  it("clears the seal when the last fill is removed, and only then", () => {
    expect(planSnapshotPatch("planned", { plan_snapshot: plan() }, plan(), NOW)).toEqual({
      plan_snapshot: null,
      plan_sealed_at: null,
    });
    // An untouched plan must not produce a write on every save.
    expect(planSnapshotPatch("planned", null, plan(), NOW)).toEqual({});
  });

  it("seals an empty plan rather than nothing — 'there was no plan' is a finding", () => {
    const patch = planSnapshotPatch("open", null, {}, NOW);
    expect(patch.plan_snapshot).toEqual({});
    expect(patch.plan_sealed_at).toBe(NOW);
  });
});

describe("planAmendments — by value, never by whether the save mentioned the column", () => {
  it("is silent when the save repeats what was sealed", () => {
    // The trade form sends every plan field on every save; re-sending the same
    // values is not an amendment.
    expect(planAmendments(plan(), { ...plan() })).toEqual([]);
  });

  it("names the field that moved", () => {
    expect(planAmendments(plan(), { ...plan(), stop_price: 95 })).toEqual(["stop_price"]);
  });

  it("treats null, undefined and empty text as the same absence", () => {
    const sealed = plan({ target_price: null, thesis: "" });
    expect(planAmendments(sealed, { ...plan(), target_price: undefined, thesis: null })).toEqual([]);
  });

  it("reads a number typed back as text as the same number", () => {
    expect(planAmendments(plan(), { ...plan(), entry_price: "100" })).toEqual([]);
  });

  it("compares scale-out levels by their content", () => {
    const sealed = plan({ scale_out_levels: [{ price: 120, qty: 0.5 }] });
    expect(planAmendments(sealed, { ...plan(), scale_out_levels: [{ price: 120, qty: 0.5 }] })).toEqual(
      [],
    );
    expect(planAmendments(sealed, { ...plan(), scale_out_levels: [{ price: 125, qty: 0.5 }] })).toEqual(
      ["scale_out_levels"],
    );
  });

  it("ignores a field the seal never carried — an import seals what the file knew", () => {
    // `{}` is a real seal ("this trade had no plan"), and a plan typed in
    // afterwards is not an amendment of it.
    expect(planAmendments({ target_price: 130 }, { ...plan(), stop_price: 95 })).toEqual([]);
  });

  it("has nothing to say about a trade that was never sealed", () => {
    expect(planAmendments(null, plan({ stop_price: 95 }))).toEqual([]);
  });
});

describe("planAmendedPatch", () => {
  it("stamps the first time something moves after the seal", () => {
    expect(planAmendedPatch(plan(), plan({ stop_price: 95 }), null, LATER)).toEqual({
      plan_amended_at: LATER,
    });
  });

  it("does not stamp again — the badge says it happened, not how often", () => {
    expect(planAmendedPatch(plan(), plan({ stop_price: 95 }), NOW, LATER)).toEqual({});
  });

  it("stays quiet when nothing moved, and when nothing was sealed", () => {
    expect(planAmendedPatch(plan(), plan(), null, LATER)).toEqual({});
    expect(planAmendedPatch(null, plan({ stop_price: 95 }), null, LATER)).toEqual({});
  });
});

describe("sealedPlan — the one place that chooses seal or live row", () => {
  it("reads the seal when there is one, even though the row now says otherwise", () => {
    const r = row({ stop_price: 95, plan_snapshot: plan({ stop_price: 90 }) });
    expect(sealedNumber(r, "stop_price")).toBe(90);
    expect(sealedPlan(r).stop_price).toBe(90);
  });

  it("falls back to the live row for a trade that predates the seal", () => {
    const r = row({ stop_price: 95, plan_snapshot: null });
    expect(sealedNumber(r, "stop_price")).toBe(95);
  });

  it("reads sealed text, and an empty thesis as null", () => {
    const r = row({ thesis: "written afterwards", plan_snapshot: plan({ thesis: "" }) });
    expect(sealedText(r, "thesis")).toBe("");
    expect(sealedText(row({ plan_snapshot: plan({ thesis: null }) }), "thesis")).toBeNull();
  });

  it("answers null for a price the plan never held", () => {
    const r = row({ plan_snapshot: plan({ target_price: null }) });
    expect(sealedNumber(r, "target_price")).toBeNull();
  });

  it("reads a sealed price typed back as text, and refuses one that is not a number", () => {
    expect(sealedNumber(row({ plan_snapshot: plan({ stop_price: "90.5" }) }), "stop_price")).toBe(90.5);
    expect(sealedNumber(row({ plan_snapshot: plan({ stop_price: "about 90" }) }), "stop_price")).toBeNull();
    expect(sealedNumber(row({ plan_snapshot: plan({ stop_price: "" }) }), "stop_price")).toBeNull();
  });

  it("reads a sealed text field that was stored as something else", () => {
    // Nothing writes this today; it is here because a null would read as "no
    // thesis" and silently satisfy nothing, while the number is what was there.
    expect(sealedText(row({ plan_snapshot: plan({ thesis: 42 }) }), "thesis")).toBe("42");
  });

  it("reads a field the seal does not carry from the live row", () => {
    // A seal taken before a plan field existed: the old snapshot has no key.
    const r = row({ time_stop_days: 7, plan_snapshot: { entry_price: 100 } });
    expect(sealedNumber(r, "time_stop_days")).toBe(7);
    expect(sealedText(r, "invalidation")).toBe("Close back below the low");
  });
});

describe("sealedValue — the shapes that are neither a number nor a line of text", () => {
  it("reads a sealed ladder, including one the plan deliberately left empty", () => {
    const levels = [{ pct: 50, price: 120 }];
    expect(sealedValue(row({ plan_snapshot: plan({ scale_out_levels: levels }) }), "scale_out_levels")).toEqual(
      levels,
    );
    expect(
      sealedValue(
        row({ scale_out_levels: levels, plan_snapshot: plan({ scale_out_levels: null }) }),
        "scale_out_levels",
      ),
    ).toBeNull();
  });

  it("falls back to the live column for a key the seal does not carry", () => {
    // An import seals only what the file knew; the rest of the plan is still
    // the row's own.
    const r = row({ scale_out_levels: [{ pct: 50, price: 120 }], plan_snapshot: { target_price: 130 } });
    expect(sealedValue(r, "scale_out_levels")).toEqual([{ pct: 50, price: 120 }]);
  });
});
