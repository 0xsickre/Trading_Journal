/**
 * The review half of a trade the import brought in (phase O, 08.10.2026): the
 * A/B/C grade on `execution_rating`, the "no mistake" tag, and the exit reason
 * read off the prices or off TopstepX's orders. Logging a trade by hand after
 * the close (`/trades/log`) left with the plan form; the import is the only way
 * a trade comes in now, and this is what the review page and the import share.
 *
 * Pure: the review page, the import and their tests use it.
 */

/**
 * Was it by plan — A, B or C — kept on the existing 1–5 `execution_rating`
 * scale so every report that reads the rating reads these too.
 *
 *   A  by plan (entry, stop, size, exit as written)       5
 *   B  small deviations                                   3
 *   C  a rule broken                                      1
 */
export const GRADES = ["A", "B", "C"] as const;
export type Grade = (typeof GRADES)[number];
export const GRADE_RATING: Record<Grade, number> = { A: 5, B: 3, C: 1 };

export function gradeFromRating(rating: number | null | undefined): Grade | null {
  if (rating == null || !Number.isFinite(rating) || rating < 1) return null;
  if (rating >= 5) return "A";
  if (rating >= 3) return "B";
  return "C";
}

/** The mistake list's own "nothing went wrong" item, recorded on an A so a clean trade is counted as one. */
export const NO_MISTAKE = "Bez greške";

/**
 * Why the trade ended, read off the prices. The stop is hit when the exit is AT
 * OR PAST it on the losing side (or within two ticks short of it): a stop-market
 * order in a fast NQ tape fills several ticks through the stop, and that is a
 * stop, not a hand close. The target likewise at or past it, or within two
 * ticks; the entry within two ticks is break-even; anything else was closed by
 * hand. Returned only when the trader's own exit-reason list has that item, so
 * a renamed list is never written a value it does not offer.
 */
export function autoExitReason(params: {
  direction: string | null;
  entry: number | null;
  exit: number | null;
  stop: number | null;
  target: number | null;
  tickSize: number | null;
  options: readonly string[];
}): string | null {
  const { entry, exit, stop, target, options } = params;
  if (entry == null || exit == null) return null;
  const tol = 2 * (params.tickSize && params.tickSize > 0 ? params.tickSize : 0);
  const near = (a: number | null) => a != null && a > 0 && Math.abs(exit - a) <= tol + 1e-9;
  // +1 long, −1 short: the direction as written, else the side the stop is on.
  const dir = params.direction
    ? params.direction.toLowerCase().startsWith("short")
      ? -1
      : 1
    : stop != null && stop > entry
      ? -1
      : 1;
  const set = (a: number | null): a is number => a != null && a > 0;
  const pastStop = set(stop) && dir * (exit - stop) <= tol + 1e-9;
  const pastTarget = set(target) && dir * (exit - target) >= -tol - 1e-9;
  const pick = (v: string) => (options.includes(v) ? v : null);
  // The seeded exit reasons, in Serbian since K2 (`20260929200000`).
  if (pastStop) return pick("Pogođen stop");
  if (pastTarget) return pick("Pogođen target");
  if (near(entry)) return pick("Na nuli");
  return pick("Zatvoreno ranije");
}

/**
 * Why the trade ended, read off TopstepX's orders (phase O): the stop order
 * filled is a stop — a trailing one when that stop had been moved to the entry
 * or into profit — the target order filled is the target, and anything else was
 * closed by hand, then named off the prices as `autoExitReason` names it.
 */
export function exitReasonFromBracket(params: {
  exitKind: "stop" | "target" | "manual";
  stopMovedToProfit: boolean;
  direction: string | null;
  entry: number | null;
  exit: number | null;
  tickSize: number | null;
  options: readonly string[];
}): string | null {
  const pick = (v: string) => (params.options.includes(v) ? v : null);
  if (params.exitKind === "stop") return params.stopMovedToProfit ? pick("Prateći stop") : pick("Pogođen stop");
  if (params.exitKind === "target") return pick("Pogođen target");
  return autoExitReason({
    direction: params.direction,
    entry: params.entry,
    exit: params.exit,
    stop: null,
    target: null,
    tickSize: params.tickSize,
    options: params.options,
  });
}

/**
 * The exit reason an import writes when its fills close a trade that has none —
 * a trade logged while it was still running got no reason, because there was no
 * exit to read it from. Null when the trade already has one (the trader's word
 * stands), when the fills do not close it, or when the list has no fitting item.
 */
export function exitReasonAfterMerge(params: {
  current: string | null;
  fills: readonly { side: "entry" | "exit"; price: number; qty: number }[];
  direction: string | null;
  stop: number | null;
  target: number | null;
  tickSize: number | null;
  options: readonly string[];
}): string | null {
  if (params.current) return null;
  const avg = (side: "entry" | "exit") => {
    const f = params.fills.filter((x) => x.side === side && x.qty > 0);
    const qty = f.reduce((s, x) => s + x.qty, 0);
    return { qty, price: qty > 0 ? f.reduce((s, x) => s + x.price * x.qty, 0) / qty : null };
  };
  const entry = avg("entry");
  const exit = avg("exit");
  // Closed means every contract out; a partial exit is not an exit reason yet.
  if (entry.price == null || exit.price == null || exit.qty < entry.qty) return null;
  return autoExitReason({
    direction: params.direction,
    entry: entry.price,
    exit: exit.price,
    stop: params.stop,
    target: params.target,
    tickSize: params.tickSize,
    options: params.options,
  });
}
