import "server-only";
import { createClient } from "@/lib/supabase/server";
import { selectAllByIds, selectAllPages } from "@/lib/supabase/paginate";
import type { Instrument } from "./types";

/** The contract spec snapshotted onto a position when it is written. */
export type InstrumentSpec = {
  point_value: number | null;
  tick_size: number | null;
};

const INSTRUMENT_COLUMNS =
  "id,symbol,name,asset_class,point_value,tick_size,tick_value,currency,is_active,sort_order";

export async function getInstruments(
  activeOnly = false,
): Promise<Instrument[]> {
  const supabase = await createClient();
  // Deliberately unfiltered by symbol. This used to restrict results to
  // DEFAULT_INSTRUMENT_SYMBOLS, which made every instrument added through
  // Settings invisible — including in the Settings list that created it — and
  // left trades on those symbols with no point value to price them.
  let query = supabase
    .from("tj_instruments")
    .select(INSTRUMENT_COLUMNS)
    .order("sort_order")
    .order("symbol");
  if (activeOnly) query = query.eq("is_active", true);
  const { data } = await query;
  return (data ?? []) as Instrument[];
}

/**
 * Symbol -> contract spec, for stamping `point_value_at_trade` onto a position.
 *
 * The stats view prefers that snapshot over the live instrument row, so editing
 * or deleting an instrument can no longer rewrite the P&L of trades already
 * taken on it. Pass the symbols being written; omit to fetch the whole table.
 */
export async function getInstrumentSpecs(
  symbols?: (string | null | undefined)[],
): Promise<Map<string, InstrumentSpec>> {
  const wanted = [...new Set((symbols ?? []).filter((s): s is string => !!s))];
  if (symbols != null && wanted.length === 0) return new Map();

  const supabase = await createClient();
  type Row = InstrumentSpec & { symbol: string };
  const select = "symbol,point_value,tick_size";

  // Both paths drain: an `.in()` filter is spelled into the URL and PostgREST
  // caps the URL's length, while an unfiltered read is capped at `db-max-rows`
  // and comes back truncated with HTTP 200 and no error. `commitImport` passes
  // one symbol per imported row, so a wide multi-symbol import is exactly the
  // case that reached the first cap — and a missing spec means the trade is
  // stamped with no point value and every money column on it turns null.
  const data =
    wanted.length > 0
      ? await selectAllByIds<Row, string>(wanted, (chunk, from, to) =>
          supabase
            .from("tj_instruments")
            .select(select)
            .in("symbol", chunk)
            .order("symbol")
            .range(from, to),
        )
      : await selectAllPages<Row>((from, to) =>
          supabase
            .from("tj_instruments")
            .select(select)
            .order("symbol")
            .range(from, to),
        );

  const map = new Map<string, InstrumentSpec>();
  for (const row of data) {
    map.set(row.symbol, {
      point_value: row.point_value,
      tick_size: row.tick_size,
    });
  }
  return map;
}

/**
 * Snapshot columns for a position on the given symbol.
 *
 * Returns nulls when the symbol resolves to nothing — the view then reports
 * `point_value_source = 'missing'` and leaves the money columns null, which is
 * the honest answer. It must never fall back to 1.
 */
export function instrumentSnapshot(
  symbol: string | null | undefined,
  specs: Map<string, InstrumentSpec>,
): { point_value_at_trade: number | null; tick_size_at_trade: number | null } {
  const spec = symbol ? specs.get(symbol) : undefined;
  return {
    point_value_at_trade: spec?.point_value ?? null,
    tick_size_at_trade: spec?.tick_size ?? null,
  };
}
