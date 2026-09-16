// The instrument catalog — CFDs and futures kept apart, with real contract specs.
//
// point_value: money in the QUOTE CURRENCY per 1.00 of price movement, per 1
// unit of executed quantity. A fill's `qty` is counted in those same units:
// 1 standard FX lot, 1 CFD contract, 1 futures contract.
//
// quote_currency is the currency of that amount, and since 20260815130000 the
// view genuinely uses it: gross is multiplied by the rate recorded on the trade
// before it enters any total. That is why GER40 (EUR), UK100 (GBP), JP225 (JPY)
// and AUS200 (AUD) sit here with their own currencies instead of all pretending
// to be dollar-denominated.
//
// tick_value is filled in wherever the exchange publishes a tick value — that
// is, for every futures contract. The relationship that MUST then hold:
//
//     point_value × tick_size = tick_value
//
// (ES: 50 × 0.25 = 12.50 ; ZB: 1000 × 1/32 = 31.25 ; 6J: 12,500,000 × 0.0000005
// = 6.25). `default-instruments.test.ts` asserts that for every row — a
// transcription error in a contract spec is the only kind of error this file
// can have, and that is how it gets caught.
//
// CFDs have no tick_value because there the tick value is not exchange data but
// a broker's decision. They sit here on the MT5 convention most brokers keep:
// XAUUSD 1 lot = 100 ounces, XAGUSD = 5,000 ounces, oil = 1,000 barrels,
// indices 1 currency unit per point. If your broker differs, it is corrected in
// Settings — and since this change that correction STICKS (see 20260815150000).

export type DefaultInstrument = {
  symbol: string;
  name: string;
  asset_class: string;
  point_value: number;
  tick_size: number | null;
  tick_value: number | null;
  /** The currency point_value expresses money in. */
  quote_currency: string;
  /**
   * Whether it is offered in the trade form. In the catalog it is always `true`.
   *
   * The first version activated only eleven symbols and left the other eighty
   * off "so the dropdown does not grow". That was the wrong trade-off: the
   * catalog was asked for precisely so it would be ready to use, and the answer
   * to a long list is grouping and search, not hiding. The list in the form is
   * now grouped by instrument class.
   *
   * The column stays because `getInstruments(true)` reads it and because a user
   * can delete an instrument they do not trade — but it is not toggled from the
   * UI.
   */
  is_active: boolean;
  sort_order: number;
};

/** Shorthand — most rows share the same shape. */
function fx(
  symbol: string,
  name: string,
  quote: string,
  sort: number,
): DefaultInstrument {
  return {
    symbol,
    name,
    asset_class: "Forex",
    point_value: 100_000,
    // Five decimals everywhere except JPY pairs, which are quoted to three.
    // `units.ts` iz ovoga izvodi pip kao deset tikova.
    tick_size: quote === "JPY" ? 0.001 : 0.00001,
    tick_value: null,
    quote_currency: quote,
    is_active: true,
    sort_order: sort,
  };
}

export const DEFAULT_INSTRUMENTS: DefaultInstrument[] = [
  // ---------------------------------------------------------------- FX majors
  fx("EURUSD", "Euro / US Dollar", "USD", 0),
  fx("GBPUSD", "Pound / US Dollar", "USD", 1),
  fx("USDJPY", "US Dollar / Yen", "JPY", 2),
  fx("USDCHF", "US Dollar / Swiss Franc", "CHF", 3),
  fx("USDCAD", "US Dollar / Canadian Dollar", "CAD", 4),
  fx("AUDUSD", "Aussie / US Dollar", "USD", 5),
  fx("NZDUSD", "Kiwi / US Dollar", "USD", 6),

  // --------------------------------------------------------------- FX crosses
  fx("EURGBP", "Euro / Pound", "GBP", 100),
  fx("EURJPY", "Euro / Yen", "JPY", 101),
  fx("EURCHF", "Euro / Swiss Franc", "CHF", 102),
  fx("EURAUD", "Euro / Aussie", "AUD", 103),
  fx("EURCAD", "Euro / Canadian Dollar", "CAD", 104),
  fx("EURNZD", "Euro / Kiwi", "NZD", 105),
  fx("GBPJPY", "Pound / Yen", "JPY", 106),
  fx("GBPCHF", "Pound / Swiss Franc", "CHF", 107),
  fx("GBPAUD", "Pound / Aussie", "AUD", 108),
  fx("GBPCAD", "Pound / Canadian Dollar", "CAD", 109),
  fx("GBPNZD", "Pound / Kiwi", "NZD", 110),
  fx("AUDJPY", "Aussie / Yen", "JPY", 111),
  fx("AUDCHF", "Aussie / Swiss Franc", "CHF", 112),
  fx("AUDCAD", "Aussie / Canadian Dollar", "CAD", 113),
  fx("AUDNZD", "Aussie / Kiwi", "NZD", 114),
  fx("NZDJPY", "Kiwi / Yen", "JPY", 115),
  fx("NZDCHF", "Kiwi / Swiss Franc", "CHF", 116),
  fx("NZDCAD", "Kiwi / Canadian Dollar", "CAD", 117),
  fx("CADJPY", "Canadian Dollar / Yen", "JPY", 118),
  fx("CADCHF", "Canadian Dollar / Swiss Franc", "CHF", 119),
  fx("CHFJPY", "Swiss Franc / Yen", "JPY", 120),

  // ------------------------------------------------- Metals & energy, spot CFD
  // 1 lot = 100 unci zlata, 5 000 unci srebra, 1 000 barela nafte.
  { symbol: "XAUUSD", name: "Gold / US Dollar (spot)", asset_class: "Metals CFD", point_value: 100, tick_size: 0.01, tick_value: null, quote_currency: "USD", is_active: true, sort_order: 200 },
  { symbol: "XAGUSD", name: "Silver / US Dollar (spot)", asset_class: "Metals CFD", point_value: 5_000, tick_size: 0.001, tick_value: null, quote_currency: "USD", is_active: true, sort_order: 201 },
  { symbol: "XPTUSD", name: "Platinum / US Dollar (spot)", asset_class: "Metals CFD", point_value: 100, tick_size: 0.01, tick_value: null, quote_currency: "USD", is_active: true, sort_order: 202 },
  { symbol: "USOIL", name: "WTI Crude Oil (spot CFD)", asset_class: "Energy CFD", point_value: 1_000, tick_size: 0.01, tick_value: null, quote_currency: "USD", is_active: true, sort_order: 210 },
  { symbol: "UKOIL", name: "Brent Crude Oil (spot CFD)", asset_class: "Energy CFD", point_value: 1_000, tick_size: 0.01, tick_value: null, quote_currency: "USD", is_active: true, sort_order: 211 },
  { symbol: "NATGAS", name: "Natural Gas (spot CFD)", asset_class: "Energy CFD", point_value: 10_000, tick_size: 0.001, tick_value: null, quote_currency: "USD", is_active: true, sort_order: 212 },

  // ---------------------------------------------------------------- Index CFDs
  // 1 contract = 1 unit of the quote currency per index point.
  { symbol: "SP500", name: "S&P 500 (CFD)", asset_class: "Index CFD", point_value: 1, tick_size: 0.1, tick_value: null, quote_currency: "USD", is_active: true, sort_order: 300 },
  { symbol: "NAS100", name: "Nasdaq 100 (CFD)", asset_class: "Index CFD", point_value: 1, tick_size: 0.25, tick_value: null, quote_currency: "USD", is_active: true, sort_order: 301 },
  { symbol: "US30", name: "Dow Jones 30 (CFD)", asset_class: "Index CFD", point_value: 1, tick_size: 1, tick_value: null, quote_currency: "USD", is_active: true, sort_order: 302 },
  { symbol: "US2000", name: "Russell 2000 (CFD)", asset_class: "Index CFD", point_value: 1, tick_size: 0.1, tick_value: null, quote_currency: "USD", is_active: true, sort_order: 303 },
  { symbol: "GER40", name: "DAX 40 (CFD)", asset_class: "Index CFD", point_value: 1, tick_size: 0.1, tick_value: null, quote_currency: "EUR", is_active: true, sort_order: 304 },
  { symbol: "UK100", name: "FTSE 100 (CFD)", asset_class: "Index CFD", point_value: 1, tick_size: 0.1, tick_value: null, quote_currency: "GBP", is_active: true, sort_order: 305 },
  { symbol: "FRA40", name: "CAC 40 (CFD)", asset_class: "Index CFD", point_value: 1, tick_size: 0.1, tick_value: null, quote_currency: "EUR", is_active: true, sort_order: 306 },
  { symbol: "EU50", name: "Euro Stoxx 50 (CFD)", asset_class: "Index CFD", point_value: 1, tick_size: 0.1, tick_value: null, quote_currency: "EUR", is_active: true, sort_order: 307 },
  { symbol: "ESP35", name: "IBEX 35 (CFD)", asset_class: "Index CFD", point_value: 1, tick_size: 0.1, tick_value: null, quote_currency: "EUR", is_active: true, sort_order: 308 },
  { symbol: "SUI20", name: "SMI 20 (CFD)", asset_class: "Index CFD", point_value: 1, tick_size: 0.1, tick_value: null, quote_currency: "CHF", is_active: true, sort_order: 309 },
  { symbol: "JP225", name: "Nikkei 225 (CFD)", asset_class: "Index CFD", point_value: 1, tick_size: 1, tick_value: null, quote_currency: "JPY", is_active: true, sort_order: 310 },
  { symbol: "AUS200", name: "ASX 200 (CFD)", asset_class: "Index CFD", point_value: 1, tick_size: 1, tick_value: null, quote_currency: "AUD", is_active: true, sort_order: 311 },
  { symbol: "HK50", name: "Hang Seng (CFD)", asset_class: "Index CFD", point_value: 1, tick_size: 1, tick_value: null, quote_currency: "HKD", is_active: true, sort_order: 312 },

  // ----------------------------------------------------------- Index futures
  { symbol: "ES", name: "E-mini S&P 500", asset_class: "Index Futures", point_value: 50, tick_size: 0.25, tick_value: 12.5, quote_currency: "USD", is_active: true, sort_order: 400 },
  { symbol: "MES", name: "Micro E-mini S&P 500", asset_class: "Index Futures", point_value: 5, tick_size: 0.25, tick_value: 1.25, quote_currency: "USD", is_active: true, sort_order: 401 },
  { symbol: "NQ", name: "E-mini Nasdaq 100", asset_class: "Index Futures", point_value: 20, tick_size: 0.25, tick_value: 5, quote_currency: "USD", is_active: true, sort_order: 402 },
  { symbol: "MNQ", name: "Micro E-mini Nasdaq 100", asset_class: "Index Futures", point_value: 2, tick_size: 0.25, tick_value: 0.5, quote_currency: "USD", is_active: true, sort_order: 403 },
  { symbol: "YM", name: "E-mini Dow", asset_class: "Index Futures", point_value: 5, tick_size: 1, tick_value: 5, quote_currency: "USD", is_active: true, sort_order: 404 },
  { symbol: "MYM", name: "Micro E-mini Dow", asset_class: "Index Futures", point_value: 0.5, tick_size: 1, tick_value: 0.5, quote_currency: "USD", is_active: true, sort_order: 405 },
  { symbol: "RTY", name: "E-mini Russell 2000", asset_class: "Index Futures", point_value: 50, tick_size: 0.1, tick_value: 5, quote_currency: "USD", is_active: true, sort_order: 406 },
  { symbol: "M2K", name: "Micro E-mini Russell 2000", asset_class: "Index Futures", point_value: 5, tick_size: 0.1, tick_value: 0.5, quote_currency: "USD", is_active: true, sort_order: 407 },
  { symbol: "FDAX", name: "DAX Futures", asset_class: "Index Futures", point_value: 25, tick_size: 1, tick_value: 25, quote_currency: "EUR", is_active: true, sort_order: 408 },
  { symbol: "FDXM", name: "Mini-DAX Futures", asset_class: "Index Futures", point_value: 5, tick_size: 1, tick_value: 5, quote_currency: "EUR", is_active: true, sort_order: 409 },
  { symbol: "FESX", name: "Euro Stoxx 50 Futures", asset_class: "Index Futures", point_value: 10, tick_size: 1, tick_value: 10, quote_currency: "EUR", is_active: true, sort_order: 410 },
  { symbol: "NKD", name: "Nikkei 225 Futures (USD)", asset_class: "Index Futures", point_value: 5, tick_size: 5, tick_value: 25, quote_currency: "USD", is_active: true, sort_order: 411 },

  // ---------------------------------------------------------- Metals futures
  { symbol: "GC", name: "Gold Futures", asset_class: "Metals Futures", point_value: 100, tick_size: 0.1, tick_value: 10, quote_currency: "USD", is_active: true, sort_order: 500 },
  { symbol: "MGC", name: "Micro Gold Futures", asset_class: "Metals Futures", point_value: 10, tick_size: 0.1, tick_value: 1, quote_currency: "USD", is_active: true, sort_order: 501 },
  { symbol: "SI", name: "Silver Futures", asset_class: "Metals Futures", point_value: 5_000, tick_size: 0.005, tick_value: 25, quote_currency: "USD", is_active: true, sort_order: 502 },
  { symbol: "HG", name: "Copper Futures", asset_class: "Metals Futures", point_value: 25_000, tick_size: 0.0005, tick_value: 12.5, quote_currency: "USD", is_active: true, sort_order: 503 },
  { symbol: "PL", name: "Platinum Futures", asset_class: "Metals Futures", point_value: 50, tick_size: 0.1, tick_value: 5, quote_currency: "USD", is_active: true, sort_order: 504 },
  { symbol: "PA", name: "Palladium Futures", asset_class: "Metals Futures", point_value: 100, tick_size: 0.1, tick_value: 10, quote_currency: "USD", is_active: true, sort_order: 505 },

  // ---------------------------------------------------------- Energy futures
  { symbol: "CL", name: "WTI Crude Oil Futures", asset_class: "Energy Futures", point_value: 1_000, tick_size: 0.01, tick_value: 10, quote_currency: "USD", is_active: true, sort_order: 600 },
  { symbol: "MCL", name: "Micro WTI Crude Oil Futures", asset_class: "Energy Futures", point_value: 100, tick_size: 0.01, tick_value: 1, quote_currency: "USD", is_active: true, sort_order: 601 },
  { symbol: "NG", name: "Natural Gas Futures", asset_class: "Energy Futures", point_value: 10_000, tick_size: 0.001, tick_value: 10, quote_currency: "USD", is_active: true, sort_order: 602 },
  { symbol: "RB", name: "RBOB Gasoline Futures", asset_class: "Energy Futures", point_value: 42_000, tick_size: 0.0001, tick_value: 4.2, quote_currency: "USD", is_active: true, sort_order: 603 },
  { symbol: "HO", name: "Heating Oil Futures", asset_class: "Energy Futures", point_value: 42_000, tick_size: 0.0001, tick_value: 4.2, quote_currency: "USD", is_active: true, sort_order: 604 },

  // ------------------------------------------------- Agriculture & soft futures
  { symbol: "ZC", name: "Corn Futures", asset_class: "Agriculture Futures", point_value: 50, tick_size: 0.25, tick_value: 12.5, quote_currency: "USD", is_active: true, sort_order: 700 },
  { symbol: "ZS", name: "Soybean Futures", asset_class: "Agriculture Futures", point_value: 50, tick_size: 0.25, tick_value: 12.5, quote_currency: "USD", is_active: true, sort_order: 701 },
  { symbol: "ZW", name: "Wheat Futures", asset_class: "Agriculture Futures", point_value: 50, tick_size: 0.25, tick_value: 12.5, quote_currency: "USD", is_active: true, sort_order: 702 },
  { symbol: "ZL", name: "Soybean Oil Futures", asset_class: "Agriculture Futures", point_value: 600, tick_size: 0.01, tick_value: 6, quote_currency: "USD", is_active: true, sort_order: 703 },
  { symbol: "ZM", name: "Soybean Meal Futures", asset_class: "Agriculture Futures", point_value: 100, tick_size: 0.1, tick_value: 10, quote_currency: "USD", is_active: true, sort_order: 704 },
  { symbol: "KC", name: "Coffee C Futures", asset_class: "Softs Futures", point_value: 375, tick_size: 0.05, tick_value: 18.75, quote_currency: "USD", is_active: true, sort_order: 710 },
  { symbol: "SB", name: "Sugar No.11 Futures", asset_class: "Softs Futures", point_value: 1_120, tick_size: 0.01, tick_value: 11.2, quote_currency: "USD", is_active: true, sort_order: 711 },
  { symbol: "CT", name: "Cotton No.2 Futures", asset_class: "Softs Futures", point_value: 500, tick_size: 0.01, tick_value: 5, quote_currency: "USD", is_active: true, sort_order: 712 },
  { symbol: "CC", name: "Cocoa Futures", asset_class: "Softs Futures", point_value: 10, tick_size: 1, tick_value: 10, quote_currency: "USD", is_active: true, sort_order: 713 },

  // ----------------------------------------------------------- Rates futures
  // Obveznice se kotiraju u tridesetdruginama: tick 1/32 = 0.03125.
  { symbol: "ZB", name: "30-Year T-Bond Futures", asset_class: "Rates Futures", point_value: 1_000, tick_size: 0.03125, tick_value: 31.25, quote_currency: "USD", is_active: true, sort_order: 800 },
  { symbol: "UB", name: "Ultra T-Bond Futures", asset_class: "Rates Futures", point_value: 1_000, tick_size: 0.03125, tick_value: 31.25, quote_currency: "USD", is_active: true, sort_order: 801 },
  { symbol: "ZN", name: "10-Year T-Note Futures", asset_class: "Rates Futures", point_value: 1_000, tick_size: 0.015625, tick_value: 15.625, quote_currency: "USD", is_active: true, sort_order: 802 },
  { symbol: "ZF", name: "5-Year T-Note Futures", asset_class: "Rates Futures", point_value: 1_000, tick_size: 0.0078125, tick_value: 7.8125, quote_currency: "USD", is_active: true, sort_order: 803 },
  { symbol: "ZT", name: "2-Year T-Note Futures", asset_class: "Rates Futures", point_value: 2_000, tick_size: 0.00390625, tick_value: 7.8125, quote_currency: "USD", is_active: true, sort_order: 804 },

  // -------------------------------------------------------------- FX futures
  // Quoted in dollars per unit of the foreign currency, so quote is always USD.
  { symbol: "6E", name: "Euro FX Futures", asset_class: "FX Futures", point_value: 125_000, tick_size: 0.00005, tick_value: 6.25, quote_currency: "USD", is_active: true, sort_order: 900 },
  { symbol: "6B", name: "British Pound Futures", asset_class: "FX Futures", point_value: 62_500, tick_size: 0.0001, tick_value: 6.25, quote_currency: "USD", is_active: true, sort_order: 901 },
  { symbol: "6J", name: "Japanese Yen Futures", asset_class: "FX Futures", point_value: 12_500_000, tick_size: 0.0000005, tick_value: 6.25, quote_currency: "USD", is_active: true, sort_order: 902 },
  { symbol: "6A", name: "Australian Dollar Futures", asset_class: "FX Futures", point_value: 100_000, tick_size: 0.0001, tick_value: 10, quote_currency: "USD", is_active: true, sort_order: 903 },
  { symbol: "6C", name: "Canadian Dollar Futures", asset_class: "FX Futures", point_value: 100_000, tick_size: 0.00005, tick_value: 5, quote_currency: "USD", is_active: true, sort_order: 904 },
  { symbol: "6S", name: "Swiss Franc Futures", asset_class: "FX Futures", point_value: 125_000, tick_size: 0.0001, tick_value: 12.5, quote_currency: "USD", is_active: true, sort_order: 905 },
  { symbol: "6N", name: "New Zealand Dollar Futures", asset_class: "FX Futures", point_value: 100_000, tick_size: 0.0001, tick_value: 10, quote_currency: "USD", is_active: true, sort_order: 906 },
];

/** The symbols the seed offers. Not used for deletion — see 20260815150000. */
export const DEFAULT_INSTRUMENT_SYMBOLS = DEFAULT_INSTRUMENTS.map((i) => i.symbol);

/**
 * Old symbol names that are no longer seeded.
 *
 * The list shrank when the catalog grew: `GBPJPY`, `EURJPY`, `USDCHF`,
 * `NZDUSD`, `EURGBP` and `AUDNZD` were once "archived" because the B6 watchlist
 * did not cover them — not because they were wrong. They are ordinary pairs in
 * the catalog now, so they are gone from here.
 *
 * What remains is only genuine aliases: the same instrument under another
 * symbol (`SPX500USD` for SP500, `NAS100USD` for NAS100, `XAG` for XAGUSD) and
 * `DXY`, which is not traded directly. The list earns its keep on import: a
 * broker sending `SPX500USD` should be recognised, not filed as a new
 * instrument.
 */
export const ARCHIVED_INSTRUMENT_SYMBOLS = [
  "DXY",
  "NAS100USD",
  "SPX500USD",
  "XAG",
] as const;
