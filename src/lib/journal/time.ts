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

/** "yyyy-MM-dd" calendar day in tz — used for daily P/L grouping. */
export function zonedDateKey(
  iso: string | Date | null | undefined,
  tz: string = DEFAULT_TZ,
): string {
  if (!iso) return "";
  return formatInTimeZone(iso, tz, "yyyy-MM-dd");
}
