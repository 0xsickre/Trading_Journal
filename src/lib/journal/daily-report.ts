import { addDays, format, parseISO, subDays } from "date-fns";
import { DEFAULT_TZ, fmtInTz, isoWeekdayOfDayKey, toEpoch } from "./time";

// `DAY_GRADES`, `MICROMANAGE_*` and `MARKET_TYPE*` lived here. The grade moved
// to the weekly review (rating a day mid-hold reads the P&L), which in turn
// left the journal in phase M, and "did I touch
// it" moved to a per-position check-in, which left with the swing book (H1) — a
// day trader is flat by the close. Market type had no reader at all: nothing
// grouped, scored or surfaced it.

/** The day job that day (phase G, G-2): first shift, second shift, or a day off. */
export const WORK_SHIFTS = ["prva", "druga", "slobodan"] as const;
export type WorkShift = (typeof WORK_SHIFTS)[number];

export const WORK_SHIFT_LABEL: Record<WorkShift, string> = {
  prva: "Prva smena",
  druga: "Druga smena",
  slobodan: "Slobodan",
};

/**
 * One of the day's opportunities, written at the close (phase G, G-1): what the
 * market offered, whether it was a playbook setup, whether I could have taken
 * it, and which one was the easiest of the day. It replaces the missed setup —
 * no entry, stop or target to fill, so it costs a sentence, not a form.
 */
export type Opportunity = {
  note: string;
  in_playbook: boolean;
  could_take: boolean;
  easiest: boolean;
};

/** At most this many a day — the same limit as the column's CHECK. */
export const MAX_OPPORTUNITIES = 3;

export type DailyReport = {
  id: string;
  user_id: string;
  report_date: string;
  /**
   * The 1–5 mental rating. Retired in phase G (G-2): the form no longer asks
   * for it, the days that have one keep it and still show it, read-only.
   */
  mental_temp: number | null;
  /** Sleep quality 0–100 %, before the session (phase G). */
  sleep_quality_pct: number | null;
  /** Hours slept (phase G). */
  sleep_hours: number | null;
  work_shift: WorkShift | null;
  /** A day with the child (phase G). */
  with_child: boolean | null;
  /**
   * When the state (sleep, shift, child) was last written — set by a trigger
   * only (`20261027140000`), like `mental_temp_at`, so the form never sends it.
   */
  state_at: string | null;
  /** What I learned today and change tomorrow, with the fix (phase G). */
  tomorrow_change: string | null;
  /** Up to three opportunities of the day (phase G). */
  opportunities: Opportunity[];
  /**
   * "Danas ne trgujem" — decided before the session. Compliance reads it: on
   * such a day the trade-stage MANUAL rules have nothing to judge
   * (`computeDayCompliance`, phase M).
   */
  no_trade_day: boolean;
  /** The day's emotions, written once on /daily (phase B5); empty = not written. */
  psychology_tags: string[];
  /**
   * When the day's process journal was sealed. Null while it is still editable.
   *
   * Not part of `DailyReportInput`: the lock is set by `tj_lock_day` and by
   * nothing else. Letting it through the form's input type would put it in
   * `emptyDailyReport` and in the save payload, where the zod schema would reject
   * it — and if it ever got through, saving the form would clear the seal.
   */
  locked_at: string | null;
  /**
   * When the mental rating was set or last changed — written by a trigger only
   * (phase Y, `20261014200000`), so the form never sends it. Null without a rating.
   */
  mental_temp_at: string | null;
  created_at: string;
  updated_at: string;
};

export type DailyReportInput = Omit<
  DailyReport,
  "id" | "user_id" | "created_at" | "updated_at" | "locked_at" | "mental_temp" | "mental_temp_at" | "state_at"
>;

/** The state fields of a day, as any reader holds them. */
export type DayState = {
  sleep_quality_pct?: number | null;
  sleep_hours?: number | null;
  work_shift?: string | null;
  with_child?: boolean | null;
};

/** True when any of the state was written. */
export function hasState(r: DayState | null | undefined): boolean {
  return (
    r != null &&
    (r.sleep_quality_pct != null || r.sleep_hours != null || r.work_shift != null || r.with_child != null)
  );
}

function shiftLabel(v: string): string {
  return (WORK_SHIFT_LABEL as Record<string, string>)[v] ?? v;
}

/** "san 80 % · 6.5 h · prva smena · sa detetom" — what was written, in one line; null with nothing written. */
export function stateText(r: DayState | null | undefined): string | null {
  if (!hasState(r)) return null;
  const parts: string[] = [];
  if (r!.sleep_quality_pct != null) parts.push(`san ${r!.sleep_quality_pct} %`);
  if (r!.sleep_hours != null) parts.push(`${Number(r!.sleep_hours)} h`);
  if (r!.work_shift != null) parts.push(shiftLabel(r!.work_shift).toLowerCase());
  if (r!.with_child != null) parts.push(r!.with_child ? "sa detetom" : "bez deteta");
  return parts.join(" · ");
}

/**
 * Below these the day calls for a smaller risk (trader, 27.10.2026): sleep
 * quality under 80 %, or under 7 hours slept. A warning, not a rule — the
 * tracker does not score it.
 */
export const LOW_SLEEP = { qualityPct: 80, hours: 7 } as const;

/** What was short about the night, in words; empty when nothing was, or nothing was written. */
export function lowSleepReasons(r: DayState | null | undefined): string[] {
  if (!r) return [];
  const out: string[] = [];
  if (r.sleep_quality_pct != null && r.sleep_quality_pct < LOW_SLEEP.qualityPct)
    out.push(`kvalitet sna ${r.sleep_quality_pct} % (ispod ${LOW_SLEEP.qualityPct} %)`);
  // numeric(3,1) can arrive from PostgREST as a string.
  const h = r.sleep_hours == null ? NaN : Number(r.sleep_hours);
  if (Number.isFinite(h) && h < LOW_SLEEP.hours) out.push(`${h} h sna (ispod ${LOW_SLEEP.hours} h)`);
  return out;
}

/**
 * The pre-session gate's timestamp: the state's when the state was written,
 * else the retired rating's on a day that has one (history), else none.
 */
export function gateWrittenAt(
  r: (DayState & { state_at?: string | null; mental_temp?: number | null; mental_temp_at?: string | null }) | null | undefined,
): string | null {
  if (!r) return null;
  if (hasState(r)) return r.state_at ?? null;
  if (r.mental_temp != null) return r.mental_temp_at ?? null;
  return null;
}

/**
 * Report buckets. The bands are a reading aid, not a rule: three per measure,
 * so a month of days still fills each one.
 */
export const SLEEP_QUALITY_BUCKETS = ["< 60 %", "60–79 %", "80 %+"] as const;
export const SLEEP_HOURS_BUCKETS = ["< 6 h", "6–6.9 h", "7 h +"] as const;

export function sleepQualityBucket(pct: number | null | undefined): string | null {
  if (pct == null || !Number.isFinite(pct) || pct < 0 || pct > 100) return null;
  return pct < 60 ? SLEEP_QUALITY_BUCKETS[0] : pct < 80 ? SLEEP_QUALITY_BUCKETS[1] : SLEEP_QUALITY_BUCKETS[2];
}

export function sleepHoursBucket(h: number | string | null | undefined): string | null {
  // numeric(3,1) can arrive as a string from PostgREST.
  const n = h == null ? NaN : Number(h);
  if (!Number.isFinite(n) || n < 0 || n > 24) return null;
  return n < 6 ? SLEEP_HOURS_BUCKETS[0] : n < 7 ? SLEEP_HOURS_BUCKETS[1] : SLEEP_HOURS_BUCKETS[2];
}

/**
 * The stored opportunities, read defensively: the column is jsonb, so a row
 * written by hand or by an older client could hold anything. What is not an
 * object with a note is dropped, never shown as "undefined".
 */
export function opportunitiesOf(raw: unknown): Opportunity[] {
  if (!Array.isArray(raw)) return [];
  const out: Opportunity[] = [];
  for (const o of raw) {
    if (o == null || typeof o !== "object") continue;
    const rec = o as Record<string, unknown>;
    const note = typeof rec.note === "string" ? rec.note.trim() : "";
    if (!note) continue;
    out.push({
      note,
      in_playbook: rec.in_playbook === true,
      could_take: rec.could_take === true,
      easiest: rec.easiest === true,
    });
  }
  return out.slice(0, MAX_OPPORTUNITIES);
}

/** One opportunity as a line: "note (u playbook-u, mogao sam, najlakša)". */
export function opportunityText(o: Opportunity): string {
  const marks = [
    o.in_playbook ? "u playbook-u" : "van playbook-a",
    o.could_take ? "mogao sam" : "nisam mogao",
    o.easiest ? "najlakša" : null,
  ].filter(Boolean);
  return `${o.note} (${marks.join(", ")})`;
}

/**
 * The pre-session gate written after the day's first entry (phase Y, Y-3 = A):
 * "upisano 14.10. 11:15, posle prvog ulaza (09:24)", in Belgrade time. Null when
 * it came first, when the day has no entry, or when either time is unknown — a
 * mark, never a verdict; the tracker does not read it.
 */
export function gateLateText(
  mentalTempAt: string | null | undefined,
  firstEntryAt: string | null | undefined,
  tz: string = DEFAULT_TZ,
): string | null {
  if (!mentalTempAt || !firstEntryAt) return null;
  const at = toEpoch(mentalTempAt);
  const entry = toEpoch(firstEntryAt);
  if (!Number.isFinite(at) || !Number.isFinite(entry) || at <= entry) return null;
  return `upisano ${fmtInTz(mentalTempAt, tz, "dd.MM. HH:mm")}, posle prvog ulaza (${fmtInTz(firstEntryAt, tz, "HH:mm")})`;
}

function formatDate(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

export function prevReportDate(date: string): string {
  return formatDate(subDays(parseISO(date), 1));
}

export function nextReportDate(date: string): string {
  return formatDate(addDays(parseISO(date), 1));
}

/**
 * Friday, in ISO numbering (1 = Monday … 5 = Friday).
 *
 * This used to be `parseISO(date).getDay() === 5`. That WAS correct —
 * `parseISO` on a date string gives local midnight, so reading it in local time
 * was consistent — but it required the reader to know that, and `time.ts`
 * carried a warning around it not to copy the pattern. Now there is nothing not
 * to copy: the same `isoWeekdayOfDayKey` the tracker rules and the weekday
 * dimension use.
 */
export function isFriday(date: string): boolean {
  return isoWeekdayOfDayKey(date) === 5;
}

export function emptyDailyReport(reportDate: string): DailyReportInput {
  return {
    report_date: reportDate,
    sleep_quality_pct: null,
    sleep_hours: null,
    work_shift: null,
    with_child: null,
    tomorrow_change: null,
    opportunities: [],
    no_trade_day: false,
    psychology_tags: [],
  };
}
