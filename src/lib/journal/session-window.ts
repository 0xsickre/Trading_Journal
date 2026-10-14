/**
 * Where in the trading day an entry was taken (phase N, 14.10.2026; first F5.2, L1).
 *
 * The sessions are the lines on the trader's chart (`trading-mentor/GRAFIK.md`),
 * each read on the clock of its own exchange: Asia from the 18:00 New York
 * reopen to New York midnight, London from 08:00 in London, and New York's cash
 * session, lunch and close at their New York times. DST is each zone's own, so
 * the week the two calendars disagree (late October, March) moves the New York
 * lines an hour against London's, as it does on the chart.
 *
 * The labels state the usual Belgrade hours — the trader reads Belgrade time
 * (09.10.2026) — and are names, not the boundaries: in the week the clocks
 * disagree the New York sessions start an hour earlier than they say.
 *
 * Until 14.10.2026 everything before 08:00 New York was one "Globex night", so
 * a London trader's every trade sat in it and the table said nothing (Z-015).
 */

import { zonedMinuteOfDay } from "./time";

/** New York: the CME day, the cash session and its lunch are stated there. */
export const SESSION_TZ = "America/New_York";
/** London: its open is stated there. */
export const LONDON_TZ = "Europe/London";

const H = (h: number, m = 0) => h * 60 + m;
/** 08:00 in London. */
const LONDON_OPEN = H(8);
/** 08:00 New York: London ends where New York's pre-open begins. */
const NY_PRE_OPEN = H(8);
/** 09:30 New York, the cash open. */
const NY_OPEN = H(9, 30);
/** 18:00 New York, the Globex reopen that starts the next CME day. */
const REOPEN = H(18);

export const SESSIONS = {
  asia: "Azija 00:00–06:00",
  preLondon: "Pre Londona 06:00–09:00",
  london: "London 09:00–14:00",
  nyPreOpen: "NY pre otvaranja 14:00–15:30",
  nyAm: "NY AM 15:30–17:30",
  lunch: "Ručak 17:30–19:30",
  nyPm: "NY PM 19:30–22:00",
  afterClose: "Posle zatvaranja 22:00–00:00",
} as const;

/** New York's part of the day, in order; each holds `[from, to)` minutes since 00:00 New York. */
const NEW_YORK: readonly { label: string; from: number; to: number }[] = [
  { label: SESSIONS.nyPreOpen, from: NY_PRE_OPEN, to: NY_OPEN },
  { label: SESSIONS.nyAm, from: NY_OPEN, to: H(11, 30) },
  { label: SESSIONS.lunch, from: H(11, 30), to: H(13, 30) },
  { label: SESSIONS.nyPm, from: H(13, 30), to: H(16) },
  // Up to the 18:00 reopen: the Topstep close (16:10 New York) and the CME break after it.
  { label: SESSIONS.afterClose, from: H(16), to: REOPEN },
];

/** Every session label, in the order of the trading day — the dimension's declared `order`. */
export const SESSION_WINDOWS: readonly string[] = Object.values(SESSIONS);

/** The session an instant falls in, or null when it is unreadable. */
export function sessionWindowOf(iso: string | null | undefined): string | null {
  const ny = zonedMinuteOfDay(iso, SESSION_TZ);
  const london = zonedMinuteOfDay(iso, LONDON_TZ);
  if (ny == null || london == null) return null;
  // From the reopen to New York midnight: Asia, which starts the NEXT CME day.
  if (ny >= REOPEN) return SESSIONS.asia;
  const newYork = NEW_YORK.find((w) => ny >= w.from && ny < w.to);
  if (newYork) return newYork.label;
  // Before 08:00 New York: London once London has opened, else the hours between.
  return london >= LONDON_OPEN ? SESSIONS.london : SESSIONS.preLondon;
}

export type OpenSession = "London" | "NY";

/**
 * Minutes after the open of the session the entry belongs to: London's 08:00
 * (London time) until New York's pre-open, New York's 09:30 from then to the
 * reopen. Null before either open — Asia, the hours before London, New York's
 * pre-open — and for an unreadable instant.
 */
export function afterSessionOpen(iso: string | null | undefined): { session: OpenSession; minutes: number } | null {
  const ny = zonedMinuteOfDay(iso, SESSION_TZ);
  const london = zonedMinuteOfDay(iso, LONDON_TZ);
  if (ny == null || london == null || ny >= REOPEN) return null;
  if (ny >= NY_OPEN) return { session: "NY", minutes: ny - NY_OPEN };
  if (ny < NY_PRE_OPEN && london >= LONDON_OPEN) return { session: "London", minutes: london - LONDON_OPEN };
  return null;
}

/** `afterSessionOpen`'s minutes alone. */
export function minutesAfterOpen(iso: string | null | undefined): number | null {
  return afterSessionOpen(iso)?.minutes ?? null;
}

/** Buckets of "how long after the session's open", in order. */
export const OPEN_OFFSET_BUCKETS = [
  "Pre otvaranja",
  "0–15 min",
  "15–30 min",
  "30–60 min",
  "1–2 h",
  "2 h +",
] as const;

/** How long after its session's open an entry was taken; before London's or New York's open is "Pre otvaranja". */
export function openOffsetBucket(iso: string | null | undefined): (typeof OPEN_OFFSET_BUCKETS)[number] | null {
  if (zonedMinuteOfDay(iso, SESSION_TZ) == null) return null;
  const after = minutesAfterOpen(iso);
  if (after == null) return "Pre otvaranja";
  if (after < 15) return "0–15 min";
  if (after < 30) return "15–30 min";
  if (after < 60) return "30–60 min";
  if (after < 120) return "1–2 h";
  return "2 h +";
}
