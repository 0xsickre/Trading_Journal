import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RESERVED_KEYS } from "./reserved-keys";

/**
 * Lista rezervisanih imena mora da prati šemu, i to je do sada dvaput omanulo.
 *
 * Prvi put: `thesis`, `invalidation`, `time_stop_days`, `scale_out_plan` dodate
 * 13.08.2026, a lista je pisana pre toga. Drugi put: `quote_currency_at_trade`,
 * `fx_rate_at_trade` i `gross_pnl_override` dodate 15.08. — u istom nizu koraka
 * u kojem je prvi propust bio popravljen. Ista greška, dva puta, u razmaku od
 * dva dana; to više nije previd nego nedostatak provere.
 *
 * Umesto da se lista opet ručno ažurira, ovaj test je čita iz GENERISANOG
 * `types.ts`, koji je odraz žive šeme. Sledeći `ADD COLUMN` obara test dok se
 * ime ne doda.
 *
 * Zašto parsiranje izvora a ne tip: `Database["public"]["Tables"]["tj_positions"]["Row"]`
 * postoji samo u vreme prevođenja. Ključevi mu se ne mogu nabrojati u toku rada,
 * pa je čitanje fajla jedini način da tvrdnja bude izvršiva.
 */
function columnsFromGeneratedTypes(): string[] {
  const path = fileURLToPath(new URL("../supabase/types.ts", import.meta.url));
  const src = readFileSync(path, "utf8");

  const table = src.indexOf("      tj_positions: {");
  expect(table, "tj_positions nije nađen u generisanim tipovima").toBeGreaterThan(-1);

  // Prvi `Row: {` posle imena tabele, pa do njegove zatvarajuće zagrade.
  const rowStart = src.indexOf("Row: {", table);
  const rowEnd = src.indexOf("\n        }", rowStart);
  expect(rowEnd).toBeGreaterThan(rowStart);

  const body = src.slice(rowStart, rowEnd);
  return [...body.matchAll(/^\s{10}([a-z_][a-z0-9_]*)\??:/gm)].map((m) => m[1]);
}

describe("RESERVED_KEYS prati šemu tj_positions", () => {
  it("pokriva svaku kolonu iz generisanih tipova", () => {
    const columns = columnsFromGeneratedTypes();

    // Zdrav razum pre tvrdnje: ako parser vrati premalo imena, test bi prošao
    // ne dokazavši ništa.
    expect(columns.length).toBeGreaterThanOrEqual(35);
    expect(columns).toContain("gross_pnl_override");
    expect(columns).toContain("entry_price");

    const missing = columns.filter((c) => !RESERVED_KEYS.has(c));
    expect(
      missing,
      `Kolone na tj_positions koje RESERVED_KEYS ne pokriva: ${missing.join(", ")}. ` +
        "Korisničko polje sa tim ključem bilo bi upisano u `custom` a čitano iz " +
        "kolone — trajno nevidljivo. Dodaj ih u src/lib/journal/reserved-keys.ts.",
    ).toEqual([]);
  });

  it("ne rezerviše imena koja na tabeli ne postoje", () => {
    // Suprotan smer: rezervisano ime bez kolone bez razloga zabranjuje korisniku
    // ključ koji bi bio potpuno ispravan.
    const columns = new Set(columnsFromGeneratedTypes());
    const stale = [...RESERVED_KEYS].filter((k) => !columns.has(k));
    expect(stale, `Rezervisana imena bez kolone: ${stale.join(", ")}`).toEqual([]);
  });
});
