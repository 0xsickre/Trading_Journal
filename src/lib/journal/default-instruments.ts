// The instrument catalog — this book's broker, and nothing else.
//
// It used to be 91 rows: every major pair, every cross, futures for markets
// nobody here trades. A trade form that offers HG, ZB and HK50 to someone who
// trades ten CFDs is a list to scroll past, and worse, its specs were guesses
// at "the MT5 convention most brokers keep". These ten are copied from the
// contract sheets of the account's own broker, so the numbers are facts rather
// than conventions. A symbol the broker adds later is added in Settings.
//
// EVERYTHING IS PER LOT. `point_value` is the money one full point of price is
// worth for ONE lot, and `position_size` on a trade is counted in those same
// lots: 100 000 for a 100k FX lot, 100 for gold's 100-ounce lot and copper's
// 100-unit lot, 1 for the index. That identity is also the contract size, which
// is why `instrument-costs.ts` can price a position from `point_value` alone.
//
// tick_size is the broker's own quote precision (its "Digits"): five decimals
// on FX, three on the JPY pair, two on the CFDs. It is what a "point" means in
// the swap table, so the swap arithmetic depends on it being right.
//
// tick_value stays null: for a CFD the value of a tick is not exchange data but
// a broker's decision, and it is already implied by point_value × tick_size.
//
// COSTS ARE PER INSTRUMENT because this broker charges three different ways:
// 2.50 USD per lot per side on FX, 0.0007 % of notional on the metals, nothing
// on the index. Swap is published in POINTS per lot per night, with one night a
// week charged three times to cover the weekend — Wednesday on FX and metals,
// Friday on the index.

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
  /** Swap in points per lot per night; negative is a cost to the trader. */
  swap_long: number;
  swap_short: number;
  /** ISO weekday whose night is charged three times (3 = Wed, 5 = Fri). */
  swap_triple_day: number;
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

/** The FX pairs: one lot is 100 000 of the base currency, 2.50 USD a side. */
function fx(
  symbol: string,
  name: string,
  quote: string,
  swapLong: number,
  swapShort: number,
  sort: number,
): DefaultInstrument {
  return {
    symbol,
    name,
    asset_class: "Forex",
    point_value: 100_000,
    // Five decimals everywhere except the JPY pair, quoted to three.
    tick_size: quote === "JPY" ? 0.001 : 0.00001,
    tick_value: null,
    quote_currency: quote,
    commission_per_lot: 2.5,
    commission_pct: 0,
    commission_currency: "USD",
    swap_long: swapLong,
    swap_short: swapShort,
    swap_triple_day: 3,
    is_active: true,
    sort_order: sort,
  };
}

export const DEFAULT_INSTRUMENTS: DefaultInstrument[] = [
  // ------------------------------------------------------------------- Forex
  fx("EURUSD", "Euro / US Dollar", "USD", -11.06, 0.59, 0),
  fx("GBPUSD", "Pound / US Dollar", "USD", -6.78, -3.76, 1),
  fx("AUDUSD", "Aussie / US Dollar", "USD", -3.92, -5.11, 2),
  fx("NZDUSD", "Kiwi / US Dollar", "USD", -5.3, -0.17, 3),
  fx("USDCAD", "US Dollar / Canadian Dollar", "CAD", 1.42, -14.45, 4),
  fx("USDCHF", "US Dollar / Swiss Franc", "CHF", 2.55, -16.95, 5),
  fx("USDJPY", "US Dollar / Yen", "JPY", 4.8, -23.65, 6),

  // ------------------------------------------------------------- Metals, CFD
  // One lot is 100 ounces of gold, 100 units of copper. Commission is a share
  // of what the position is worth, not a fee per lot.
  {
    symbol: "XAUUSD",
    name: "Gold / US Dollar (spot CFD)",
    asset_class: "Metals CFD",
    point_value: 100,
    tick_size: 0.01,
    tick_value: null,
    quote_currency: "USD",
    commission_per_lot: 0,
    commission_pct: 0.0007,
    commission_currency: "EUR",
    swap_long: -83,
    swap_short: -8.3,
    swap_triple_day: 3,
    is_active: true,
    sort_order: 10,
  },
  {
    symbol: "XCUUSD",
    name: "Copper / US Dollar (spot CFD)",
    asset_class: "Metals CFD",
    point_value: 100,
    tick_size: 0.01,
    tick_value: null,
    quote_currency: "USD",
    commission_per_lot: 0,
    commission_pct: 0.0007,
    commission_currency: "EUR",
    swap_long: -17.93,
    swap_short: 2.57,
    swap_triple_day: 3,
    is_active: true,
    sort_order: 11,
  },

  // -------------------------------------------------------------- Index, CFD
  // Named as the broker names it, so an MT5 import matches without a mapping.
  // One lot is one index unit per point, there is no commission, and the
  // weekend's carry is collected on FRIDAY rather than Wednesday.
  {
    symbol: "US100.cash",
    name: "Nasdaq 100 (spot CFD)",
    asset_class: "Index CFD",
    point_value: 1,
    tick_size: 0.01,
    tick_value: null,
    quote_currency: "USD",
    commission_per_lot: 0,
    commission_pct: 0,
    commission_currency: "USD",
    swap_long: -634.31,
    swap_short: 27.37,
    swap_triple_day: 5,
    is_active: true,
    sort_order: 20,
  },
];

export const DEFAULT_INSTRUMENT_SYMBOLS = DEFAULT_INSTRUMENTS.map((i) => i.symbol);
