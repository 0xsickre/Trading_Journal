/**
 * Who wrote the MAE/MFE after this save.
 *
 * A value the trader typed or changed is theirs — 'manual' — and the MT5 fill
 * never writes over it (`scripts/mt5_excursion.py`). Clearing both hands the
 * trade back to the MT5 fill. A save that did not touch them says nothing, so
 * an MT5 value survives an edit of the thesis.
 */
export function excursionSourcePatch(
  columns: Record<string, unknown>,
  prev: { max_drawdown_price: number | null; max_profit_price: number | null } | null,
): { excursion_source?: "manual" | null } {
  if (!("max_drawdown_price" in columns) && !("max_profit_price" in columns)) return {};
  const num = (v: unknown) => (v == null || v === "" ? null : Number(v));
  const mae = num(columns.max_drawdown_price);
  const mfe = num(columns.max_profit_price);
  if (prev && mae === num(prev.max_drawdown_price) && mfe === num(prev.max_profit_price)) {
    return {};
  }
  return mae == null && mfe == null ? { excursion_source: null } : { excursion_source: "manual" };
}
