/**
 * Which closed trades still lack the two answers the mentor pack is built on:
 * the setup (playbook) and the grade (A/B/C on `execution_rating`).
 *
 * Mostly the trades that reached the journal only through the day's export —
 * the ones not logged right after they closed. The evening reminder in the
 * futures-trading repo (`tools/journal_podsetnik.py`) applies the same rule, on
 * the same day — `dayOf` is the account's day rule, Topstep's 17:00 → 17:00 CT
 * on a Topstep account, which is what the reminder counts; change both or neither.
 */
import { numberFieldValue } from "./field-values";
import type { TradeRow } from "./types";

export type ReviewGap = {
  id: string;
  label: string;
  missing: ("setup" | "grade")[];
};

export function missingReview(row: TradeRow): ("setup" | "grade")[] {
  const out: ("setup" | "grade")[] = [];
  if (!row.playbook_id) out.push("setup");
  if (numberFieldValue(row, "execution_rating") == null) out.push("grade");
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
