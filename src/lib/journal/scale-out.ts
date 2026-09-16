/**
 * Planned exit rungs — what percentage of the position leaves at which price.
 *
 * Deliberately NOT in `plan-calculations.ts`. That module is a MONEY_MODULE
 * under a 100 % floor for statements and functions; every new branch there
 * costs a test that has to exist because of the threshold rather than because
 * of an assertion. This is a separate module with its own test.
 *
 * PRICE, NOT R. Every other level on a trade is a price — entry, stop, target —
 * so a single level in R would ask the reader to hold two units in their head
 * on one screen. R is DERIVED, through the existing `computePlannedRewardR`,
 * and stored nowhere: storing a derived value is exactly what this repo refuses
 * everywhere, because a changed stop quietly makes a stored R untrue.
 */

export type ScaleOutLevel = {
  /** The share of the position taken off at this price, in percent (0–100]. */
  pct: number;
  price: number;
};

/** An editor row: both fields are text while being typed, and both may be empty. */
export type ScaleOutRow = { pct: string; price: string };

/**
 * The largest permitted total. Exactly 100 is a legitimate full scaled exit, so
 * the trigger is `> 100`, never `>= 100`.
 */
export const MAX_SCALE_OUT_PCT = 100;

function num(raw: string): number | null {
  const t = raw.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * The rungs out of the database, cleaned.
 *
 * A `jsonb` column only guarantees the value is an ARRAY. Everything inside is
 * untrusted — hand-written SQL, an older client, an import — so every row is
 * checked. An invalid row is DROPPED rather than failing the page: a trade with
 * one broken rung still has to open.
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
 * The indices of rows the user started but did not finish.
 *
 * A mirror of `incompleteExecRows()` in the form, and the same contract: an
 * incomplete row BLOCKS the save with a numbered message, and is never dropped
 * silently. A row holding "60 %" with no price is an intention that was not
 * finished; swallowing it means lying to the user that it was saved.
 *
 * A completely empty row is NOT incomplete — it is just an empty editor row.
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

/** The percentage total over complete rows. Incomplete ones do not count — they block. */
export function totalScaleOutPct(rows: readonly ScaleOutRow[]): number {
  return rows.reduce((sum, r) => {
    const pct = num(r.pct);
    const price = num(r.price);
    if (pct == null || price == null || pct <= 0 || price <= 0) return sum;
    return sum + pct;
  }, 0);
}

/** Editor rows → what goes into the column. Empty rows fall away. */
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
