/**
 * Outcome classification against the account's breakeven band.
 *
 * Before this module, a trade counted as breakeven only when net P&L equalled
 * exactly 0 — tested on a float that already carries fees and swap. That is
 * practically never true, so the breakeven bucket was always empty and win rate
 * had nothing to exclude from its denominator.
 *
 * The band is asymmetric on purpose: "-37.50 to 0" is a normal configuration
 * (costs ate the trade but the idea was flat), not a symmetric tolerance.
 */

export type Outcome = "win" | "loss" | "breakeven";

export type BreakevenUnit = "currency" | "pct";

/** The account fields this module needs — keeps callers and tests light. */
export type BreakevenConfig = {
  breakeven_from: number;
  breakeven_to: number;
  breakeven_unit: BreakevenUnit;
  starting_balance: number;
};

/** Band resolved into account currency, ready to compare against net P&L. */
export type BreakevenRange = { from: number; to: number };

/** Reproduces the old exact-zero behaviour — used when no account is in scope. */
export const EXACT_ZERO_RANGE: BreakevenRange = { from: 0, to: 0 };

export function resolveBreakevenRange(
  config: BreakevenConfig | null | undefined,
): BreakevenRange {
  if (!config) return EXACT_ZERO_RANGE;
  const { breakeven_from, breakeven_to, breakeven_unit, starting_balance } =
    config;
  if (breakeven_unit === "pct") {
    const base = Math.abs(starting_balance) / 100;
    return { from: breakeven_from * base, to: breakeven_to * base };
  }
  return { from: breakeven_from, to: breakeven_to };
}

/**
 * Classify realized P&L. The band is inclusive on both ends, so a 0..0 band
 * classifies exactly-zero as breakeven and behaves like the previous code.
 */
export function classifyOutcome(
  netPnl: number,
  range: BreakevenRange = EXACT_ZERO_RANGE,
): Outcome {
  if (netPnl >= range.from && netPnl <= range.to) return "breakeven";
  return netPnl > range.to ? "win" : "loss";
}

/** True when the account has an actual band configured (not the 0..0 default). */
export function hasBreakevenBand(range: BreakevenRange): boolean {
  return range.from !== 0 || range.to !== 0;
}

/**
 * Jedan breakeven pojas za skup naloga.
 *
 * Isti blok od šest redova stajao je u pet kopija — `dashboard.tsx` i četiri
 * rute (`/daily`, `/calendar`, `/weekly`, `/playbooks`). Dok su identične,
 * dupliranje je samo trošak; problem je što bi izmena jedne tiho razišla ekrane,
 * a win rate na Dashboard-u i na kalendaru bi počeo da se razlikuje nad istim
 * trejdovima.
 *
 * Pravilo: pojas se primenjuje samo ako se SVI nalozi u opsegu slažu oko njega.
 * Kad se ne slažu, pada na tačnu nulu — jer trejd od +15 $ ne može istovremeno
 * biti breakeven na jednom nalogu i dobitak na drugom, a birati jedan od dva
 * pojasa značilo bi primeniti tuđe pravilo na tuđe trejdove.
 *
 * Prazan skup takođe daje tačnu nulu: nema naloga čiji bi se pojas primenio.
 */
export function sharedBreakevenRange(
  accounts: readonly BreakevenConfig[],
): BreakevenRange {
  if (accounts.length === 0) return EXACT_ZERO_RANGE;
  const ranges = accounts.map((a) => resolveBreakevenRange(a));
  const first = ranges[0];
  const uniform = ranges.every((r) => r.from === first.from && r.to === first.to);
  return uniform ? first : EXACT_ZERO_RANGE;
}
