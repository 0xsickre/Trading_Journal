/**
 * Merging two trades that are the same trade.
 *
 * The import can now recognise a hand-typed trade and merge into it
 * (`import-match.ts`), but that only helps at import time. Two rows that are
 * already in the journal — one typed, one imported before the matcher could see
 * it — had no way to become one, and the journal counted them twice in every
 * total it prints.
 *
 * WHAT A MERGE IS, IN ONE LINE
 *
 * One trade keeps its identity and its judgement; the other supplies the fills.
 * Everything the survivor has no answer for is filled in from the one going
 * away, and then that one is deleted.
 *
 * WHY THE FILLS ARE TAKEN WHOLE, NOT COMBINED
 *
 * Because the two rows describe the SAME trade, not two halves of one. Adding
 * their fills together would double the size and invent a P&L nobody traded. So
 * one side's fills win outright, and the dialog says which.
 *
 * This module decides; `tj_merge_positions` carries the decision out. The list
 * of fields filled in from the other trade lives here and is asserted against
 * that function in `merge-positions.test.ts`, so the two cannot drift into two
 * answers to one question.
 */

export type MergeSide = {
  id: string;
  tradeNo: number | null;
  instrument: string | null;
  direction: string | null;
  accountId: string | null;
  /** 'manual' | 'import' — which one the fills default to coming from. */
  source: string | null;
  createdAt: string | null;
  openedAt: string | null;
  avgEntry: number | null;
  avgExit: number | null;
  entryQty: number | null;
  netPl: number | null;
};

/**
 * Columns the survivor fills in from the other trade when it has none of its
 * own. Plan and judgement: never overwritten, only completed.
 *
 * `entry_price` is the PLANNED entry, not the fill — the fills travel as rows in
 * `tj_executions` and are not on this list.
 */
export const MERGE_COALESCE_COLUMNS = [
  "entry_price",
  "stop_price",
  "target_price",
  "risk_pct",
  "planned_rr",
  "position_size",
  "setup_grade",
  "conviction",
  "execution_rating",
  "exit_reason",
  "thesis",
  "invalidation",
  "time_stop_days",
  "scale_out_plan",
  "trade_journal_notes",
  "playbook_id",
  "miss_reason",
  "missed_at",
  "max_drawdown_price",
  "max_profit_price",
] as const;

/** Tag columns merged as a union — two lists of tags about one trade are one list. */
export const MERGE_UNION_COLUMNS = [
  "mistake",
  "technical_tags",
  "psychology_tags",
] as const;

export type MergeRefusal = string;

/**
 * Why these two cannot be merged, or `null` when they can.
 *
 * Refusals, not warnings. A merge deletes one of the two rows, and every
 * condition here describes a case where the deletion would destroy a trade that
 * genuinely happened.
 */
export function mergeRefusal(a: MergeSide, b: MergeSide): MergeRefusal | null {
  if (a.id === b.id) return "A trade cannot be merged into itself.";
  if ((a.instrument ?? "") !== (b.instrument ?? "")) {
    return `Different instruments (${a.instrument ?? "—"} and ${b.instrument ?? "—"}) are not one trade.`;
  }
  if ((a.direction ?? "").toLowerCase() !== (b.direction ?? "").toLowerCase()) {
    return "A long and a short are not one trade.";
  }
  if (a.accountId !== b.accountId) {
    return "These trades are on two different accounts.";
  }
  return null;
}

export type MergeChoice = {
  /** Keeps its id, number, grade, plan and notes. */
  keepId: string;
  /** Supplies the fills, the money and the instrument snapshot. */
  fillsFromId: string;
};

/**
 * Which side keeps its identity, by default.
 *
 * The fills come from the IMPORTED trade, because an import carries the
 * broker's or the tester's own numbers, while a typed trade carries what the
 * trader remembered. The typed one keeps its identity for the mirror reason: it
 * holds the grade, the thesis and the plan, and an import never writes those.
 *
 * With both sides the same kind there is nothing to prefer, so the newer one is
 * treated as the correction: it was entered knowing the older one existed.
 */
export function defaultMergeChoice(a: MergeSide, b: MergeSide): MergeChoice {
  const aImported = a.source === "import";
  const bImported = b.source === "import";
  if (aImported !== bImported) {
    const imported = aImported ? a : b;
    const typed = aImported ? b : a;
    return { keepId: typed.id, fillsFromId: imported.id };
  }
  const [older, newer] =
    (a.createdAt ?? "") <= (b.createdAt ?? "") ? [a, b] : [b, a];
  return { keepId: older.id, fillsFromId: newer.id };
}

/** How a trade is named in the dialog: its number, when it opened, its prices. */
export function describeSide(side: MergeSide, fmtTime: (iso: string) => string): string {
  const parts = [side.tradeNo != null ? `#${side.tradeNo}` : "a trade"];
  if (side.openedAt) parts.push(fmtTime(side.openedAt));
  if (side.avgEntry != null) {
    parts.push(
      side.avgExit != null
        ? `${side.avgEntry}→${side.avgExit}`
        : String(side.avgEntry),
    );
  }
  if (side.entryQty != null) parts.push(`${side.entryQty} lots`);
  return parts.join(" · ");
}
