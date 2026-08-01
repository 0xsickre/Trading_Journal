import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

export const DEFAULT_TZ = "America/New_York";

/** Format a UTC timestamp in the account's timezone (e.g. "New York time"). */
export function fmtInTz(
  iso: string | Date | null | undefined,
  tz: string = DEFAULT_TZ,
  fmt = "yyyy-MM-dd HH:mm",
): string {
  if (!iso) return "";
  return formatInTimeZone(iso, tz, fmt);
}

/**
 * Convert a wall-clock value typed into a <input type="datetime-local"> that
 * the user means in `tz` (e.g. "2026-06-20T09:30") into a UTC ISO string.
 */
export function zonedInputToUtc(
  local: string,
  tz: string = DEFAULT_TZ,
): string | null {
  if (!local) return null;
  return fromZonedTime(local, tz).toISOString();
}

/** Inverse of zonedInputToUtc — UTC ISO -> "yyyy-MM-dd'T'HH:mm" in `tz`. */
export function utcToZonedInput(
  iso: string | Date | null | undefined,
  tz: string = DEFAULT_TZ,
): string {
  if (!iso) return "";
  return formatInTimeZone(iso, tz, "yyyy-MM-dd'T'HH:mm");
}

/**
 * Parse a broker-exported timestamp into UTC ISO. If the string carries an
 * explicit offset/Z it's respected; otherwise it's interpreted as wall-clock
 * time in the account `tz` (e.g. an MT5 export in broker-server/NY time).
 */
export function parseImportTime(
  raw: string | null | undefined,
  tz: string = DEFAULT_TZ,
): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;

  const hasOffset = /([zZ]|[+-]\d{2}:?\d{2})$/.test(s);
  if (hasOffset) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  // Normalize "YYYY-MM-DD HH:mm[:ss]" or "YYYY/MM/DD ..." to ISO-local.
  const m = s.match(
    /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/,
  );
  if (m) {
    const [, y, mo, d, h, mi, se] = m;
    const local = `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}T${h.padStart(
      2,
      "0",
    )}:${mi}:${se ?? "00"}`;
    return fromZonedTime(local, tz).toISOString();
  }

  // Date only.
  const dOnly = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (dOnly) {
    const [, y, mo, d] = dOnly;
    const local = `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}T00:00:00`;
    return fromZonedTime(local, tz).toISOString();
  }

  const fallback = new Date(s);
  return Number.isNaN(fallback.getTime()) ? null : fallback.toISOString();
}

/**
 * Instant as epoch milliseconds, for comparing and sorting timestamps.
 *
 * ISO strings must never be compared as text. PostgREST returns
 * "2026-07-28T10:00:00+00:00" while the app generates
 * "2026-07-28T10:00:00.000Z"; those order correctly only by luck, because at an
 * identical whole second the comparison reaches '+' (0x2B) against '.' (0x2E)
 * and inverts. A trade closed exactly on a range boundary then lands on the
 * wrong side of it.
 *
 * Missing or unparseable values sort first, matching how `?? ""` behaved.
 */
export function toEpoch(iso: string | Date | null | undefined): number {
  if (!iso) return -Infinity;
  const ms = iso instanceof Date ? iso.getTime() : new Date(iso).getTime();
  return Number.isNaN(ms) ? -Infinity : ms;
}

/** Chronological comparator for ISO timestamps. */
export function compareInstants(
  a: string | Date | null | undefined,
  b: string | Date | null | undefined,
): number {
  return toEpoch(a) - toEpoch(b);
}

/** "yyyy-MM-dd" calendar day in tz — used for daily P/L grouping. */
export function zonedDateKey(
  iso: string | Date | null | undefined,
  tz: string = DEFAULT_TZ,
): string {
  if (!iso) return "";
  return formatInTimeZone(iso, tz, "yyyy-MM-dd");
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Monday yyyy-MM-dd of the week containing `iso` in `tz` (ISO week, Mon start). */
export function zonedWeekStartKey(
  iso: string | Date | null | undefined,
  tz: string = DEFAULT_TZ,
): string {
  if (!iso) return "";
  // One pass through the timezone conversion for both the date and the weekday
  // ("i" is the ISO day, 1=Mon … 7=Sun); this used to call it twice.
  const [dayKey, isoDow] = formatInTimeZone(iso, tz, "yyyy-MM-dd|i").split("|");
  if (!dayKey) return "";
  const offset = Number(isoDow) - 1;
  const [y, mo, d] = dayKey.split("-").map(Number);
  // Date.UTC normalises a day-of-month that underflows into the previous month.
  const monday = new Date(Date.UTC(y, mo - 1, d - offset));
  return `${monday.getUTCFullYear()}-${pad2(monday.getUTCMonth() + 1)}-${pad2(monday.getUTCDate())}`;
}

/**
 * ISO weekday of a plain yyyy-MM-dd key: 1=Mon … 7=Sun.
 *
 * The day key is already resolved to a timezone, so this must NOT resolve one
 * again — it is pure calendar arithmetic on the string.
 *
 * `getUTCDay`, never `getDay`: the date is built with `Date.UTC`, so reading it
 * back in local time shifts the weekday for every user west of UTC. (Note that
 * `isFriday` in daily-report.ts uses `parseISO(...).getDay()` — correct there
 * only because `parseISO` of a date-only string yields LOCAL midnight. The two
 * are not interchangeable; do not copy that pattern here.)
 *
 * Returns 0 for an unparseable key, which no `active_days` array can contain,
 * so a bad key makes a rule inapplicable rather than silently applying it on
 * the wrong day.
 */
export function isoWeekdayOfDayKey(day: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return 0;
  const [y, mo, d] = day.split("-").map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (Number.isNaN(dt.getTime())) return 0;
  const dow = dt.getUTCDay(); // 0=Sun … 6=Sat
  return dow === 0 ? 7 : dow;
}

/**
 * Shift a `yyyy-MM-dd` key by whole days.
 *
 * String in, string out, with the arithmetic done in UTC — never through
 * `new Date()` and `setDate`, which resolve in the BROWSER's zone. A day key
 * here means a day in the ACCOUNT's zone, and mixing the two shifts the whole
 * calendar by one column for anyone whose browser zone differs from their
 * account's. That was a live bug in the P&L heatmap before this existed.
 *
 * `Date.UTC` normalizes out-of-range components, so month and year rollover and
 * leap days fall out for free.
 *
 * Returns the input unchanged when it is not a day key, so a bad value shows up
 * as a stuck calendar rather than as `NaN-NaN-NaN` cells.
 */
export function addDaysToDayKey(day: string, delta: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return day;
  const [y, mo, d] = day.split("-").map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d + delta));
  if (Number.isNaN(dt.getTime())) return day;
  return dt.toISOString().slice(0, 10);
}
