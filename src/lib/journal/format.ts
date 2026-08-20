/**
 * Round to the displayed precision before formatting.
 *
 * A value that is negative but rounds to zero (-0.001 at two decimals) would
 * otherwise render as "-0.00" — a minus sign on a zero, which reads as a loss
 * that isn't there. `|| 0` also collapses the negative zero this produces.
 */
function roundForDisplay(n: number, digits: number): number {
  return Number(n.toFixed(digits)) || 0;
}

export function fmtMoney(
  n: number | null | undefined,
  currency = "USD",
  opts: { sign?: boolean } = {},
): string {
  if (n == null || Number.isNaN(n)) return "—";
  const v = roundForDisplay(n, 2);
  const s = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(v);
  return opts.sign && v > 0 ? `+${s}` : s;
}

/**
 * The one currency every account in scope agrees on, or `null` when they
 * don't.
 *
 * There is no safe fallback value to return instead — unlike a breakeven band
 * (see `sharedBreakevenRange`, which falls back to an exact-zero band when
 * accounts disagree, a conservative but still meaningful default), there is no
 * "neutral" currency a caller can sum money in when the accounts in scope
 * don't share one. `null` is the signal: a caller pooling money across
 * accounts must check this before summing, or it will add unlike units
 * together and call the result a number.
 */
export function sharedCurrency(
  accounts: readonly { currency: string }[],
): string | null {
  if (accounts.length === 0) return null;
  const set = new Set(accounts.map((a) => a.currency));
  return set.size === 1 ? [...set][0] : null;
}

export function fmtNum(
  n: number | null | undefined,
  digits = 2,
): string {
  if (n == null || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(n);
}

export function fmtR(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  const v = roundForDisplay(n, 2);
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}R`;
}

export function fmtPct(n: number | null | undefined, digits = 1): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${roundForDisplay(n, digits).toFixed(digits)}%`;
}

/** Tailwind text color class for a signed value (profit/loss). */
export function pnlClass(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n) || n === 0) return "text-muted-foreground";
  return n > 0 ? "text-[var(--profit)]" : "text-[var(--loss)]";
}
