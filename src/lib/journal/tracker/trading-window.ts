import type { TrackerRule } from "../tracker-types";

/**
 * The trader's trading window (phase Y4, 15.10.2026): the hours, on the
 * trader's clock (Belgrade), in which every entry and exit of a day belongs.
 *
 * The window changes with the weekly shift — London 09:00–12:00, NY
 * 14:30–18:00 — so the rule keeps every window with the day it took effect
 * (decision Y-6 = A). A day reads the window with the latest `since` on or
 * before it, and changing the window next Monday leaves this week as it was.
 */
export type TradingWindow = {
  /** First day (YYYY-MM-DD) the window applies to. */
  since: string;
  /** "HH:MM", Belgrade. */
  from: string;
  /** "HH:MM", Belgrade; an exit within this minute is the time exit, not a breach. */
  to: string;
};

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Minutes after midnight of an "HH:MM". */
export const minutesOf = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/** A valid window: both times well-formed and `from` before `to`. */
export function isValidWindow(w: { from: string; to: string }): boolean {
  return TIME_RE.test(w.from) && TIME_RE.test(w.to) && minutesOf(w.from) < minutesOf(w.to);
}

/** The windows a rule's config holds, well-formed ones only, oldest first. */
export function windowsOf(config: Record<string, unknown> | null | undefined): TradingWindow[] {
  const raw = config?.windows;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (w): w is TradingWindow =>
        w != null &&
        typeof w === "object" &&
        typeof w.since === "string" &&
        DAY_RE.test(w.since) &&
        typeof w.from === "string" &&
        typeof w.to === "string" &&
        isValidWindow(w),
    )
    .map((w) => ({ since: w.since, from: w.from, to: w.to }))
    .sort((a, b) => a.since.localeCompare(b.since));
}

/** The window in force on `day`, or null before the first one. */
export function windowOn(windows: readonly TradingWindow[], day: string): TradingWindow | null {
  let hit: TradingWindow | null = null;
  for (const w of windows) if (w.since <= day) hit = w;
  return hit;
}

/**
 * Day → window, from the rule set: the `trading_window` rule still live, else
 * the most recently retired one — a retired rule still graded its own days.
 */
export function tradingWindowResolver(rules: readonly TrackerRule[]): (day: string) => TradingWindow | null {
  const own = rules.filter((r) => r.auto_key === "trading_window");
  const rule = own.find((r) => r.deleted_at == null) ?? own[own.length - 1];
  const windows = windowsOf(rule?.config);
  return (day) => windowOn(windows, day);
}

/**
 * The windows after setting one from `since`: an entry for the same day is
 * replaced, every other one kept.
 */
export function withWindow(windows: readonly TradingWindow[], next: TradingWindow): TradingWindow[] {
  return [...windows.filter((w) => w.since !== next.since), next].sort((a, b) => a.since.localeCompare(b.since));
}
