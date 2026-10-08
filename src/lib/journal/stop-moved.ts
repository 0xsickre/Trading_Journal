/**
 * Was the stop moved during the trade? (phase O, 08.10.2026)
 *
 * TopstepX's orders export keeps a stop order's LAST price only — the trader's
 * test on 08.10.2026 left one row at the entry for a stop placed lower and
 * moved to breakeven. `final_stop_price` is that last price. It is the original
 * stop exactly when the stop was never moved, and two things prove it was:
 *
 *   - `moved_be`: the last stop sits at the entry or in profit — breakeven or a
 *     trailing stop. No trader opens a position with its stop there.
 *   - `moved_mae`: the price went further against the trade than the last stop
 *     (MAE, measured from the exchange's candles), and the trade was not stopped
 *     out — so at that moment the stop was somewhere else. Trade #1 of
 *     07.10.2026: last stop 31227.5, MAE 31206.5, closed at its target.
 *
 * Anything else is `unchanged` as far as the file can tell, and `unknown` when
 * there is no last stop to read. A stop moved TIGHTER and never tested is
 * invisible to both; the recording is the only witness to that.
 */
import { numberFieldValue } from "./field-values";
import type { TradeRow } from "./types";

export type StopStatus = "unchanged" | "moved_be" | "moved_mae" | "unknown";

/** Exit reasons that mean the stop order closed the trade. */
const STOP_EXITS = new Set(["Pogođen stop", "Prateći stop"]);

export function stopStatus(row: TradeRow): StopStatus {
  const last = numberFieldValue(row, "final_stop_price");
  const entry = row.stats?.avg_entry ?? null;
  if (last == null || entry == null) return "unknown";
  const dir = String(row.direction ?? "").toLowerCase().startsWith("short") ? -1 : 1;
  if (dir * (last - entry) >= 0) return "moved_be";
  const mae = numberFieldValue(row, "max_drawdown_price");
  const stopped = STOP_EXITS.has(String(row.exit_reason ?? ""));
  if (mae != null && !stopped && dir * (mae - last) < 0) return "moved_mae";
  return "unchanged";
}

/**
 * The stop was moved and the trade still carries no original: either none at
 * all, or the last price standing in for it. The recording has to supply it.
 */
export function needsOriginalStop(row: TradeRow): boolean {
  const s = stopStatus(row);
  if (s !== "moved_be" && s !== "moved_mae") return false;
  const stop = numberFieldValue(row, "stop_price");
  return stop == null || stop === numberFieldValue(row, "final_stop_price");
}
