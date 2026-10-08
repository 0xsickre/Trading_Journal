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
 * replaces the fills with the exact ones; notes, setup and grade stay. A trade
 * logged while still running has no exit yet: it is saved open, and the same
 * match adds the exit and closes it.
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
  /** Chart pictures, in the order added (the "+" list); blanks are dropped. */
  images: string[];
};

/** No exit price: the trade is still running and is saved open. */
export function isOpenLog(q: Pick<QuickLogInput, "exit">): boolean {
  return q.exit == null;
}

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
  if (!q.enteredAt || !Number.isFinite(Date.parse(q.enteredAt))) return "Entry time is missing.";
  // No exit price is a trade still running: it is saved open, and the day's
  // TopstepX export adds the exit fills and closes it.
  if (!isOpenLog(q)) {
    if (!(q.exit! > 0)) return "Exit price must be above zero.";
    if (!q.exitedAt || !Number.isFinite(Date.parse(q.exitedAt))) return "Exit time is missing.";
    if (Date.parse(q.enteredAt) > Date.parse(q.exitedAt)) return "The entry time is after the exit time.";
  }
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

/**
 * Why the trade ended, read off TopstepX's orders (phase O): the stop order
 * filled is a stop — a trailing one when that stop had been moved to the entry
 * or into profit — the target order filled is the target, and anything else was
 * closed by hand, then named off the prices as `autoExitReason` names it.
 */
export function exitReasonFromBracket(params: {
  exitKind: "stop" | "target" | "manual";
  stopMovedToProfit: boolean;
  direction: string | null;
  entry: number | null;
  exit: number | null;
  tickSize: number | null;
  options: readonly string[];
}): string | null {
  const pick = (v: string) => (params.options.includes(v) ? v : null);
  if (params.exitKind === "stop") return params.stopMovedToProfit ? pick("Prateći stop") : pick("Pogođen stop");
  if (params.exitKind === "target") return pick("Pogođen target");
  return autoExitReason({
    direction: params.direction,
    entry: params.entry,
    exit: params.exit,
    stop: null,
    target: null,
    tickSize: params.tickSize,
    options: params.options,
  });
}

/**
 * The exit reason an import writes when its fills close a trade that has none —
 * a trade logged while it was still running got no reason, because there was no
 * exit to read it from. Null when the trade already has one (the trader's word
 * stands), when the fills do not close it, or when the list has no fitting item.
 */
export function exitReasonAfterMerge(params: {
  current: string | null;
  fills: readonly { side: "entry" | "exit"; price: number; qty: number }[];
  direction: string | null;
  stop: number | null;
  target: number | null;
  tickSize: number | null;
  options: readonly string[];
}): string | null {
  if (params.current) return null;
  const avg = (side: "entry" | "exit") => {
    const f = params.fills.filter((x) => x.side === side && x.qty > 0);
    const qty = f.reduce((s, x) => s + x.qty, 0);
    return { qty, price: qty > 0 ? f.reduce((s, x) => s + x.price * x.qty, 0) / qty : null };
  };
  const entry = avg("entry");
  const exit = avg("exit");
  // Closed means every contract out; a partial exit is not an exit reason yet.
  if (entry.price == null || exit.price == null || exit.qty < entry.qty) return null;
  return autoExitReason({
    direction: params.direction,
    entry: entry.price,
    exit: exit.price,
    stop: params.stop,
    target: params.target,
    tickSize: params.tickSize,
    options: params.options,
  });
}

/** Entry time N minutes before `now`, as UTC ISO. */
export function minutesAgo(n: number, now: Date = new Date()): string {
  return new Date(now.getTime() - n * 60_000).toISOString();
}

/**
 * The quick log as `createTrade` takes it: one entry fill and one exit fill
 * (only the entry while the trade is still running),
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
      // No exit yet: one entry fill, and the trade is open until the export
      // (or an edit) adds the exit.
      ...(isOpenLog(q)
        ? []
        : [
            {
              side: "exit" as const,
              price: q.exit as number,
              qty,
              executed_at: q.exitedAt as string,
              fee: fee(q.exit as number),
              source: "manual" as const,
            },
          ]),
    ],
    trade_phase: "active" as const,
    current_status: null,
    // A record: a blown account lets a closed trade through. One still open is
    // exposure, and `createTrade` refuses it there like any plan.
    origin: "log" as const,
    playbook_id: q.playbookId,
    images: q.images.map((i) => i.trim()).filter(Boolean),
  };
}
