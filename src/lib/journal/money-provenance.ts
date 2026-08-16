/**
 * Odakle broj u koloni novca — i kad ga tamo nema.
 *
 * View već nosi tri kolone koje na to odgovaraju: `point_value_source`,
 * `fx_rate_source` i `money_overridden`. Do sada je ekran čitao SAMO prvu, i to
 * na jednom mestu (`journal-grid.tsx`, značka „unpriced").
 *
 * Posledica je bila rupa koju je Korak 3 primetio i odložio dovde: trejd na
 * instrumentu koji IMA `point_value`, ali kojem kurs nije poznat, ima sve
 * novčane kolone null — a `point_value_source` je uredno `snapshot`, pa značke
 * nema. Korisnik vidi golu crticu u koloni P/L i nema šta da uradi povodom nje,
 * jer ništa ne kaže da je razlog kurs.
 *
 * Obrnut slučaj je isto tako nevidljiv: `money_overridden` znači da bruto NIJE
 * izračunat iz cena nego prepisan sa izvoda ili unet rukom. Taj broj je često
 * TAČNIJI od izračunatog — platforma ga je konvertovala po kursu iz trenutka
 * izvršenja, koji se ne može ni saznati ni ponoviti. Ali je drugačije nastao, i
 * čitalac koji poredi P/L sa R-om treba da zna zašto se ne poklapaju: R se i
 * tada računa IZ CENA.
 *
 * Zato jedna funkcija, a ne tri uslova raštrkana po ekranima — ista lekcija kao
 * Korak 5.
 */

import type { PositionStat, TradeRow } from "./types";

export type MoneyProvenance = {
  /** Kratka oznaka za značku, ili null kad nema šta da se kaže. */
  label: "unpriced" | "no FX" | "no account" | "broker" | null;
  /** Rečenica koja kaže šta da se uradi, ili zašto je broj takav kakav je. */
  title: string | null;
  /**
   * Da li su novčane kolone null ZBOG nedostatka podatka.
   *
   * Razlikuje se od `label != null`: `broker` je oznaka porekla, ne kvara —
   * novac postoji i tačan je. Ekran koji hoće da oboji problem crvenim mora da
   * gleda ovo, ne postojanje značke.
   */
  unpriced: boolean;
};

const NONE: MoneyProvenance = { label: null, title: null, unpriced: false };

/**
 * Poreklo novca za jedan trejd.
 *
 * Redosled provera je redosled UZROKA, ne važnosti. Kad je bruto prepisan, ni
 * specifikacija ni kurs mu nisu bili potrebni — pa nedostatak nijednog od njih
 * nije razlog za uzbunu i `broker` pobeđuje. Tek kad se broj RAČUNA iz cena,
 * `point_value` i kurs postaju uslovi, i tada nedostatak bilo kojeg znači da
 * novca nema.
 */
export function moneyProvenance(
  stats: Pick<
    PositionStat,
    "point_value_source" | "fx_rate_source" | "money_overridden"
  > | null | undefined,
): MoneyProvenance {
  if (!stats) return NONE;

  if (stats.money_overridden) {
    return {
      label: "broker",
      title:
        "Gross P&L was entered directly (manual entry or broker CSV) rather than computed from prices, so neither the contract spec nor an FX rate touched it. R is still measured from prices.",
      unpriced: false,
    };
  }

  if (stats.point_value_source === "missing") {
    return {
      label: "unpriced",
      title:
        "No instrument definition for this symbol, so its point value is unknown and P/L cannot be calculated. Add the instrument in Settings.",
      unpriced: true,
    };
  }

  if (stats.fx_rate_source === "no_account") {
    return {
      label: "no account",
      title:
        "This trade has no account, so there is no currency to convert into and P/L cannot be calculated. Assign an account to the trade.",
      unpriced: true,
    };
  }

  if (stats.fx_rate_source === "missing") {
    return {
      label: "no FX",
      title:
        "The instrument is quoted in a different currency from the account and no exchange rate was recorded on this trade, so P/L cannot be calculated. Edit the trade and enter the rate.",
      unpriced: true,
    };
  }

  return NONE;
}

/**
 * Zatvoreni trejdovi koje nijedna statistika ne broji.
 *
 * NALAZ KORAKA 9, i najozbiljnije mesto na kojem broj na ekranu može da bude
 * pogrešan a da niko ne primeti — jer nije pogrešan, nego NEPOTPUN.
 *
 * `toRealized` odbacuje svaki red čiji je `net_pl` null:
 *
 *     if (!stats || stats.net_pl == null) return [];
 *
 * To je tačna odluka. Trejd koji se ne može vrednovati ne sme da uđe u zbir kao
 * nula, i ceo projekat je oko toga izgrađen. Ali odbačen red nestaje iz SVEGA
 * što se od `toRealized` gradi: broja trejdova, neto rezultata, profit factora,
 * expectancy, Sickre Score-a, kalendara, izveštaja i uvida.
 *
 * Trejder sa deset zatvorenih trejdova, od kojih su tri na simbolu bez
 * instrumenta, vidi „7 trades" i neto koji izostavlja tri stvarna rezultata.
 * `/journal` od Koraka 8 nosi značku po redu, ali dashboard i izveštaji ne kažu
 * ništa — a to su ekrani na kojima se gleda ukupno stanje.
 *
 * Ova funkcija broji upravo taj razmak, da bi ekran mogao da ga prizna. NE
 * pokušava da ga popuni: procena bi bila izmišljanje, a to je greška od koje
 * sve ovo i beži.
 */
export function unpricedClosedCount(trades: readonly TradeRow[]): number {
  let n = 0;
  for (const t of trades) {
    // Samo zatvoreni. Planiran ili propušten trejd nema šta da vrednuje, a
    // otvoren još nije ni realizovao rezultat — nijedan od njih nije razmak.
    if (t.status !== "closed") continue;
    if (t.stats?.net_pl == null) n++;
  }
  return n;
}
