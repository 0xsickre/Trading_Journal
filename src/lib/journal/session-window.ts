/**
 * Where in the trading day an entry was taken (F5.2, decision L1, 29.09.2026).
 *
 * Read on the exchange's clock — New York — and not the account's: the 09:30
 * cash open is the same instant for every trader, and the session windows below
 * are what the market does, whatever zone the journal shows the time in. DST is
 * the zone's own, so the windows follow the US calendar.
 */

import { zonedMinuteOfDay } from "./time";

/** The zone the market's sessions are stated in. */
export const SESSION_TZ = "America/New_York";

const OPEN = 9 * 60 + 30;

/** Session windows in order; each holds `[from, to)` minutes since 00:00 ET. */
const WINDOWS: readonly { label: string; from: number; to: number }[] = [
  { label: "Pre-open 08:00–09:30", from: 8 * 60, to: OPEN },
  { label: "Open 09:30–10:00", from: OPEN, to: 10 * 60 },
  { label: "Morning 10:00–11:30", from: 10 * 60, to: 11 * 60 + 30 },
  { label: "Lunch 11:30–13:30", from: 11 * 60 + 30, to: 13 * 60 + 30 },
  { label: "Afternoon 13:30–15:00", from: 13 * 60 + 30, to: 15 * 60 },
  // Up to the 18:00 reopen: the Topstep close (16:10 ET) and the halt after it.
  { label: "Last hour 15:00–", from: 15 * 60, to: 18 * 60 },
];

const GLOBEX_NIGHT = "Globex night 18:00–08:00";

/** Every session label, in day order — the dimension's declared `order`. */
export const SESSION_WINDOWS: readonly string[] = [
  GLOBEX_NIGHT,
  ...WINDOWS.map((w) => w.label),
];

/** The session an instant falls in, or null when it is unreadable. */
export function sessionWindowOf(iso: string | null | undefined): string | null {
  const m = zonedMinuteOfDay(iso, SESSION_TZ);
  if (m == null) return null;
  return WINDOWS.find((w) => m >= w.from && m < w.to)?.label ?? GLOBEX_NIGHT;
}

/** Buckets of "how long after the 09:30 open", in order. */
export const OPEN_OFFSET_BUCKETS = [
  "Before the open",
  "0–15 min",
  "15–30 min",
  "30–60 min",
  "1–2 h",
  "2 h +",
] as const;

/** How long after the 09:30 ET open an entry was taken; the evening/night before it is "Before the open". */
export function openOffsetBucket(iso: string | null | undefined): (typeof OPEN_OFFSET_BUCKETS)[number] | null {
  const m = zonedMinuteOfDay(iso, SESSION_TZ);
  if (m == null) return null;
  // The evening session (from 18:00) belongs to the NEXT day's open.
  if (m >= 18 * 60 || m < OPEN) return "Before the open";
  const after = m - OPEN;
  if (after < 15) return "0–15 min";
  if (after < 30) return "15–30 min";
  if (after < 60) return "30–60 min";
  if (after < 120) return "1–2 h";
  return "2 h +";
}
