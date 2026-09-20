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
const INSTRUMENT_ALIAS_TO_CANONICAL: Record<string, string> = {
  // The index, under every name a statement or a platform gives it. The
  // canonical one is the broker's own — "US100.cash" — so an MT5 import matches
  // without a mapping at all; these are for the exports that do not.
  US100CASH: "US100.cash",
  US100: "US100.cash",
  NAS100: "US100.cash",
  NAS100USD: "US100.cash",
  USTEC: "US100.cash",
  NDX: "US100.cash",

  // Metals
  GOLD: "XAUUSD",
  XAU: "XAUUSD",
  XAUUSD: "XAUUSD",
  COPPER: "XCUUSD",
  XCU: "XCUUSD",
  HGCASH: "XCUUSD",

  // FX
  EURUSD: "EURUSD",
  GBPUSD: "GBPUSD",
  USDJPY: "USDJPY",
  USDCAD: "USDCAD",
  USDCHF: "USDCHF",
  AUDUSD: "AUDUSD",
  NZDUSD: "NZDUSD",
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
