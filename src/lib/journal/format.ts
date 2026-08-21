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

/**
 * Decimal places implied by an instrument's tick size.
 *
 * Counted off the decimal representation rather than derived with log10,
 * because tick sizes are not all powers of ten: ES ticks at 0.25, and
 * `-log10(0.25)` rounds to 1, which would print 5000.25 as 5000.3.
 */
export function priceDigits(tickSize: number | null | undefined): number {
  if (tickSize == null || Number.isNaN(tickSize) || !(tickSize > 0)) return 2;

  const s = String(tickSize);
  const exp = s.match(/e-(\d+)$/i);
  if (exp) return Math.min(10, Number(exp[1]));

  const dot = s.indexOf(".");
  return dot < 0 ? 0 : Math.min(10, s.length - dot - 1);
}

/**
 * A price at the precision its instrument actually quotes.
 *
 * `fmtNum(x, 2)` is right for money and wrong for a price: it renders a EURUSD
 * stop of 1.16101 and a target of 1.16453 as the same "1.16", which is not a
 * rounded number but two different facts collapsed into one wrong one. Prices
 * therefore format against `tick_size_at_trade`, the value frozen on the trade
 * when it was written.
 */
export function fmtPrice(
  n: number | null | undefined,
  tickSize: number | null | undefined,
): string {
  if (n == null || Number.isNaN(n)) return "—";
  const digits = priceDigits(tickSize);
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: digits,
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
