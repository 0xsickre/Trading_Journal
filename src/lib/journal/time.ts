import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

export const DEFAULT_TZ = "America/New_York";

/**
 * A timezone name the platform actually knows, or the default.
 *
 * `Intl` throws `RangeError: Invalid time zone specified` on an unknown name,
 * and `formatInTimeZone` passes that straight up. Account timezone comes from a
 * fixed picker in Settings, but the column is plain `text` with no constraint,
 * so a direct PostgREST write or a future code path can put anything there —
 * and one bad row would then throw inside a Server Component, i.e. a 500 on
 * every page that shows a date, INCLUDING Settings, where the value would have
 * to be corrected. Locking the user out of the only fix is worse than showing
 * the wrong clock, so this degrades instead of throwing.
 *
 * Memoized because it runs per formatted timestamp and the answer never changes
 * for a given string.
 */
const TZ_CACHE = new Map<string, string>();

function safeTz(tz: string): string {
  const hit = TZ_CACHE.get(tz);
  if (hit !== undefined) return hit;
  let resolved = DEFAULT_TZ;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    resolved = tz;
  } catch {
    // Unknown zone — fall through to the default.
  }
  TZ_CACHE.set(tz, resolved);
  return resolved;
}

/**
 * Whether the runtime recognizes this zone.
 *
 * Exported so a WRITE can refuse what the read path would silently paper over.
 * `safeTz` degrading to the default is right for rendering — a mistyped zone
 * must not blank the journal — but it makes a bad value invisible: save
 * `Europe/Belgrad` with the "e" missing and every day key, every calendar cell
 * and every daily total quietly resolves in New York instead, with no error and
 * nothing on screen that looks wrong. The place to catch that is the save.
 */
export function isValidTimeZone(tz: string): boolean {
  return safeTz(tz) === tz;
}

/**
 * How a date is written on screen: day first, and a 24-hour clock.
 *
 * One set of shapes rather than a format string at each call site, because
 * "what does a date look like here" is one question. They were four different
 * answers — `MM/dd HH:mm`, `d MMM yyyy`, `d. MMM yyyy.` and `yyyy-MM-dd HH:mm` —
 * and the first of those is the American order, which reads as a different date
 * rather than as a different style: 03/07 is 7 March here and 3 July there.
 *
 * `DAY_TIME` drops the year for table columns where every row is within the
 * same season of trading and the width is worth more than the year.
 *
 * NOT these: day keys (`yyyy-MM-dd`), `<input type="datetime-local">` values and
 * the CSV/XLSX export all stay ISO. Those are read by machines — a sort order
 * and a parser — and an export that changes shape with a UI preference is an
 * export that breaks somebody's spreadsheet.
 */
export const DATE = "dd/MM/yyyy";
export const DATE_TIME = "dd/MM/yyyy HH:mm";
export const DAY_TIME = "dd/MM HH:mm";

/** Format a UTC timestamp in the account's timezone (e.g. "New York time"). */
export function fmtInTz(
  iso: string | Date | null | undefined,
  tz: string = DEFAULT_TZ,
  fmt = "yyyy-MM-dd HH:mm",
): string {
  if (!iso) return "";
  // An unparseable instant renders as an em dash rather than throwing: this is
  // called from render paths, and one malformed timestamp must not blank a page.
  if (!Number.isFinite(toEpoch(iso))) return "—";
  return formatInTimeZone(iso, safeTz(tz), fmt);
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
  const at = fromZonedTime(local, safeTz(tz));
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

/**
 * The instant a day key BEGINS in `tz`, as epoch ms. Inverse of `zonedDateKey`.
 *
 * Exists so a period filter can be a day boundary instead of a rolling instant.
 * `new Date()` minus N days keeps the current time of day, which makes "last 90
 * days" a window that slides continuously: a trade closed at 10:00 ninety days
 * ago is inside it at 09:00 and outside it at 11:00, so the same page shows two
 * different net P&Ls for the same data depending on when it is opened.
 *
 * Null when the day key is unparseable — never NaN, which would compare false
 * against everything and silently empty the window.
 */
export function dayKeyStartUtc(
  day: string,
  tz: string = DEFAULT_TZ,
): number | null {
  const at = zonedInputToUtc(`${day}T00:00`, tz);
  if (at == null) return null;
  const ms = Date.parse(at);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Whether a string is a day the CALENDAR actually has.
 *
 * `/^\d{4}-\d{2}-\d{2}$/` is a shape check, not a date check, and three routes
 * were using it alone on a value straight out of the URL. `2026-00-00` passes
 * that regex and then rolls silently backwards into December 2025 — so
 * `/calendar?month=2026-00` rendered December's grid under a 2026 heading, and
 * `/daily?date=2026-00-00` opened a day that does not exist. Nothing crashed,
 * which is what made it worth catching.
 *
 * Built on `dayKeyStartUtc` because the conversion is already strict where a
 * regex cannot be: it refuses 30 February, 29 February in a non-leap year and
 * 31 April, while accepting 29 February 2028.
 */
export function isValidDayKey(day: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && dayKeyStartUtc(day, "UTC") != null;
}

/** Whether a string is a month the calendar actually has ("yyyy-MM"). */
export function isValidMonthKey(month: string): boolean {
  return /^\d{4}-\d{2}$/.test(month) && isValidDayKey(`${month}-01`);
}

/** Inverse of zonedInputToUtc — UTC ISO -> "yyyy-MM-dd'T'HH:mm" in `tz`. */
export function utcToZonedInput(
  iso: string | Date | null | undefined,
  tz: string = DEFAULT_TZ,
): string {
  if (!iso) return "";
  // Empty, not an em dash: this feeds a `<input type="datetime-local">`, where a
  // value the control cannot parse is worse than no value at all.
  if (!Number.isFinite(toEpoch(iso))) return "";
  return formatInTimeZone(iso, safeTz(tz), "yyyy-MM-dd'T'HH:mm");
}

/**
 * Parse a broker-exported timestamp into UTC ISO. If the string carries an
 * explicit offset/Z it's respected; otherwise it's interpreted as wall-clock
 * time in the account `tz` (e.g. an MT5 export in broker-server/NY time).
 *
 * **This function refuses to guess, and that is the whole design.**
 *
 * It used to end in a bare `new Date(s)` fallback, which broke two ways at once
 * on the same input. `"02/03/2026 10:00"` came back as
 * `2026-02-03T10:00:00.000Z`:
 *
 *   1. **Wrong month.** V8 reads slashed numerics as US month-first, so a
 *      European export meaning 2 March became 3 February. Above day 12 the same
 *      string is simply Invalid Date, so exactly the ambiguous window — the half
 *      of the calendar where both readings are plausible — failed silently while
 *      the unambiguous half failed loudly.
 *   2. **Wrong zone.** The fallback never saw `tz` at all. Every other branch
 *      routes wall-clock through `fromZonedTime`; this one took the system zone,
 *      which on a server is UTC. For a New York account that is five hours, more
 *      than enough to move a close over midnight and into the wrong day's P&L,
 *      the wrong calendar cell and the wrong week.
 *
 * An unreadable timestamp now returns `null`, and the import wizard refuses to
 * build a fill without one. A row the user must look at beats a row that is
 * quietly a month off.
 */
export function parseImportTime(
  raw: string | null | undefined,
  tz: string = DEFAULT_TZ,
): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;

  // FIRST, before anything tries to read it: an all-numeric date that does not
  // start with the year is unresolvable. 02/03/2026 is 2 March to half the
  // world and 3 February to the other half, and nothing in the string says
  // which. Refused rather than guessed — including when it carries a time or an
  // offset, since those settle the clock but never the field order.
  if (/^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}/.test(s)) return null;

  // An offset is only meaningful after a time, and demanding one is not
  // pedantry: `"02-03-2026"` ends in `-2026`, which is a syntactically valid
  // ±HHMM offset. Without the time requirement that date took the absolute-
  // instant branch and came back as 3 February, in UTC.
  const hasOffset = /\d{1,2}:\d{2}(:\d{2})?(\.\d+)?\s*([zZ]|[+-]\d{2}:?\d{2})$/.test(s);
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
    return fromZonedTime(local, safeTz(tz)).toISOString();
  }

  // Date only.
  const dOnly = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (dOnly) {
    const [, y, mo, d] = dOnly;
    const local = `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}T00:00:00`;
    return fromZonedTime(local, safeTz(tz)).toISOString();
  }

  // A bare number is not a date. `new Date("45000")` is the year 45000, and an
  // Excel serial or a Unix timestamp arriving as text would have been read as
  // a time forty thousand years from now instead of refused.
  if (/^[\d\s.,]+$/.test(s)) return null;

  // A month NAME is unambiguous, so these are still accepted — but the wall
  // clock has to be lifted out and re-applied in the account's zone. `new Date`
  // resolves a name-form string in the SYSTEM zone; reading the local getters
  // back gives exactly the wall clock the string stated, which is then the
  // input `fromZonedTime` needs.
  const named = new Date(s);
  if (Number.isNaN(named.getTime())) return null;
  const wall =
    `${named.getFullYear()}-${String(named.getMonth() + 1).padStart(2, "0")}` +
    `-${String(named.getDate()).padStart(2, "0")}` +
    `T${String(named.getHours()).padStart(2, "0")}` +
    `:${String(named.getMinutes()).padStart(2, "0")}` +
    `:${String(named.getSeconds()).padStart(2, "0")}`;
  return fromZonedTime(wall, safeTz(tz)).toISOString();
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
  // Guarded like the rest: a day key is the join key for every daily
  // aggregation, so throwing here would take down the calendar, the dashboard
  // and the tracker at once.
  if (!Number.isFinite(toEpoch(iso))) return "";
  return formatInTimeZone(iso, safeTz(tz), "yyyy-MM-dd");
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Monday yyyy-MM-dd of the week containing `iso` in `tz` (ISO week, Mon start). */
export function zonedWeekStartKey(
  iso: string | Date | null | undefined,
  tz: string = DEFAULT_TZ,
): string {
  if (!iso) return "";
  if (!Number.isFinite(toEpoch(iso))) return "";
  // One pass through the timezone conversion for both the date and the weekday
  // ("i" is the ISO day, 1=Mon … 7=Sun); this used to call it twice.
  const [dayKey, isoDow] = formatInTimeZone(iso, safeTz(tz), "yyyy-MM-dd|i").split("|");
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
 * Whether a day is a trading day: Monday to Friday.
 *
 * The market is closed at the weekend, so nothing is scored on one — no rule,
 * no streak day, no day on a focus goal. One definition, so the tracker and the
 * goal counter cannot disagree about which days count.
 */
export function isTradingDayKey(day: string): boolean {
  const dow = isoWeekdayOfDayKey(day);
  return dow >= 1 && dow <= 5;
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
/** Monday-first, matching `isoWeekdayOfDayKey`'s 1–7. */
export const WEEKDAY_LABELS = [
  "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun",
] as const;

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * "August 2026" from a month key.
 *
 * Lives here rather than in the calendar component because BOTH views need it
 * and one of them renders on the server. It was briefly exported from
 * `month-calendar.tsx`, which carries `"use client"` — Next refuses a server
 * component calling into a client module, and the page died at runtime with
 * "Attempted to call monthLabel() from the server".
 *
 * No trailing dot: that was the Serbian date convention, and "January 2026."
 * reads as a typo in English.
 */
export function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  return `${MONTH_NAMES[m - 1] ?? monthKey} ${y}`;
}

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

/**
 * The timezone a trade is dated in, per the account it belongs to.
 *
 * This stood in five copies with FOUR different fallback chains:
 *
 *   dashboard.tsx   ?? "America/New_York"            ← no primary-account step
 *   /daily          ?? primary.timezone
 *   /weekly         ?? primary.timezone
 *   /calendar       ?? primary?.timezone ?? DEFAULT_TZ
 *   /playbooks      ?? primary?.timezone ?? "America/New_York"
 *
 * The difference is not cosmetic. A trade with no `account_id` — and one is
 * created whenever an account is deleted, because the foreign key is
 * `ON DELETE SET NULL` — would be dated by the Dashboard on a New York day and
 * by the calendar in the primary account's zone. For an account in
 * `Europe/Berlin` that is one column's difference in the calendar, on the same
 * trade.
 *
 * One chain for everything: account zone → primary account zone → `DEFAULT_TZ`.
 */
export function accountTimezoneResolver(
  accounts: readonly { id: string; timezone: string }[],
  primaryTz?: string | null,
): (accountId: string | null | undefined) => string {
  const byId = new Map(accounts.map((a) => [a.id, a.timezone]));
  const fallback = primaryTz ?? DEFAULT_TZ;
  return (accountId) =>
    (accountId ? byId.get(accountId) : undefined) ?? fallback;
}
