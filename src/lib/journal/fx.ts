/**
 * Kurs valute kotacije prema valuti naloga — jedan izraz, ne pet.
 *
 * Ovaj modul postoji zato što isto pitanje treba da odgovore četiri mesta:
 * SQL view (`tj_position_stats`), TS blizanac (`position-stats.ts`), forma za
 * unos trejda, i put upisa koji kurs snima. Runda 3 revizije je klasu „dva
 * odgovora na jedno pitanje" našla sedam puta; ovo je pokušaj da osmi ne nastane.
 *
 * `CASE` izraz u view-u (`20260815130000_quote_currency_and_fx.sql`) je isti ovaj
 * redosled prioriteta, red po red. Ako se jedan promeni, mora i drugi.
 */

/** Zašto je kurs takav kakav je — i za UI, i za dijagnostiku. */
export type FxRateSource =
  /** Snimljen na trejdu pri upisu. Jedini izvor koji ne može da odluta. */
  | "snapshot"
  /** Instrument je kotiran u valuti naloga, pa je konverzija no-op. */
  | "same_currency"
  /** Trejd nema nalog, pa se nema sa čim uporediti valuta kotacije. */
  | "no_account"
  /** Valute se razlikuju a kurs nije zapisan. Novac se NE prikazuje. */
  | "missing";

export type ResolvedFxRate = {
  /** `null` znači da novac ne sme da se prikaže — ne da je kurs 1. */
  rate: number | null;
  source: FxRateSource;
};

export function resolveFxRate(input: {
  /** `fx_rate_at_trade` sa pozicije, ako je snimljen. */
  snapshot?: number | null;
  /** Valuta u kojoj je instrument kotiran. */
  quoteCurrency?: string | null;
  /** Valuta naloga. `null` kad trejd nema nalog. */
  accountCurrency?: string | null;
}): ResolvedFxRate {
  const { snapshot, quoteCurrency, accountCurrency } = input;

  // Snimljeno pobeđuje uvek, kao i kod `point_value_at_trade`. Istorija se ne
  // preračunava po današnjem kursu — to je bag C1, jednom već rešen.
  if (snapshot != null && Number.isFinite(snapshot) && snapshot > 0) {
    return { rate: snapshot, source: "snapshot" };
  }

  if (!accountCurrency) return { rate: null, source: "no_account" };

  // Jedinica se podrazumeva SAMO kad se valute stvarno poklapaju. Kao fallback
  // za nepoznat kurs, 1 bi tiho izjednačila jen sa dolarom — ista greška koju je
  // `COALESCE(point_value, 1)` pravio nad ugovornom specifikacijom.
  if (quoteCurrency && quoteCurrency === accountCurrency) {
    return { rate: 1, source: "same_currency" };
  }

  return { rate: null, source: "missing" };
}

/** Da li UI treba da označi trejd kao nepotpuno vrednovan. */
export function fxRateNeedsAttention(source: FxRateSource): boolean {
  return source === "missing" || source === "no_account";
}
