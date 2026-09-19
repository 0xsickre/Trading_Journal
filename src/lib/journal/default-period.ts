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
