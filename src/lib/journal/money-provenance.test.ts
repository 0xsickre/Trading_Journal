import { describe, expect, it } from "vitest";
import { moneyProvenance, unpricedClosedCount } from "./money-provenance";
import type { PositionStat } from "./types";

/**
 * WHEN THE MONEY IS MISSING, THE SCREEN HAS TO SAY WHY.
 *
 * The view from Step 3 carries three columns about where money comes from. The
 * screen read only one of them, so the whole FX half was invisible: a trade with
 * a known `point_value` but no rate has null money and a tidy
 * `point_value_source = 'snapshot'`, which means a dash in the P/L column and not
 * one word about what the user can do.
 */

const s = (over: Partial<PositionStat> = {}) =>
  ({
    point_value_source: "snapshot",
    fx_rate_source: "same_currency",
    money_overridden: false,
    ...over,
  }) as PositionStat;

describe("moneyProvenance", () => {
  it("a sound trade carries no badge", () => {
    expect(moneyProvenance(s())).toEqual({
      label: null,
      title: null,
      unpriced: false,
    });
  });

  it("no stats means no badge, not a crash", () => {
    expect(moneyProvenance(null).label).toBeNull();
    expect(moneyProvenance(undefined).label).toBeNull();
  });

  it("unknown instrument → `unpriced`, and that is a fault", () => {
    const p = moneyProvenance(s({ point_value_source: "missing" }));
    expect(p.label).toBe("unpriced");
    expect(p.unpriced).toBe(true);
    expect(p.title).toContain("Settings");
  });

  it("unknown rate → `no FX` — THE HOLE THIS STEP CLOSED", () => {
    // This was the case with no marking at all. `point_value_source` is
    // `snapshot`, so the old check stayed quiet while the money columns were
    // null anyway.
    const p = moneyProvenance(s({ fx_rate_source: "missing" }));
    expect(p.label).toBe("no FX");
    expect(p.unpriced).toBe(true);
    expect(p.title).toContain("rate");
  });

  it("trade with no account → `no account`", () => {
    // It arises on its own when an account is deleted (`ON DELETE SET NULL`).
    // Without the account currency there is nothing to convert into.
    const p = moneyProvenance(s({ fx_rate_source: "no_account" }));
    expect(p.label).toBe("no account");
    expect(p.unpriced).toBe(true);
  });

  it("a result from a statement → `broker`, and that is NOT a fault", () => {
    // The distinction `unpriced` carries: the badge exists, but the money is
    // here and it is correct. A screen that paints trouble red has to look at
    // `unpriced`, not at the presence of a badge — otherwise the most reliable
    // number in the system would be coloured as an error.
    const p = moneyProvenance(s({ money_overridden: true }));
    expect(p.label).toBe("broker");
    expect(p.unpriced).toBe(false);
    expect(p.title).toContain("R is still measured from prices");
  });

  it("a recorded result beats both an unknown rate and an unknown spec", () => {
    // The order is the order of CAUSES. When gross does not come out of prices,
    // neither the spec nor the rate was needed for it — so their absence is no
    // reason for alarm.
    const p = moneyProvenance(
      s({
        money_overridden: true,
        point_value_source: "missing",
        fx_rate_source: "missing",
      }),
    );
    expect(p.label).toBe("broker");
    expect(p.unpriced).toBe(false);
  });

  it("a missing spec is reported before a missing rate", () => {
    // Both are true, but `point_value` is the first condition and the first
    // thing the user fixes. Two badges on one row would not say more.
    const p = moneyProvenance(
      s({ point_value_source: "missing", fx_rate_source: "missing" }),
    );
    expect(p.label).toBe("unpriced");
  });

  it("every badge carries a sentence, none is a bare label", () => {
    for (const stats of [
      s({ point_value_source: "missing" }),
      s({ fx_rate_source: "missing" }),
      s({ fx_rate_source: "no_account" }),
      s({ money_overridden: true }),
    ]) {
      const p = moneyProvenance(stats);
      expect(p.title, p.label ?? "").toBeTruthy();
      expect(p.title!.length).toBeGreaterThan(40);
    }
  });
});

describe("unpricedClosedCount — the Step 9 finding", () => {
  const t = (over: Record<string, unknown> = {}) =>
    ({
      id: "t",
      status: "closed",
      stats: { net_pl: 100 },
      ...over,
    }) as unknown as Parameters<typeof unpricedClosedCount>[0][number];

  it("counts closed trades with no net result", () => {
    expect(
      unpricedClosedCount([
        t(),
        t({ stats: { net_pl: null } }),
        t({ stats: null }),
      ]),
    ).toBe(2);
  });

  it("a fully priced book gives zero", () => {
    expect(unpricedClosedCount([t(), t(), t()])).toBe(0);
    expect(unpricedClosedCount([])).toBe(0);
  });

  it("planned, missed and OPEN trades are not a gap", () => {
    // None of them has a realized result that the statistics would leave out.
    // If they counted, the banner would stand on every book with one open
    // position — and would stop meaning anything.
    expect(
      unpricedClosedCount([
        t({ status: "planned", stats: null }),
        t({ status: "missed", stats: null }),
        t({ status: "open", stats: { net_pl: null } }),
        t({ status: "partial", stats: { net_pl: null } }),
      ]),
    ).toBe(0);
  });

  it("the gap is exactly what `toRealized` drops on closed trades", () => {
    // The same boundary `toRealized` uses (`stats.net_pl == null`), so the
    // number in the banner cannot diverge from the number the page shows.
    const book = [
      t({ id: "a" }),
      t({ id: "b" }),
      t({ id: "c", stats: { net_pl: null } }),
    ];
    const kept = book.filter(
      (x) =>
        (x as { status: string }).status === "closed" &&
        (x as { stats: { net_pl: number | null } | null }).stats?.net_pl != null,
    ).length;
    expect(kept + unpricedClosedCount(book)).toBe(book.length);
  });
});
