// Canonical watchlist — seeded for every user (DB: tj_seed_instruments_defaults).
// Keep in sync with Supabase seed migration.

export type DefaultInstrument = {
  symbol: string;
  name: string;
  asset_class: string;
  point_value: number;
  tick_size: number | null;
  tick_value: number | null;
  sort_order: number;
};

export const DEFAULT_INSTRUMENTS: DefaultInstrument[] = [
  {
    symbol: "DXY",
    name: "US Dollar Index",
    asset_class: "Forex",
    point_value: 1,
    tick_size: 0.01,
    tick_value: null,
    sort_order: 0,
  },
  {
    symbol: "EURUSD",
    name: "Euro / US Dollar",
    asset_class: "Forex",
    point_value: 100_000,
    tick_size: 0.00001,
    tick_value: null,
    sort_order: 1,
  },
  {
    symbol: "GBPUSD",
    name: "Pound / US Dollar",
    asset_class: "Forex",
    point_value: 100_000,
    tick_size: 0.00001,
    tick_value: null,
    sort_order: 2,
  },
  {
    symbol: "USDJPY",
    name: "US Dollar / Yen",
    asset_class: "Forex",
    point_value: 100_000,
    tick_size: 0.001,
    tick_value: null,
    sort_order: 3,
  },
  {
    symbol: "GBPJPY",
    name: "Pound / Yen",
    asset_class: "Forex",
    point_value: 100_000,
    tick_size: 0.001,
    tick_value: null,
    sort_order: 4,
  },
  {
    symbol: "EURJPY",
    name: "Euro / Yen",
    asset_class: "Forex",
    point_value: 100_000,
    tick_size: 0.001,
    tick_value: null,
    sort_order: 5,
  },
  {
    symbol: "NAS100USD",
    name: "Nasdaq 100 Index",
    asset_class: "Index CFD",
    point_value: 1,
    tick_size: 0.25,
    tick_value: null,
    sort_order: 6,
  },
  {
    symbol: "SPX500USD",
    name: "S&P 500 Index",
    asset_class: "Index CFD",
    point_value: 1,
    tick_size: 0.1,
    tick_value: null,
    sort_order: 7,
  },
  {
    symbol: "XAUUSD",
    name: "Gold / US Dollar",
    asset_class: "Metals",
    point_value: 1,
    tick_size: 0.01,
    tick_value: null,
    sort_order: 8,
  },
];

export const DEFAULT_INSTRUMENT_SYMBOLS = DEFAULT_INSTRUMENTS.map(
  (i) => i.symbol,
);
