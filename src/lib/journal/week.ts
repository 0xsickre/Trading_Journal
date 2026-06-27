// Client-safe week keying. Shared/leg analysis data is keyed by the Monday of
// the week so every analysis started that week reuses the same snapshot.
//
// Pure UTC math — no Date locale / timezone / DST involvement — so the same
// input date always maps to the same week regardless of machine settings.

const DAY_MS = 86_400_000;

/**
 * Monday (UTC, ISO week start) of the week containing `dateStr`.
 * @param dateStr `YYYY-MM-DD`. Invalid input returns "" so callers can guard.
 * @returns `YYYY-MM-DD` of that Monday, or "" if the input is malformed.
 */
export function weekStart(dateStr: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr ?? "");
  if (!m) return "";
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const ms = Date.UTC(year, month - 1, day);
  // getUTCDay: 0=Sun..6=Sat. ISO weeks start Monday, so Sunday is 6 days after.
  const dow = new Date(ms).getUTCDay();
  const backToMonday = (dow + 6) % 7; // Mon->0, Tue->1, ... Sun->6
  return new Date(ms - backToMonday * DAY_MS).toISOString().slice(0, 10);
}

/** Today's week-start (UTC Monday), `YYYY-MM-DD`. */
export function currentWeekStart(): string {
  return weekStart(new Date().toISOString().slice(0, 10));
}
