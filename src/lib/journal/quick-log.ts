/**
 * Logging a trade AFTER it is closed — the day trader's way in.
 *
 * The full form is built for a plan written before the entry. A day trader who
 * works a limit near price has no time for that: screenshot, thesis and
 * checklist before the order means the fill happens while nobody is watching.
 * So the order goes in with its bracket, and the journal gets the trade once it
 * is flat — four numbers off the platform and the three answers only the
 * trader has: which setup, was it by plan, and what went wrong.
 *
 * The numbers may be rough. The day's TopstepX export matches this trade
 * (`import-match.ts`: entry within 0.05 %, entry time within ten minutes) and
 * replaces the fills with the exact ones; notes, setup and grade stay.
 *
 * Pure: the form, its tests and the review page share it.
 */
import { commissionPerSide } from "./instrument-costs";
import type { Instrument } from "./types";

/** "Entered N minutes ago" chips — a trade is logged right after it closes. */
export const QUICK_ENTRY_AGO_MIN = [2, 5, 15, 30] as const;

/**
 * Was it by plan — A, B or C — kept on the existing 1–5 `execution_rating`
 * scale so every report that reads the rating reads these too.
 *
 *   A  by plan (entry, stop, size, exit as written)       5
 *   B  small deviations                                   3
 *   C  a rule broken                                      1
 */
export const GRADES = ["A", "B", "C"] as const;
export type Grade = (typeof GRADES)[number];
export const GRADE_RATING: Record<Grade, number> = { A: 5, B: 3, C: 1 };

export function gradeFromRating(rating: number | null | undefined): Grade | null {
  if (rating == null || !Number.isFinite(rating) || rating < 1) return null;
  if (rating >= 5) return "A";
  if (rating >= 3) return "B";
  return "C";
}

/** The mistake list's own "nothing went wrong" item, recorded on an A so a clean trade is counted as one. */
export const NO_MISTAKE = "Bez greške";

export type QuickLogInput = {
  accountId: string | null;
  instrument: Pick<Instrument, "symbol" | "point_value" | "tick_size" | "commission_per_lot" | "commission_pct"> | null;
  direction: "Long" | "Short";
  contracts: number | null;
  entry: number | null;
  stop: number | null;
  target: number | null;
  exit: number | null;
  /** UTC ISO. */
  enteredAt: string | null;
  exitedAt: string | null;
  playbookId: string | null;
  grade: Grade | null;
  mistakes: string[];
  emotions: string[];
  note: string;
  snapshotUrl: string;
};

/**
 * What stops the save — a sentence, or null. Only what makes the record wrong:
 * a missing stop is a warning (`quickLogWarnings`), not a refusal, because a
 * trade without one still happened.
 */
export function quickLogProblem(q: QuickLogInput): string | null {
  if (!q.instrument) return "Pick an instrument.";
  if (q.contracts == null || !(q.contracts > 0) || !Number.isInteger(q.contracts)) {
    return "Contracts must be a whole number above zero.";
  }
  if (q.entry == null || !(q.entry > 0)) return "Entry price is missing.";
  if (q.exit == null || !(q.exit > 0)) return "Exit price is missing.";
  if (!q.enteredAt || !Number.isFinite(Date.parse(q.enteredAt))) return "Entry time is missing.";
  if (!q.exitedAt || !Number.isFinite(Date.parse(q.exitedAt))) return "Exit time is missing.";
  if (Date.parse(q.enteredAt) > Date.parse(q.exitedAt)) return "The entry time is after the exit time.";
  if (q.stop != null && q.stop > 0 && q.stop !== q.entry) {
    const stopSide = q.stop < q.entry ? "Long" : "Short";
    if (stopSide !== q.direction) {
      return `A ${q.direction.toLowerCase()} has its stop ${q.direction === "Long" ? "below" : "above"} the entry.`;
    }
  }
  if (q.target != null && q.target > 0 && q.target !== q.entry) {
    const targetSide = q.target > q.entry ? "Long" : "Short";
    if (targetSide !== q.direction) {
      return `A ${q.direction.toLowerCase()} has its target ${q.direction === "Long" ? "above" : "below"} the entry.`;
    }
  }
  return null;
}

/** What the trader should know but may still save. */
export function quickLogWarnings(q: QuickLogInput): string[] {
  const out: string[] = [];
  if (q.stop == null || !(q.stop > 0)) out.push("No stop — the trade gets no R, and R is what the review measures.");
  if (!q.playbookId) out.push("No setup — this trade will not count toward any setup's numbers.");
  if (!q.grade) out.push("No grade — was it by plan?");
  return out;
}

/**
 * Why the trade ended, read off the prices. The stop is hit when the exit is AT
 * OR PAST it on the losing side (or within two ticks short of it): a stop-market
 * order in a fast NQ tape fills several ticks through the stop, and that is a
 * stop, not a hand close. The target likewise at or past it, or within two
 * ticks; the entry within two ticks is break-even; anything else was closed by
 * hand. Returned only when the trader's own exit-reason list has that item, so
 * a renamed list is never written a value it does not offer.
 */
export function autoExitReason(params: {
  direction: string | null;
  entry: number | null;
  exit: number | null;
  stop: number | null;
  target: number | null;
  tickSize: number | null;
  options: readonly string[];
}): string | null {
  const { entry, exit, stop, target, options } = params;
  if (entry == null || exit == null) return null;
  const tol = 2 * (params.tickSize && params.tickSize > 0 ? params.tickSize : 0);
  const near = (a: number | null) => a != null && a > 0 && Math.abs(exit - a) <= tol + 1e-9;
  // +1 long, −1 short: the direction as written, else the side the stop is on.
  const dir = params.direction
    ? params.direction.toLowerCase().startsWith("short")
      ? -1
      : 1
    : stop != null && stop > entry
      ? -1
      : 1;
  const set = (a: number | null): a is number => a != null && a > 0;
  const pastStop = set(stop) && dir * (exit - stop) <= tol + 1e-9;
  const pastTarget = set(target) && dir * (exit - target) >= -tol - 1e-9;
  const pick = (v: string) => (options.includes(v) ? v : null);
  // The seeded exit reasons, in Serbian since K2 (`20260929200000`).
  if (pastStop) return pick("Pogođen stop");
  if (pastTarget) return pick("Pogođen target");
  if (near(entry)) return pick("Na nuli");
  return pick("Zatvoreno ranije");
}

/** Entry time N minutes before `now`, as UTC ISO. */
export function minutesAgo(n: number, now: Date = new Date()): string {
  return new Date(now.getTime() - n * 60_000).toISOString();
}

/**
 * The quick log as `createTrade` takes it: one entry fill and one exit fill,
 * with the commission prefilled as the full form does, and the plan columns set
 * so the trade is sealed with its stop and gets an R.
 */
export function quickLogToTradeInput(q: QuickLogInput, exitReasonOptions: readonly string[]) {
  const qty = q.contracts ?? 0;
  const fee = (price: number) => (q.instrument ? commissionPerSide(q.instrument, qty, price) : 0);
  const stop = q.stop != null && q.stop > 0 ? q.stop : null;
  const target = q.target != null && q.target > 0 ? q.target : null;
  const grade = q.grade;
  const mistakes = q.mistakes;
  const exitReason = autoExitReason({
    direction: q.direction,
    entry: q.entry,
    exit: q.exit,
    stop,
    target,
    tickSize: q.instrument?.tick_size ?? null,
    options: exitReasonOptions,
  });
  const fields: Record<string, string | number | string[] | null> = {
    instrument: q.instrument?.symbol ?? null,
    direction: q.direction,
    entry_price: q.entry,
    stop_price: stop,
    target_price: target,
    execution_rating: grade ? GRADE_RATING[grade] : null,
    trade_journal_notes: q.note.trim() || null,
  };
  if (mistakes.length) fields.mistake = mistakes;
  if (q.emotions.length) fields.psychology_tags = q.emotions;
  if (exitReason) fields.exit_reason = exitReason;
  const snapshot = q.snapshotUrl.trim();
  return {
    account_id: q.accountId,
    trade_no: null,
    fields,
    executions: [
      {
        side: "entry" as const,
        price: q.entry as number,
        qty,
        executed_at: q.enteredAt as string,
        fee: fee(q.entry as number),
        source: "manual" as const,
      },
      {
        side: "exit" as const,
        price: q.exit as number,
        qty,
        executed_at: q.exitedAt as string,
        fee: fee(q.exit as number),
        source: "manual" as const,
      },
    ],
    trade_phase: "active" as const,
    current_status: null,
    // The record of a trade that already closed: a blown account lets it through.
    origin: "log" as const,
    playbook_id: q.playbookId,
    images: snapshot ? [{ kind: "ltf_post", image_url: snapshot }] : [],
  };
}
