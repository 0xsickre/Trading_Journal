/**
 * Which period the dashboard opens on.
 *
 * It opened on 90 days, always. For a live account that is the right default:
 * the recent past is the question. For a BACKTEST it hides everything: a
 * TradingView replay of 2018 produces trades closed in 2018, every one of them
 * outside any window counted back from today, and the dashboard opened on a
 * page of zeros — or worse, on the one trade that happened to be dated today,
 * presented as the whole account.
 *
 * So the default is 90 days when anything closed within them, and "all" when
 * nothing did. Not a guess about the account's kind — there is no such flag —
 * but a reading of the only fact that decides whether 90 days can show anything.
 */
export function defaultDashboardPeriod(
  closedAtMs: readonly number[],
  cutoff90Ms: number,
): "90" | "all" {
  if (closedAtMs.length === 0) return "90";
  return closedAtMs.some((t) => t >= cutoff90Ms) ? "90" : "all";
}

/**
 * The trades a period is hiding, said out loud.
 *
 * `null` when it hides none. Otherwise how many, and the oldest close among
 * them, so the notice can say how far back the account goes.
 */
export function hiddenByPeriod(
  closedAtMs: readonly number[],
  cutoffMs: number | null,
): { count: number; oldestMs: number } | null {
  if (cutoffMs == null) return null;
  const hidden = closedAtMs.filter((t) => t < cutoffMs);
  if (hidden.length === 0) return null;
  return { count: hidden.length, oldestMs: Math.min(...hidden) };
}
