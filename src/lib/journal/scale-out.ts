/**
 * Planirani nivoi izlaska — koliko procenata pozicije ide na kojoj ceni.
 *
 * Namerno NIJE u `plan-calculations.ts`. Taj modul je MONEY_MODULE pod podom
 * pokrivenosti 100 % za statement-e i funkcije; svaka nova grana tamo košta
 * test koji mora da postoji zbog praga, a ne zbog tvrdnje. Ovo je zaseban
 * modul sa sopstvenim testom.
 *
 * CENA, NE R. Svaki drugi nivo na trejdu je cena — entry, stop, target — pa bi
 * jedan nivo u R-u tražio od čitaoca da drži dve jedinice u glavi na istom
 * ekranu. R se IZVODI, kroz postojeći `computePlannedRewardR`, i nigde se ne
 * čuva: čuvanje izvedene vrednosti je tačno ono što ovaj repo svuda odbija,
 * jer izmenjen stop tiho učini sačuvani R netačnim.
 */

export type ScaleOutLevel = {
  /** Deo pozicije koji se skida na ovoj ceni, u procentima (0–100]. */
  pct: number;
  price: number;
};

/** Red u editoru: oba polja su tekst dok se kucaju, i oba smeju biti prazna. */
export type ScaleOutRow = { pct: string; price: string };

/**
 * Najveći dozvoljen zbir. Tačno 100 je legitiman pun stepenasti izlaz, pa
 * okidač ide na `> 100`, nikad na `>= 100`.
 */
export const MAX_SCALE_OUT_PCT = 100;

function num(raw: string): number | null {
  const t = raw.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * Nivoi iz baze, očišćeni.
 *
 * `jsonb` kolona brani samo da je vrednost NIZ. Sve unutra je nepouzdano —
 * ručno pisan SQL, stariji klijent, uvoz — pa se svaki red proverava. Neispravan
 * red se ISPUŠTA umesto da obori stranicu: trejd sa jednim pokvarenim nivoom i
 * dalje mora da se otvori.
 */
export function parseScaleOutLevels(raw: unknown): ScaleOutLevel[] {
  if (!Array.isArray(raw)) return [];
  const out: ScaleOutLevel[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const { pct, price } = item as Record<string, unknown>;
    if (typeof pct !== "number" || !Number.isFinite(pct) || pct <= 0) continue;
    if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) continue;
    out.push({ pct, price });
  }
  return out;
}

/**
 * Indeksi redova koje je korisnik započeo ali nije dovršio.
 *
 * Ogledalo `incompleteExecRows()` u formi, i isti ugovor: nepotpun red BLOKIRA
 * snimanje sa numerisanom porukom, nikad se tiho ne ispušta. Red u kom je
 * upisano „60 %" bez cene je namera koja nije dovršena; progutati ga znači
 * slagati korisnika da je snimljena.
 *
 * Potpuno prazan red NIJE nepotpun — to je samo prazan red editora.
 */
export function incompleteScaleOutRows(rows: readonly ScaleOutRow[]): number[] {
  return rows
    .map((r, i) => {
      const pct = num(r.pct);
      const price = num(r.price);
      const empty = r.pct.trim() === "" && r.price.trim() === "";
      if (empty) return -1;
      const ok = pct != null && pct > 0 && price != null && price > 0;
      return ok ? -1 : i;
    })
    .filter((i) => i >= 0);
}

/** Zbir procenata preko potpunih redova. Nepotpuni se ne broje — oni blokiraju. */
export function totalScaleOutPct(rows: readonly ScaleOutRow[]): number {
  return rows.reduce((sum, r) => {
    const pct = num(r.pct);
    const price = num(r.price);
    if (pct == null || price == null || pct <= 0 || price <= 0) return sum;
    return sum + pct;
  }, 0);
}

/** Redovi editora → ono što ide u kolonu. Prazni redovi otpadaju. */
export function scaleOutRowsToLevels(
  rows: readonly ScaleOutRow[],
): ScaleOutLevel[] {
  const out: ScaleOutLevel[] = [];
  for (const r of rows) {
    const pct = num(r.pct);
    const price = num(r.price);
    if (pct == null || price == null || pct <= 0 || price <= 0) continue;
    out.push({ pct, price });
  }
  return out;
}

/** Nivoi iz baze → redovi editora. */
export function levelsToScaleOutRows(
  levels: readonly ScaleOutLevel[],
): ScaleOutRow[] {
  return levels.map((l) => ({ pct: String(l.pct), price: String(l.price) }));
}
