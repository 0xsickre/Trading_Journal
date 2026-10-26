// The instrument catalog — the eight CME futures the book trades, and nothing else.
//
// It used to be one CFD broker's book (ten FX pairs, metals and an index CFD on
// FTMO). Trading moved to CME futures on 28.09.2026 and the CFD rows went with it
// (migration 20260928140000 removed only those no trade named). A symbol traded
// somewhere else is added in Settings.
//
// EVERYTHING IS PER LOT, and a futures lot is one contract: `point_value` is the
// CME multiplier — 20 dollars a point on NQ, a tenth of that on the micro — and
// `position_size` on a trade is counted in contracts. `instrument-costs.ts`
// prices a position from `point_value` alone for that reason.
//
// tick_size is the exchange's minimum move: a quarter point on the equity
// indexes, half a pip on 6E and a pip on M6E. The trade form turns a stop into
// ticks with it, which is what a platform's bracket asks for. Gold moves in dimes ($10 a tick on GC,
// $1 on MGC).
//
// tick_value stays null: it is point_value × tick_size, and a second copy of a
// product is a number that can disagree with itself.
//
// The commission is 0 (phase X5, X-8 A, 26.10.2026): it was Topstep's, and the
// journal knows no firm. The trader types the broker's own per instrument in
// Settings › Instruments; an existing book keeps what it has. There is no swap:
// a future carries its financing in the price.
//
// MAE/MFE on these comes from the exchange's own prices, kept in Cloudflare R2
// (futures-trading repo, `tools/journal_mae.py`), never typed.

export type DefaultInstrument = {
  symbol: string;
  name: string;
  asset_class: string;
  point_value: number;
  tick_size: number | null;
  tick_value: number | null;
  /** The currency point_value expresses money in. */
  quote_currency: string;
  /** Money per lot, per side. */
  commission_per_lot: number;
  /** Percent of notional, per side. */
  commission_pct: number;
  /** The currency the broker states the commission in. */
  commission_currency: string;
  /**
   * Whether it is offered in the trade form. In the catalog it is always `true`.
   *
   * A catalog instrument that cannot be picked while entering a trade is the
   * opposite of what a catalog is for; a long list is solved by grouping on
   * `asset_class`, which the form does.
   */
  is_active: boolean;
  sort_order: number;
};

/** A CME future: one lot is one contract, the multiplier is `point_value`, no swap. */
function futures(
  symbol: string,
  name: string,
  pointValue: number,
  tickSize: number,
  commissionPerSide: number,
  sort: number,
): DefaultInstrument {
  return {
    symbol,
    name,
    asset_class: "Futures",
    point_value: pointValue,
    tick_size: tickSize,
    tick_value: null,
    quote_currency: "USD",
    commission_per_lot: commissionPerSide,
    commission_pct: 0,
    commission_currency: "USD",
    is_active: true,
    sort_order: sort,
  };
}

export const DEFAULT_INSTRUMENTS: DefaultInstrument[] = [
  futures("NQ", "E-mini Nasdaq 100", 20, 0.25, 0, 30),
  futures("MNQ", "Micro E-mini Nasdaq 100", 2, 0.25, 0, 31),
  futures("ES", "E-mini S&P 500", 50, 0.25, 0, 32),
  futures("MES", "Micro E-mini S&P 500", 5, 0.25, 0, 33),
  futures("6E", "Euro FX", 125_000, 0.00005, 0, 34),
  futures("M6E", "Micro EUR/USD", 12_500, 0.0001, 0, 35),
  futures("GC", "Gold", 100, 0.1, 0, 36),
  futures("MGC", "Micro Gold", 10, 0.1, 0, 37),
];

export const DEFAULT_INSTRUMENT_SYMBOLS = DEFAULT_INSTRUMENTS.map((i) => i.symbol);

/** The micro of a mini and the mini of a micro — a tenth of the multiplier, one tick. */
export const MICRO_OF: Record<string, string> = { NQ: "MNQ", ES: "MES", "6E": "M6E", GC: "MGC" };
export const MINI_OF: Record<string, string> = { MNQ: "NQ", MES: "ES", M6E: "6E", MGC: "GC" };

/** The roots a daily bias is set for (faza D). A micro shares its mini's price, so it shares its bias. */
export const BIAS_ROOTS = ["NQ", "ES", "GC"] as const;
export type BiasRoot = (typeof BIAS_ROOTS)[number];

/**
 * The bias root of a traded symbol: MNQ → NQ, MES → ES, MGC → GC, a mini is its own root.
 * A contract code (`MNQZ6`, `GCZ6`) or a TradingView continuous (`NQ1!`) reads the same.
 * Anything else — 6E, a CFD, an empty string — has no daily bias and gives null.
 */
export function rootOf(symbol: string | null | undefined): BiasRoot | null {
  const m = /^(MNQ|NQ|MES|ES|MGC|GC)(?:[FGHJKMNQUVXZ]\d{1,2}|1!)?$/.exec((symbol ?? "").trim().toUpperCase());
  if (!m) return null;
  const sym = m[1];
  return (MINI_OF[sym] ?? sym) as BiasRoot;
}
