import { describe, expect, it } from "vitest";
import { moneyProvenance } from "./money-provenance";
import type { PositionStat } from "./types";

/**
 * KAD NOVCA NEMA, EKRAN MORA DA KAŽE ZAŠTO.
 *
 * View od Koraka 3 nosi tri kolone o poreklu novca. Ekran je čitao samo jednu,
 * pa je cela FX polovina bila nevidljiva: trejd sa poznatim `point_value`-om a
 * bez kursa ima null novac i uredan `point_value_source = 'snapshot'`, što
 * znači crticu u koloni P/L i nijednu reč o tome šta korisnik može da uradi.
 */

const s = (over: Partial<PositionStat> = {}) =>
  ({
    point_value_source: "snapshot",
    fx_rate_source: "same_currency",
    money_overridden: false,
    ...over,
  }) as PositionStat;

describe("moneyProvenance", () => {
  it("uredan trejd nema značku", () => {
    expect(moneyProvenance(s())).toEqual({
      label: null,
      title: null,
      unpriced: false,
    });
  });

  it("bez stats-a nema značke, a ne pad", () => {
    expect(moneyProvenance(null).label).toBeNull();
    expect(moneyProvenance(undefined).label).toBeNull();
  });

  it("nepoznat instrument → `unpriced`, i to je kvar", () => {
    const p = moneyProvenance(s({ point_value_source: "missing" }));
    expect(p.label).toBe("unpriced");
    expect(p.unpriced).toBe(true);
    expect(p.title).toContain("Settings");
  });

  it("nepoznat kurs → `no FX` — RUPA KOJU JE OVAJ KORAK ZATVORIO", () => {
    // Ovo je bio slučaj bez ijedne oznake. `point_value_source` je `snapshot`,
    // pa stara provera nije reagovala, a novčane kolone su svejedno null.
    const p = moneyProvenance(s({ fx_rate_source: "missing" }));
    expect(p.label).toBe("no FX");
    expect(p.unpriced).toBe(true);
    expect(p.title).toContain("rate");
  });

  it("trejd bez naloga → `no account`", () => {
    // Nastaje sam od sebe kad se nalog obriše (`ON DELETE SET NULL`). Bez
    // valute naloga nema u šta da se konvertuje.
    const p = moneyProvenance(s({ fx_rate_source: "no_account" }));
    expect(p.label).toBe("no account");
    expect(p.unpriced).toBe(true);
  });

  it("rezultat sa izvoda → `broker`, i to NIJE kvar", () => {
    // Razlika koju `unpriced` nosi: značka postoji, ali novac je tu i tačan je.
    // Ekran koji boji problem crvenim mora da gleda `unpriced`, ne postojanje
    // značke — inače bi najpouzdaniji broj u sistemu bio obojen kao greška.
    const p = moneyProvenance(s({ money_overridden: true }));
    expect(p.label).toBe("broker");
    expect(p.unpriced).toBe(false);
    expect(p.title).toContain("R is still measured from prices");
  });

  it("upisan rezultat pobeđuje i nad nepoznatim kursom i nad nepoznatom specifikacijom", () => {
    // Redosled je redosled UZROKA. Kad bruto ne nastaje iz cena, ni
    // specifikacija ni kurs mu nisu bili potrebni — pa njihovo odsustvo nije
    // razlog za uzbunu.
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

  it("nedostatak specifikacije se prijavljuje pre nedostatka kursa", () => {
    // Oba su tačna, ali `point_value` je prvi uslov i prva stvar koju korisnik
    // popravlja. Dve značke na jednom redu ne bi rekle više.
    const p = moneyProvenance(
      s({ point_value_source: "missing", fx_rate_source: "missing" }),
    );
    expect(p.label).toBe("unpriced");
  });

  it("svaka značka nosi rečenicu, nijedna nije gola oznaka", () => {
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
