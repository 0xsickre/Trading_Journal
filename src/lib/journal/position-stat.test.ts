import { describe, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/types";
import { narrowPositionStat } from "./types";

type StatsViewRow = Database["public"]["Views"]["tj_position_stats"]["Row"];

/**
 * GRANICA IZMEĐU VIEW-A I APLIKACIJE.
 *
 * `trades.ts` je red view-a primao kao `statRows as PositionStat[]` — tvrdnju
 * da je `position_id` ne-null i da su dva `*_source` polja zatvoreni skupovi.
 * PostgREST za view ne garantuje nijedno od to troje, i ništa tu tvrdnju nije
 * proveravalo.
 *
 * Sam TIP se sada izvodi iz generisanih tipova, pa razilaženje sa šemom obara
 * typecheck. Ovaj fajl pokriva ono što tip ne može: šta se dešava sa redom koji
 * stigne izvan očekivanog oblika.
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
  it("uredan red prolazi sa sve novcem", () => {
    const s = narrowPositionStat(row());
    expect(s?.position_id).toBe("p1");
    expect(s?.net_pl).toBe(992);
    expect(s?.point_value_source).toBe("snapshot");
    expect(s?.fx_rate_source).toBe("same_currency");
  });

  it("red bez `position_id` se odbacuje, ne popravlja", () => {
    // Bez ključa se ne može spojiti ni sa jednom pozicijom. Prethodni kod je
    // isto to radio (`if (s.position_id)`), ali posle cast-a koji je tvrdio da
    // se to ne može desiti.
    expect(narrowPositionStat(row({ position_id: null }))).toBeNull();
  });

  it("nepoznato poreklo pada na `missing`, a ne na `snapshot`", () => {
    // Smer je bitan. `missing` je oznaka koja u celom sistemu znači „novac ovde
    // nije pouzdan"; obrnut izbor bi vrednost nepoznatog porekla predstavio kao
    // proverenu, što je tačno greška koju ceo ovaj korak izbegava.
    const s = narrowPositionStat(
      row({ point_value_source: "nesto_novo", fx_rate_source: "nesto_novo" }),
    );
    expect(s?.point_value_source).toBe("missing");
    expect(s?.fx_rate_source).toBe("missing");
  });

  it("null poreklo takođe pada na `missing`", () => {
    const s = narrowPositionStat(
      row({ point_value_source: null, fx_rate_source: null }),
    );
    expect(s?.point_value_source).toBe("missing");
    expect(s?.fx_rate_source).toBe("missing");
  });

  it("svako dozvoljeno poreklo se propušta netaknuto", () => {
    for (const src of ["snapshot", "instrument", "missing"] as const) {
      expect(narrowPositionStat(row({ point_value_source: src }))?.point_value_source).toBe(src);
    }
    for (const src of ["snapshot", "same_currency", "no_account", "missing"] as const) {
      expect(narrowPositionStat(row({ fx_rate_source: src }))?.fx_rate_source).toBe(src);
    }
  });
});
