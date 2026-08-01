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

/**
 * Whole days from `from` to `to`, signed. Same day gives 0.
 *
 * Both keys are parsed as UTC midnight, so the difference is always an exact
 * multiple of 86 400 000 ms — no DST hour can round it to 0.99 of a day. That
 * is the whole reason this is string arithmetic and not `Date` subtraction on
 * zoned instants.
 *
 * Returns 0 for anything that is not a day key, matching `addDaysToDayKey`'s
 * habit of degrading visibly rather than producing NaN downstream.
 */
export function daysBetweenDayKeys(from: string, to: string): number {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(from) || !re.test(to)) return 0;
  const ms = (k: string) => {
    const [y, mo, d] = k.split("-").map(Number);
    return Date.UTC(y, mo - 1, d);
  };
  const diff = ms(to) - ms(from);
  return Number.isNaN(diff) ? 0 : Math.round(diff / 86_400_000);
}

/**
 * First and last day of a heatmap window of `weeks` columns ending on `endDay`.
 *
 * The end is padded forward to Saturday so the final column is full and every
 * row is one weekday; the start then falls on a Sunday, which is what makes the
 * grid read top-to-bottom Sun→Sat.
 *
 * Pulled out of the component because it is the one piece of that grid worth
 * testing: it is pure day-key arithmetic, and getting the padding wrong shifts
 * every cell by a row without throwing anything.
 */
export function heatmapWindow(
  endDay: string,
  weeks: number,
): { start: string; end: string } {
  const iso = isoWeekdayOfDayKey(endDay); // 1=Mon … 7=Sun
  // ISO Sunday is 7 but starts the display week, so it needs the full 6 days.
  const end = addDaysToDayKey(endDay, iso === 7 ? 6 : 6 - iso);
  return { start: addDaysToDayKey(end, -(weeks * 7 - 1)), end };
}

/**
 * Shift a `yyyy-MM` month key by whole months.
 *
 * `Date.UTC` normalizes an out-of-range month index, so December + 1 rolls the
 * year without a special case. Day 1 is used because it exists in every month —
 * anchoring on the current day would turn 31 January + 1 into 2 March.
 */
export function addMonthsToMonthKey(key: string, delta: number): string {
  if (!/^\d{4}-\d{2}$/.test(key)) return key;
  const [y, m] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + delta, 1));
  if (Number.isNaN(dt.getTime())) return key;
  return dt.toISOString().slice(0, 7);
}

/**
 * Every day key a month's calendar grid must render, Monday-aligned.
 *
 * Runs from the Monday of the week holding the 1st to the Sunday of the week
 * holding the last day, so the grid is always whole weeks and the leading and
 * trailing cells belong to the neighbouring months. Length is therefore 28, 35
 * or 42 — deliberately variable rather than a fixed six rows, because a row made
 * entirely of next month's days is noise in every month that does not need it.
 *
 * String and UTC arithmetic only, like `heatmapWindow`: these are day keys in the
 * ACCOUNT's timezone, and `new Date()` read in local time would shift the whole
 * grid by a day for anyone whose browser zone differs from their account's.
 *
 * Returns an empty array for a malformed key, which renders as an empty month
 * rather than as a grid of `NaN` cells.
 */
export function monthGridDays(monthKey: string): string[] {
  if (!/^\d{4}-\d{2}$/.test(monthKey)) return [];
  const [y, m] = monthKey.split("-").map(Number);

  const first = `${monthKey}-01`;
  // Day 0 of the NEXT month is the last day of this one — no month-length table.
  const lastDate = new Date(Date.UTC(y, m, 0));
  if (Number.isNaN(lastDate.getTime())) return [];
  const last = lastDate.toISOString().slice(0, 10);

  // ISO weekday: 1 = Mon … 7 = Sun.
  const start = addDaysToDayKey(first, -(isoWeekdayOfDayKey(first) - 1));
  const end = addDaysToDayKey(last, 7 - isoWeekdayOfDayKey(last));

  const out: string[] = [];
  for (let d = start; d <= end; d = addDaysToDayKey(d, 1)) out.push(d);
  return out;
}
