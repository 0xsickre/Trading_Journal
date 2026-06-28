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

/** Add `days` to an ISO date string (UTC-safe). Returns "" if input is invalid. */
export function addDays(dateStr: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr ?? "");
  if (!m) return "";
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(ms + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Default week key for analysis / week workspace.
 * Mon–Fri: current ISO week Monday. Sat–Sun: next week's Monday (planning week).
 */
export function planningWeekStart(dateStr?: string): string {
  const today = dateStr ?? new Date().toISOString().slice(0, 10);
  const monday = weekStart(today);
  if (!monday) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(today);
  if (!m) return monday;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const dow = new Date(ms).getUTCDay(); // 0=Sun, 6=Sat
  if (dow === 0 || dow === 6) return addDays(monday, 7);
  return monday;
}

/** Today's calendar week-start (UTC Monday), `YYYY-MM-DD`. */
export function currentWeekStart(): string {
  return weekStart(new Date().toISOString().slice(0, 10));
}
