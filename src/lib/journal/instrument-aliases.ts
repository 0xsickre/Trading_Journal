// Broker / FTMO / legacy symbol aliases → canonical B6 watchlist (default-instruments.ts).

import { DEFAULT_INSTRUMENT_SYMBOLS } from "./default-instruments";

/** Strip separators for lookup: "US500.cash" → "US500CASH". */
export function cleanInstrumentKey(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * FTMO + legacy broker names → vault canonical symbol.
 * Keys are cleaned (see cleanInstrumentKey).
 */
export const INSTRUMENT_ALIAS_TO_CANONICAL: Record<string, string> = {
  // FTMO indices
  US500CASH: "SP500",
  US500: "SP500",
  SPX500USD: "SP500",
  SP500USD: "SP500",
  SPX500: "SP500",
  US100CASH: "NAS100",
  US100: "NAS100",
  NAS100USD: "NAS100",
  USTEC: "NAS100",
  NDX: "NAS100",
  NAS100: "NAS100",

  // Metals / commodities
  GOLD: "XAUUSD",
  XAU: "XAUUSD",
  XAUUSD: "XAUUSD",
  COPPER: "HG",
  HGCASH: "HG",

  // Russell / small-cap radar
  US2000: "RTY",
  RUSSELL2000: "RTY",
  RUSSELL: "RTY",

  // FX
  EURUSD: "EURUSD",
  GBPUSD: "GBPUSD",
  USDJPY: "USDJPY",
  USDCAD: "USDCAD",
  AUDUSD: "AUDUSD",
};

const CANONICAL_SET = new Set(DEFAULT_INSTRUMENT_SYMBOLS);

/**
 * Normalize import / broker symbol to canonical watchlist ticker.
 * Returns null for empty input; unknown symbols return cleaned uppercase key.
 */
export function normalizeInstrumentSymbol(
  raw: string | null | undefined,
): string | null {
  if (!raw?.trim()) return null;

  const key = cleanInstrumentKey(raw);
  const aliased = INSTRUMENT_ALIAS_TO_CANONICAL[key];
  if (aliased && CANONICAL_SET.has(aliased)) return aliased;

  const direct = DEFAULT_INSTRUMENT_SYMBOLS.find(
    (s) => cleanInstrumentKey(s) === key,
  );
  if (direct) return direct;

  return key;
}

export function instrumentsMatch(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const na = normalizeInstrumentSymbol(a);
  const nb = normalizeInstrumentSymbol(b);
  return na != null && nb != null && na === nb;
}
