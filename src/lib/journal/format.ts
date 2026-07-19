export function fmtMoney(
  n: number | null | undefined,
  currency = "USD",
  opts: { sign?: boolean } = {},
): string {
  if (n == null || Number.isNaN(n)) return "—";
  const s = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(n);
  return opts.sign && n > 0 ? `+${s}` : s;
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
  return `${n > 0 ? "+" : ""}${n.toFixed(2)}R`;
}

export function fmtPct(n: number | null | undefined, digits = 1): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

/** Tailwind text color class for a signed value (profit/loss). */
export function pnlClass(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n) || n === 0) return "text-muted-foreground";
  return n > 0 ? "text-[var(--profit)]" : "text-[var(--loss)]";
}
