/**
 * Phase TR: was a trade opened through the Terminal panel in NinjaTrader?
 *
 * The NinjaTrader sync writes the name of each trade's entry order onto the
 * position (`tj_positions.platform_entry_name`). The Terminal panel names its
 * entry orders "RP Ulaz <id>" and logs every entry under that same id, with
 * the plan, the gates and the context of the moment; the analysis joins the
 * two by it. Any other name — Chart Trader, SuperDOM, none — means the trade
 * was taken outside the panel and has no such row. A trade the sync never
 * named (manual, a CSV import, synced before phase TR) says nothing either way.
 */
const TERMINAL_ENTRY_PREFIX = "RP Ulaz";

export type TerminalOrigin = { kind: "terminal"; id: string } | { kind: "van" } | null;

export function terminalOrigin(entryName: string | null | undefined): TerminalOrigin {
  if (entryName == null) return null;
  return entryName.startsWith(TERMINAL_ENTRY_PREFIX) ? { kind: "terminal", id: entryName } : { kind: "van" };
}
