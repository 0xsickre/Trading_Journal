import { describe, expect, it } from "vitest";
import {
  ARCHIVED_INSTRUMENT_SYMBOLS,
  DEFAULT_INSTRUMENTS,
  DEFAULT_INSTRUMENT_SYMBOLS,
} from "./default-instruments";

describe("katalog instrumenata", () => {
  it("point_value × tick_size = tick_value na svakom futures ugovoru", () => {
    // Jedina greška koju ovaj katalog može da ima jeste greška u prepisivanju
    // berzanske specifikacije, a ona se sama odaje: berza objavljuje i tick i
    // njegovu vrednost, pa su to dva nezavisno prepisana broja koja moraju da
    // se slože. ES: 50 × 0.25 = 12.50. ZB: 1000 × 1/32 = 31.25.
    const withTickValue = DEFAULT_INSTRUMENTS.filter((i) => i.tick_value != null);
    expect(withTickValue.length).toBeGreaterThan(30);

    for (const i of withTickValue) {
      expect(i.tick_size, `${i.symbol} ima tick_value ali nema tick_size`).not.toBeNull();
      expect(
        i.point_value * i.tick_size!,
        `${i.symbol}: ${i.point_value} × ${i.tick_size} ≠ ${i.tick_value}`,
      ).toBeCloseTo(i.tick_value!, 8);
    }
  });

  it("CFD-ovi nemaju tick_value, jer kod njih to nije berzanski podatak", () => {
    for (const i of DEFAULT_INSTRUMENTS) {
      if (i.asset_class.includes("Futures")) continue;
      expect(i.tick_value, `${i.symbol} je CFD/spot a nosi tick_value`).toBeNull();
    }
  });

  it("CFD i futures su razdvojeni po asset_class-u", () => {
    const classes = new Set(DEFAULT_INSTRUMENTS.map((i) => i.asset_class));
    // Podela postoji zato što isti bazni instrument ima različitu specifikaciju
    // u zavisnosti od toga kako se trguje: zlato je 100 po poenu kao spot CFD i
    // 100 kao GC futures, ali bakar je 1 kao CFD i 25 000 kao HG futures.
    expect(classes).toContain("Index CFD");
    expect(classes).toContain("Index Futures");
    expect(classes).toContain("Metals CFD");
    expect(classes).toContain("Metals Futures");
    expect(classes).toContain("Energy CFD");
    expect(classes).toContain("Energy Futures");
  });

  it("svaki spot FX par nosi valutu kotacije koja je druga polovina simbola", () => {
    // Ovo je brojka koja je bila pogrešna do 20260815130000: sve je stajalo na
    // 'USD' jer je to bio DEFAULT kolone koju niko nije popunjavao.
    for (const i of DEFAULT_INSTRUMENTS) {
      if (i.asset_class !== "Forex") continue;
      expect(i.symbol, `${i.symbol} nije šestoslovni par`).toHaveLength(6);
      expect(i.quote_currency, `${i.symbol} kotira u pogrešnoj valuti`).toBe(
        i.symbol.slice(3),
      );
    }
  });

  it("JPY parovi se kotiraju na tri decimale, ostali na pet", () => {
    for (const i of DEFAULT_INSTRUMENTS) {
      if (i.asset_class !== "Forex") continue;
      expect(i.tick_size, i.symbol).toBe(i.quote_currency === "JPY" ? 0.001 : 0.00001);
    }
  });

  it("valuta kotacije je svuda troslovna oznaka, kao što DB CHECK traži", () => {
    for (const i of DEFAULT_INSTRUMENTS) {
      expect(i.quote_currency, i.symbol).toMatch(/^[A-Z]{3}$/);
    }
  });

  it("point_value je svuda pozitivan, kao što DB CHECK traži", () => {
    for (const i of DEFAULT_INSTRUMENTS) {
      expect(i.point_value, i.symbol).toBeGreaterThan(0);
      if (i.tick_size != null) expect(i.tick_size, i.symbol).toBeGreaterThan(0);
    }
  });

  it("simboli i sort_order su jedinstveni", () => {
    const syms = DEFAULT_INSTRUMENTS.map((i) => i.symbol);
    expect(new Set(syms).size).toBe(syms.length);
    const orders = DEFAULT_INSTRUMENTS.map((i) => i.sort_order);
    expect(new Set(orders).size).toBe(orders.length);
  });

  it("nijedno arhivirano ime nije ušlo u katalog", () => {
    for (const sym of DEFAULT_INSTRUMENT_SYMBOLS) {
      expect(ARCHIVED_INSTRUMENT_SYMBOLS).not.toContain(sym);
    }
  });

  it("aktivna je samo radna lista, ostalo čeka u Settings-u", () => {
    // Forma čita getInstruments(true). Stotinu aktivnih instrumenata pretvorilo
    // bi padajuću listu u pretragu, pa katalog stiže spreman ali ugašen.
    const active = DEFAULT_INSTRUMENTS.filter((i) => i.is_active).map((i) => i.symbol);
    expect(active).toEqual([
      "EURUSD", "GBPUSD", "USDJPY", "USDCAD", "AUDUSD",
      "XAUUSD", "SP500", "NAS100", "US2000", "RTY", "HG",
    ]);
  });
});
