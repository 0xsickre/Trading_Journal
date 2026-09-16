import { describe, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/types";
import { narrowPositionStat } from "./types";

type StatsViewRow = Database["public"]["Views"]["tj_position_stats"]["Row"];

/**
 * THE BOUNDARY BETWEEN THE VIEW AND THE APPLICATION.
 *
 * `trades.ts` took a view row as `statRows as PositionStat[]` — a claim that
 * `position_id` is non-null and that the two `*_source` fields are closed sets.
 * PostgREST guarantees none of those three for a view, and nothing was checking
 * the claim.
 *
 * The TYPE itself is now derived from the generated types, so a divergence from
 * the schema fails typecheck. This file covers what the type cannot: what
 * happens to a row that arrives outside the expected shape.
 */

const row = (over: Partial<StatsViewRow> = {}): StatsViewRow =>
  ({
    position_id: "p1",
    user_id: "u1",
    account_id: "a1",
    instrument: "ES",
    direction: "Long",
    status: "closed",
    entry_qty: 2,
    exit_qty: 2,
    avg_entry: 5000,
    avg_exit: 5010,
    total_fees: 8,
    total_swap: 0,
    opened_at: "2026-03-02T14:00:00Z",
    closed_at: "2026-03-02T15:00:00Z",
    duration_seconds: 3600,
    point_value: 50,
    tick_size: 0.25,
    point_value_source: "snapshot",
    quote_currency: "USD",
    account_currency: "USD",
    fx_rate: 1,
    fx_rate_source: "same_currency",
    money_overridden: false,
    dir_mult: 1,
    gross_points: 20,
    gross_pl: 1000,
    net_pl: 992,
    realized_r: 1,
    realized_r_net: 0.992,
    ...over,
  }) as StatsViewRow;

describe("narrowPositionStat", () => {
  it("a sound row passes, money and all", () => {
    const s = narrowPositionStat(row());
    expect(s?.position_id).toBe("p1");
    expect(s?.net_pl).toBe(992);
    expect(s?.point_value_source).toBe("snapshot");
    expect(s?.fx_rate_source).toBe("same_currency");
  });

  it("a row with no `position_id` is dropped, not repaired", () => {
    // With no key it cannot be joined to any position. The previous code did the
    // same thing (`if (s.position_id)`), but after a cast that claimed this
    // could not happen.
    expect(narrowPositionStat(row({ position_id: null }))).toBeNull();
  });

  it("an unknown provenance falls back to `missing`, not to `snapshot`", () => {
    // The direction matters. `missing` is the mark that means "the money here is
    // not reliable" across the whole system; the opposite choice would present a
    // value of unknown provenance as a checked one, which is exactly the mistake
    // this whole step avoids.
    const s = narrowPositionStat(
      row({ point_value_source: "something_new", fx_rate_source: "something_new" }),
    );
    expect(s?.point_value_source).toBe("missing");
    expect(s?.fx_rate_source).toBe("missing");
  });

  it("a null provenance falls back to `missing` too", () => {
    const s = narrowPositionStat(
      row({ point_value_source: null, fx_rate_source: null }),
    );
    expect(s?.point_value_source).toBe("missing");
    expect(s?.fx_rate_source).toBe("missing");
  });

  it("every allowed provenance passes through untouched", () => {
    for (const src of ["snapshot", "instrument", "missing"] as const) {
      expect(narrowPositionStat(row({ point_value_source: src }))?.point_value_source).toBe(src);
    }
    for (const src of ["snapshot", "same_currency", "no_account", "missing"] as const) {
      expect(narrowPositionStat(row({ fx_rate_source: src }))?.fx_rate_source).toBe(src);
    }
  });
});
