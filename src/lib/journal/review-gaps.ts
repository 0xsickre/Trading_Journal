/**
 * Which closed trades still lack what the mentor pack is built on: the setup
 * (playbook), the grade (A/B/C on `execution_rating`) and, since phase O, a stop
 * — without one the trade has no R — or the ORIGINAL stop when the orders file
 * shows the stop was moved (`stop-moved.ts`) and only its last price is known.
 *
 * Mostly the trades that reached the journal only through the day's export —
 * the ones not logged right after they closed. The evening reminder in the
 * futures-trading repo (`tools/journal_podsetnik.py`) applies the same rule, on
 * the same day — `dayOf` is the account's day rule, Topstep's 17:00 → 17:00 CT
 * on a Topstep account, which is what the reminder counts; change both or neither.
 */
import { numberFieldValue } from "./field-values";
import { sealedNumber } from "./plan-snapshot";
import { needsOriginalStop } from "./stop-moved";
import type { TradeRow } from "./types";

export type ReviewMissing = "setup" | "grade" | "stop" | "original_stop";

export type ReviewGap = {
  id: string;
  label: string;
  missing: ReviewMissing[];
};

export function missingReview(row: TradeRow): ReviewMissing[] {
  const out: ReviewMissing[] = [];
  if (!row.playbook_id) out.push("setup");
  if (numberFieldValue(row, "execution_rating") == null) out.push("grade");
  // The stop every R is measured from: the sealed one where the seal holds it.
  if (sealedNumber(row, "stop_price") == null) out.push("stop");
  else if (needsOriginalStop(row)) out.push("original_stop");
  return out;
}

/** Closed trades of `day` (by `dayOf`) with something missing, in the order they closed. */
export function reviewGaps(trades: TradeRow[], day: string, dayOf: (t: TradeRow) => string): ReviewGap[] {
  return trades
    .filter((t) => t.status === "closed" && t.stats?.closed_at && dayOf(t) === day)
    .sort((a, b) => String(a.stats?.closed_at).localeCompare(String(b.stats?.closed_at)))
    .flatMap((t) => {
      const missing = missingReview(t);
      if (missing.length === 0) return [];
      const instrument = typeof t.instrument === "string" ? ` ${t.instrument}` : "";
      return [{ id: t.id, label: `${t.trade_no != null ? `#${t.trade_no}` : t.id.slice(0, 8)}${instrument}`, missing }];
    });
}
