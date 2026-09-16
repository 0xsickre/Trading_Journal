/**
 * The quote currency's rate against the account currency — one expression, not
 * five.
 *
 * This module exists because four places have to answer the same question: the
 * SQL view (`tj_position_stats`), its TypeScript twin (`position-stats.ts`),
 * the trade form, and the write path that records the rate. Round 3 of the
 * review found the "two answers to one question" class seven times; this is an
 * attempt to stop an eighth from appearing.
 *
 * The `CASE` expression in the view
 * (`20260815130000_quote_currency_and_fx.sql`) is this same precedence order,
 * line for line. If one changes, so must the other.
 */

/** Why the rate is what it is — for the UI, and for diagnostics. */
export type FxRateSource =
  /** Recorded on the trade when written. The only source that cannot drift. */
  | "snapshot"
  /** The instrument is quoted in the account's currency, so conversion is a no-op. */
  | "same_currency"
  /** The trade has no account, so there is nothing to compare the quote currency against. */
  | "no_account"
  /** Valute se razlikuju a kurs nije zapisan. Novac se NE prikazuje. */
  | "missing";

export type ResolvedFxRate = {
  /** `null` means money must not be displayed — not that the rate is 1. */
  rate: number | null;
  source: FxRateSource;
};

export function resolveFxRate(input: {
  /** The position's `fx_rate_at_trade`, if it was recorded. */
  snapshot?: number | null;
  /** The currency the instrument is quoted in. */
  quoteCurrency?: string | null;
  /** The account's currency. `null` when the trade has no account. */
  accountCurrency?: string | null;
}): ResolvedFxRate {
  const { snapshot, quoteCurrency, accountCurrency } = input;

  // The recorded value always wins, as with `point_value_at_trade`. History is
  // not recomputed at today's rate — that is bug C1, already fixed once.
  if (snapshot != null && Number.isFinite(snapshot) && snapshot > 0) {
    return { rate: snapshot, source: "snapshot" };
  }

  if (!accountCurrency) return { rate: null, source: "no_account" };

  // A rate of one is assumed ONLY when the currencies genuinely match. As a
  // fallback for an unknown rate, 1 would quietly equate a yen with a dollar —
  // the same error `COALESCE(point_value, 1)` made over the contract spec.
  if (quoteCurrency && quoteCurrency === accountCurrency) {
    return { rate: 1, source: "same_currency" };
  }

  return { rate: null, source: "missing" };
}

/** Whether the UI should mark the trade as incompletely valued. */
export function fxRateNeedsAttention(source: FxRateSource): boolean {
  return source === "missing" || source === "no_account";
}
