/**
 * Which existing trade a statement row is.
 *
 * This used to be buried in a loop inside `import-wizard.tsx` — a 572-line
 * component with a single render test, so the decision that determines whether
 * a trade gets OVERWRITTEN had no test at all. And merging is not a harmless
 * operation: on a merge, `commitImport` calls `tj_replace_executions`, which
 * deletes the existing fills and writes the ones from the statement. Merging
 * into the wrong trade destroys its fills and corrupts somebody else's.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * FOUND: THE AMBIGUITY EXISTED IN THE TYPE, BUT NOT IN THE CODE
 *
 * `ImportItem.match_status` has listed `"ambiguous"` from the start. Nowhere in
 * the project produced that value. The loop `break`s on the FIRST candidate
 * that passes, and candidates arrive ordered by `created_at DESC` — that is, by
 * which trade was ENTERED last, which has nothing to do with the question
 * "which trade is this".
 *
 * The merge window is 10 minutes and a price within `max(0.05 %, 0.01)`. For ES
 * at 5000 that is 2.5 points; for EURUSD at 1.0850 about 5 pips. A scalper who
 * enters ES at 5000.00 and again at 5001.50 six minutes later has TWO trades
 * that both pass the same filter — and the old code would merge the second
 * statement row into the first trade, silently.
 *
 * The fix is NOT a tighter threshold. Any threshold I picked would be invented,
 * and a miss in the other direction (failing to recognise your own trade) only
 * creates a duplicate. The fix is to make the ambiguity VISIBLE: when more than
 * one candidate passes, the row is marked `ambiguous` and defaults to CREATE.
 *
 * The asymmetry is deliberate and worth writing down. A wrong create leaves a
 * spare trade that is deleted in one move. A wrong merge deletes the fills of
 * the trade that was right, and that loss is invisible until somebody looks.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE TIME IS THE BROKER'S, THE TIME TYPED IS THE TYPIST'S
 *
 * `sameTrade` needs both the price and the time to agree, and that is right for
 * a statement arriving the same day. It is useless for the case the journal is
 * actually used in: a trade typed by hand while reading a backtest carries the
 * moment it was TYPED, and the file carries the moment it was TRADED. Months
 * apart, same trade — two positions, and nothing in the journal joins two
 * positions afterwards.
 *
 * So a second, weaker question is asked when the strict one finds nothing:
 * same account, same instrument, same direction, same entry price, same exit
 * price, and then EITHER the same size OR the same money. Time is not consulted
 * at all.
 *
 * Size OR money, rather than both, because the two sources disagree about size
 * more often than they disagree about the trade: TradingView sizes a backtest
 * off its own risk model and the trader types the lots they actually meant, so
 * 1.00 and 1.73 lots can be the same trade — and their P&L then agrees to the
 * cent because both describe the same price move. Requiring both would refuse
 * exactly the case this exists for.
 *
 * The result is `suggested`, not `match`: it is offered with the trade named,
 * and the reader can still create instead. More than one candidate is
 * `ambiguous` here too — and unlike the strict path, an ambiguous row can be
 * pointed at a specific trade in the wizard, because a wrong guess and a
 * deliberate choice are different things.
 */

export type MatchCandidate = {
  id: string;
  instrument: string | null;
  direction: string | null;
  avgEntry: number | null;
  avgExit: number | null;
  openedAt: string | null;
  totalFees: number | null;
  totalSwap: number | null;
  grossPl: number | null;
  netPl: number | null;
  /** The account the trade is filed under; a suggestion never crosses accounts. */
  accountId?: string | null;
  /** Total entry quantity, for the size half of the weaker question. */
  entryQty?: number | null;
  /** The trade's number, so a suggestion can name it on screen. */
  tradeNo?: number | null;
};

/**
 * How far the entry times may differ and still be the same trade.
 *
 * Ten minutes covers the gap between a time the trader wrote down by hand and
 * the execution time on the statement. Narrower would miss manual entries
 * rounded to the hour; wider would start catching the next trade in the same
 * session.
 */
export const MERGE_TIME_WINDOW_MS = 10 * 60 * 1000;

/**
 * How far the entry prices may differ.
 *
 * Relative, because one absolute tolerance cannot hold for both EURUSD at 1.08
 * and ES at 5000. The 0.01 floor exists for low-priced instruments: 0.05 % of
 * 1.0850 is 0.00054, and a one-pip slip is ordinary and does not mean a
 * different trade.
 */
export function mergePriceTolerance(price: number): number {
  return Math.max(0.0005 * Math.abs(price), 0.01);
}

export type ImportRowKey = {
  instrument: string | null;
  direction: string | null;
  entryPrice: number | null;
  /** UTC ISO, or null when the time could not be read. */
  entryTime: string | null;
  /** Total entry quantity as the file states it. */
  entryQty?: number | null;
  /** Size-weighted exit price, or null when the row closes nothing. */
  exitPrice?: number | null;
  /** The row's own result, net of its costs. Null when the file states none. */
  pnl?: number | null;
  /** The account this import is being committed into. */
  accountId?: string | null;
};

export type MatchOutcome = {
  /** The candidate to merge into, or null when creating. */
  matched: MatchCandidate | null;
  /**
   * `match` — time and price agree; this is the same trade.
   * `suggested` — the time does not agree but everything else does (see above).
   * `ambiguous` — more than one candidate, on either path.
   */
  status: "new" | "match" | "suggested" | "ambiguous";
  /** Every candidate that passed the filter — more than one is `ambiguous`. */
  candidates: MatchCandidate[];
};

/**
 * How far two sizes may differ and still be the same size.
 *
 * Relative, and tiny: this is a rounding allowance for a quantity that travelled
 * through a text file, not a tolerance for two different sizes.
 */
function sameSize(a: number | null | undefined, b: number | null | undefined): boolean {
  if (a == null || b == null) return false;
  return Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a));
}

/**
 * How far two results may differ and still be the same result.
 *
 * The floor of 2 currency units carries the rounding in an exported cent and a
 * commission the two sides state differently; 1 % carries the rest. Wider would
 * start matching a different trade on the same instrument.
 */
function sameMoney(a: number | null | undefined, b: number | null | undefined): boolean {
  if (a == null || b == null) return false;
  return Math.abs(a - b) <= Math.max(2, 0.01 * Math.abs(b));
}

/**
 * Whether a candidate and a row describe the same trade when the TIME cannot be
 * used — the hand-typed case above.
 */
function sameTradeIgnoringTime(
  c: MatchCandidate,
  row: ImportRowKey,
  instrumentsMatch: (a: string, b: string) => boolean,
): boolean {
  if (!c.instrument || !row.instrument) return false;
  if (!instrumentsMatch(c.instrument, row.instrument)) return false;
  if ((c.direction ?? "").toLowerCase() !== (row.direction ?? "").toLowerCase()) {
    return false;
  }
  // Never across accounts. Two accounts are two books, and a trade in one is
  // not the same trade as a trade in the other even when every number agrees.
  if (row.accountId != null && c.accountId != null && row.accountId !== c.accountId) {
    return false;
  }
  if (row.entryPrice == null || c.avgEntry == null) return false;
  if (Math.abs(c.avgEntry - row.entryPrice) > mergePriceTolerance(row.entryPrice)) {
    return false;
  }

  // An exit is part of the fingerprint when both sides have one. One side
  // closed and the other still open is not the same trade as far as this can
  // tell, and guessing there would merge a live trade into a finished one.
  const rowClosed = row.exitPrice != null;
  const candidateClosed = c.avgExit != null;
  if (rowClosed !== candidateClosed) return false;
  if (rowClosed && Math.abs(c.avgExit! - row.exitPrice!) > mergePriceTolerance(row.exitPrice!)) {
    return false;
  }

  // Then size OR money. See the header for why it is not both.
  return sameSize(row.entryQty, c.entryQty) || sameMoney(row.pnl, c.netPl ?? c.grossPl);
}

/**
 * Whether a candidate and a statement row can be the same trade.
 *
 * Both conditions, without exception. Time without price would merge two trades
 * opened in the same minute on the same instrument; price without time would
 * merge the same level traded on Monday and on Friday.
 */
function sameTrade(
  c: MatchCandidate,
  row: ImportRowKey,
  instrumentsMatch: (a: string, b: string) => boolean,
): boolean {
  if (!c.instrument || !row.instrument) return false;
  if (!instrumentsMatch(c.instrument, row.instrument)) return false;
  if ((c.direction ?? "").toLowerCase() !== (row.direction ?? "").toLowerCase()) {
    return false;
  }
  if (row.entryTime == null || c.openedAt == null) return false;
  if (row.entryPrice == null || c.avgEntry == null) return false;

  const rowMs = new Date(row.entryTime).getTime();
  const candMs = new Date(c.openedAt).getTime();
  if (!Number.isFinite(rowMs) || !Number.isFinite(candMs)) return false;
  if (Math.abs(candMs - rowMs) >= MERGE_TIME_WINDOW_MS) return false;

  return (
    Math.abs(c.avgEntry - row.entryPrice) <= mergePriceTolerance(row.entryPrice)
  );
}

/**
 * Find the trade a row merges into.
 *
 * `instrumentsMatch` is passed in rather than imported, so the module stays
 * pure and testable with a made-up symbol-matching rule — the real
 * `instrument-aliases` has its own test.
 */
export function matchImportRow(
  row: ImportRowKey,
  candidates: readonly MatchCandidate[],
  instrumentsMatch: (a: string, b: string) => boolean,
): MatchOutcome {
  const hits = candidates.filter((c) => sameTrade(c, row, instrumentsMatch));

  if (hits.length === 1) {
    return { matched: hits[0], status: "match", candidates: hits };
  }
  if (hits.length > 1) {
    // More than one. The "closest" is NOT chosen: a nearer price does not mean
    // it is that trade, and a merge that misses deletes fills. The row is
    // created, and the flag tells a human to look.
    return { matched: null, status: "ambiguous", candidates: hits };
  }

  // Nothing agreed on the time. Ask the weaker question before giving up.
  const suggested = candidates.filter((c) => sameTradeIgnoringTime(c, row, instrumentsMatch));
  if (suggested.length === 1) {
    return { matched: suggested[0], status: "suggested", candidates: suggested };
  }
  if (suggested.length > 1) {
    return { matched: null, status: "ambiguous", candidates: suggested };
  }

  return { matched: null, status: "new", candidates: [] };
}
