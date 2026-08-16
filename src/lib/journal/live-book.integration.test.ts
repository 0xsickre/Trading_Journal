import { describe, expect, it } from "vitest";
import { computeStats, dailyPnl, toRealized } from "./analytics";
import { resolveBreakevenRange, type BreakevenConfig } from "./breakeven";
import { unpricedClosedCount } from "./money-provenance";
import { narrowPositionStat } from "./types";
import { openPositionsOn } from "./open-positions";
import type { Database } from "@/lib/supabase/types";
import type { TradeRow } from "./types";

/**
 * KNJIGA IZ ŽIVE BAZE, PROVUČENA KROZ PRAVU BIBLIOTEKU.
 *
 * Korak 10 je trebalo da bude „aplikacija na ekranu sa pravim podacima". Taj
 * deo je BLOKIRAN: mrežna politika ove sredine ne pušta `*.supabase.co` iz
 * kontejnera (`Host not in allowlist`), pa ni pregledač ni Next server ne mogu
 * da se prijave. To stoji zapisano u izveštaju i traži izmenu podešavanja koju
 * ne mogu da uradim sam.
 *
 * Ovo je deo koji JESTE bio moguć, i nije nadomestak nego zasebna vrednost:
 * redovi ispod su DOSLOVNO ono što je `tj_position_stats` vratio za knjigu
 * zasejanu kroz `tj_save_trade` na živom projektu — prepisani, ne izmišljeni.
 * Svaki dosadašnji `lib` test gradi svoje redove; ovaj ih uzima od baze.
 *
 * Time se zatvara šav SQL → `lib`: dokazano je da brojevi koje SQL rodi prolaze
 * kroz agregaciju netaknuti, na istoj knjizi izvedenoj na papiru.
 *
 * KNJIGA (nalog: USD, početno stanje 100 000, breakeven pojas −5..+5,
 * zona America/New_York):
 *
 *   #1 ES     Long   2 ugovora  5000 → 5010, stop 4990, provizija 4
 *      bruto  (5010−5000)×2×50 = +1000   neto +996    R = 20/(10×2) = +1.00
 *   #2 ES     Short  1 ugovor   5020 → 5030, stop 5030, provizija 2
 *      bruto  −10×1×50 = −500            neto −502    R = −10/(10×1) = −1.00
 *   #3 EURUSD Long   0.5 lota   1.0800 → 1.0830, stop 1.0780, prov. 1, swap 0.5
 *      bruto  0.0015×100000 = +150       neto +148.50 R = 0.0015/0.001 = +1.50
 *   #4 NQ     Long   1 ugovor   21000 → 21000, stop 20950, provizija 2
 *      bruto  0                          neto −2      R = 0
 *   #5 XYZ    Long   1 ugovor   100 → 110 — SIMBOL BEZ INSTRUMENTA
 *      novac null, ali R = 10/5 = +2.00 (R živi u cenama, ne u novcu)
 *   #6 NQ     Long   1 ugovor   21050, OTVORENA, vremenski stop 3 dana
 *
 *   ukupno (zatvoreni i vrednovani): bruto +650, neto +640.50
 *   2 dobitka, 1 gubitak, 1 breakeven (−2 je UNUTAR pojasa)
 *   win rate 2/(2+1) = 66.67 %, ukupan R +1.50, prosečan R +0.375
 */

type StatsRow = Database["public"]["Views"]["tj_position_stats"]["Row"];

const RAW: {
  id: string;
  trade_no: number;
  instrument: string;
  direction: string;
  status: string;
  stats: Partial<StatsRow> | null;
}[] = [
  {
    id: "ccfd81f9-f2b4-4644-bdcb-d0a82d95e6a8",
    trade_no: 1,
    instrument: "ES",
    direction: "Long",
    status: "closed",
    stats: {
      position_id: "ccfd81f9-f2b4-4644-bdcb-d0a82d95e6a8",
      net_pl: 996, gross_pl: 1000, realized_r: 1, realized_r_net: 0.996,
      avg_entry: 5000, avg_exit: 5010, entry_qty: 2, exit_qty: 2,
      total_fees: 4, total_swap: 0,
      opened_at: "2026-03-02T14:30:00+00:00", closed_at: "2026-03-02T16:00:00+00:00",
      duration_seconds: 5400, point_value: 50, tick_size: 0.25,
      point_value_source: "snapshot", quote_currency: "USD",
      account_currency: "USD", fx_rate: 1, fx_rate_source: "snapshot",
      money_overridden: false,
    },
  },
  {
    id: "8323ca02-132f-4b21-9c1e-4a58039aefc1",
    trade_no: 2,
    instrument: "ES",
    direction: "Short",
    status: "closed",
    stats: {
      position_id: "8323ca02-132f-4b21-9c1e-4a58039aefc1",
      net_pl: -502, gross_pl: -500, realized_r: -1, realized_r_net: -1.004,
      avg_entry: 5020, avg_exit: 5030, entry_qty: 1, exit_qty: 1,
      total_fees: 2, total_swap: 0,
      opened_at: "2026-03-03T14:30:00+00:00", closed_at: "2026-03-03T15:00:00+00:00",
      duration_seconds: 1800, point_value: 50, tick_size: 0.25,
      point_value_source: "snapshot", quote_currency: "USD",
      account_currency: "USD", fx_rate: 1, fx_rate_source: "snapshot",
      money_overridden: false,
    },
  },
  {
    id: "af53861c-bc18-4cc4-ad81-38fc14b5b8ca",
    trade_no: 3,
    instrument: "EURUSD",
    direction: "Long",
    status: "closed",
    stats: {
      position_id: "af53861c-bc18-4cc4-ad81-38fc14b5b8ca",
      net_pl: 148.5, gross_pl: 150, realized_r: 1.5, realized_r_net: 1.485,
      avg_entry: 1.08, avg_exit: 1.083, entry_qty: 0.5, exit_qty: 0.5,
      total_fees: 1, total_swap: 0.5,
      opened_at: "2026-03-04T13:00:00+00:00", closed_at: "2026-03-04T18:00:00+00:00",
      duration_seconds: 18000, point_value: 100000, tick_size: 0.00001,
      point_value_source: "snapshot", quote_currency: "USD",
      account_currency: "USD", fx_rate: 1, fx_rate_source: "snapshot",
      money_overridden: false,
    },
  },
  {
    id: "b27fa3dd-7976-40be-8633-bde24d4afa52",
    trade_no: 4,
    instrument: "NQ",
    direction: "Long",
    status: "closed",
    stats: {
      position_id: "b27fa3dd-7976-40be-8633-bde24d4afa52",
      net_pl: -2, gross_pl: 0, realized_r: 0, realized_r_net: -0.002,
      avg_entry: 21000, avg_exit: 21000, entry_qty: 1, exit_qty: 1,
      total_fees: 2, total_swap: 0,
      opened_at: "2026-03-05T14:30:00+00:00", closed_at: "2026-03-05T15:30:00+00:00",
      duration_seconds: 3600, point_value: 20, tick_size: 0.25,
      point_value_source: "snapshot", quote_currency: "USD",
      account_currency: "USD", fx_rate: 1, fx_rate_source: "snapshot",
      money_overridden: false,
    },
  },
  {
    id: "389e730d-fb2a-4c20-b90b-65d94dfc682e",
    trade_no: 5,
    instrument: "XYZ",
    direction: "Long",
    status: "closed",
    stats: {
      position_id: "389e730d-fb2a-4c20-b90b-65d94dfc682e",
      net_pl: null, gross_pl: null, realized_r: 2, realized_r_net: null,
      avg_entry: 100, avg_exit: 110, entry_qty: 1, exit_qty: 1,
      total_fees: 2, total_swap: 0,
      opened_at: "2026-03-06T14:30:00+00:00", closed_at: "2026-03-06T15:30:00+00:00",
      duration_seconds: 3600, point_value: null, tick_size: null,
      point_value_source: "missing", quote_currency: null,
      account_currency: "USD", fx_rate: null, fx_rate_source: "missing",
      money_overridden: false,
    },
  },
  {
    id: "793c67d5-c55a-46b6-9baa-8ff2290b9050",
    trade_no: 6,
    instrument: "NQ",
    direction: "Long",
    status: "open",
    stats: {
      position_id: "793c67d5-c55a-46b6-9baa-8ff2290b9050",
      net_pl: null, gross_pl: null, realized_r: null, realized_r_net: null,
      avg_entry: 21050, avg_exit: null, entry_qty: 1, exit_qty: null,
      total_fees: 1, total_swap: 0,
      opened_at: "2026-03-04T14:30:00+00:00", closed_at: null,
      duration_seconds: null, point_value: 20, tick_size: 0.25,
      point_value_source: "snapshot", quote_currency: "USD",
      account_currency: "USD", fx_rate: 1, fx_rate_source: "snapshot",
      money_overridden: false,
    },
  },
];

/** Isti oblik koji `getTradesWithStats` gradi, kroz isto sužavanje. */
const TRADES: TradeRow[] = RAW.map(
  (r) =>
    ({
      id: r.id,
      account_id: "9b10b46a-931c-4415-9a0c-b1a01cfdf232",
      trade_no: r.trade_no,
      instrument: r.instrument,
      direction: r.direction,
      status: r.status,
      source: "manual",
      needs_review: false,
      created_at: "2026-08-16T10:30:42.912437+00:00",
      time_stop_days: r.trade_no === 6 ? 3 : null,
      stats: r.stats ? narrowPositionStat(r.stats as StatsRow) : null,
    }) as unknown as TradeRow,
);

const ACCOUNT = {
  breakeven_from: -5,
  breakeven_to: 5,
  breakeven_unit: "currency",
  starting_balance: 100_000,
} as BreakevenConfig;

const RANGE = resolveBreakevenRange(ACCOUNT);
const TZ = "America/New_York";

describe("šav SQL → lib, na knjizi iz žive baze", () => {
  const realized = toRealized(TRADES);
  const stats = computeStats(realized, "net", RANGE);

  it("neprocenjiv i otvoren trejd ne ulaze u realizovane", () => {
    // Pet je zatvorenih, ali jedan nema novac. Četiri ostaju — i to je razmak
    // koji `unpricedClosedCount` postoji da prizna.
    expect(realized).toHaveLength(4);
    expect(unpricedClosedCount(TRADES)).toBe(1);
  });

  it("neto i bruto se slažu sa papirom do centa", () => {
    expect(stats.netSum).toBeCloseTo(640.5, 10);
    expect(stats.grossSum).toBeCloseTo(650, 10);
    // Kontrola preko troškova: 650 − 9 provizije − 0.5 swap = 640.50
    expect(stats.grossSum - 9 - 0.5).toBeCloseTo(stats.netSum, 10);
  });

  it("ishodi poštuju POJAS naloga, ne sirov znak", () => {
    // −2 $ je gubitak po znaku a breakeven po pojasu −5..+5. Da je pojas
    // ignorisan, win rate bi bio 2/3 → 50 % umesto 66.67 %.
    expect(stats.wins).toBe(2);
    expect(stats.losses).toBe(1);
    expect(stats.breakeven).toBe(1);
    expect(stats.winRate).toBeCloseTo((2 / 3) * 100, 8);
  });

  it("R se sabira preko trejdova koji ga imaju", () => {
    expect(stats.totalR).toBeCloseTo(1.5, 10);
    expect(stats.avgR).toBeCloseTo(0.375, 10);
  });

  it("R NEPROCENJIVOG trejda postoji iako novca nema — i ne ulazi u zbir", () => {
    // View je za #5 vratio `realized_r = 2.0` uz `net_pl = null`: R živi u
    // cenama i preživljava nepoznat `point_value`. Ali `toRealized` red
    // odbacuje zbog novca, pa taj R nigde ne ulazi. Razmak, ne bag — i vredi da
    // stoji izmeren, jer je jedini R u knjizi koji se ne vidi ni na jednom
    // ekranu.
    const petica = TRADES.find((t) => t.trade_no === 5)!;
    expect(petica.stats?.realized_r).toBe(2);
    expect(petica.stats?.net_pl).toBeNull();
    expect(realized.some((r) => r.id === petica.id)).toBe(false);
    expect(stats.totalR).toBeCloseTo(1.5, 10);
  });
});

describe("dan po dan, u zoni naloga", () => {
  it("svaki trejd pada u dan svog ZATVARANJA po njujorškom satu", () => {
    // 2026-03-02T16:00Z je 11:00 u Njujorku — isti dan. Da se dan računao u
    // UTC, #1 bi i dalje bio 02., ali trejd zatvoren u 23:30 NY bi odleteo u
    // sutrašnju ćeliju. Zato je zona naloga jedina merodavna.
    const daily = dailyPnl(toRealized(TRADES), "net", () => TZ);
    expect(daily.get("2026-03-02")).toBeCloseTo(996, 10);
    expect(daily.get("2026-03-03")).toBeCloseTo(-502, 10);
    expect(daily.get("2026-03-04")).toBeCloseTo(148.5, 10);
    expect(daily.get("2026-03-05")).toBeCloseTo(-2, 10);
    // 06. je dan neprocenjivog trejda — nema ga u mapi, i to je tačno: dan bez
    // vrednovanog rezultata nije dan sa nulom.
    expect(daily.has("2026-03-06")).toBe(false);
  });

  it("zbir dana je zbir knjige", () => {
    const total = [...dailyPnl(toRealized(TRADES), "net", () => TZ).values()]
      .reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(640.5, 10);
  });
});

describe("otvorena pozicija", () => {
  const only6 = (dayKey: string) =>
    openPositionsOn(TRADES, dayKey, () => TZ).find(
      (p) => p.id === "793c67d5-c55a-46b6-9baa-8ff2290b9050",
    );

  it("DAN ZATVARANJA SE BROJI KAO OTVOREN — namerno, i lako se pogrešno pretpostavi", () => {
    // Ovo sam prvo napisao naopako. Na 03. mart je otvorena samo #2, i ona je
    // tog istog dana i zatvorena — pa je `openPositionsOn` ipak vraća.
    //
    // Namerno je: pozicija je tog dana bila živa, mogla je biti dirana, i njena
    // teza je tog jutra bila ili tačna ili netačna. Izostavljanje bi poslednji
    // dan svakog trejda — često onaj koji je odlučio ishod — učinilo jedinim
    // danom koji niko nije zapisao.
    const treci = openPositionsOn(TRADES, "2026-03-03", () => TZ);
    expect(treci).toHaveLength(1);
    expect(treci[0].id).toBe("8323ca02-132f-4b21-9c1e-4a58039aefc1");
  });

  it("pre ijednog otvaranja lista je prazna", () => {
    expect(openPositionsOn(TRADES, "2026-03-01", () => TZ)).toHaveLength(0);
  });

  it("na 06. mart je treći dan držanja, i vremenski stop NIJE prekoračen", () => {
    // Otvorena 04., pa su 04., 05. i 06. tri sesije — 1-bazno brojanje. Stop je
    // 3 dana; na dan kad je dostignut plan se još poštuje, prekršaj pripada
    // danu u kojem je prekoračen.
    const p = only6("2026-03-06")!;
    expect(p.daysInTrade).toBe(3);
    expect(p.timeStopDays).toBe(3);
    expect(p.pastTimeStop).toBe(false);
  });

  it("na 07. mart je četvrti dan, i tada JESTE prekoračen", () => {
    const p = only6("2026-03-07")!;
    expect(p.daysInTrade).toBe(4);
    expect(p.pastTimeStop).toBe(true);
  });
});
