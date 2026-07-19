// Canonical watchlist — seeded for every user (DB: tj_seed_instruments_defaults).
// Keep in sync with Trading data vault: instrument_registry.TRADE + RADAR (B6 FTMO).

export type DefaultInstrument = {
  symbol: string;
  name: string;
  asset_class: string;
  point_value: number;
  tick_size: number | null;
  tick_value: number | null;
  sort_order: number;
};

/** 8 aktivnih trade + 2 radar (HG, RTY) — redosled kao F2 FX → indeksi → roba → radar. */
export const DEFAULT_INSTRUMENTS: DefaultInstrument[] = [
  {
    symbol: "EURUSD",
    name: "Euro / US Dollar",
    asset_class: "Forex",
    point_value: 100_000,
    tick_size: 0.00001,
    tick_value: null,
    sort_order: 0,
  },
  {
    symbol: "GBPUSD",
    name: "Pound / US Dollar",
    asset_class: "Forex",
    point_value: 100_000,
    tick_size: 0.00001,
    tick_value: null,
    sort_order: 1,
  },
  {
    symbol: "USDJPY",
    name: "US Dollar / Yen",
    asset_class: "Forex",
    point_value: 100_000,
    tick_size: 0.001,
    tick_value: null,
    sort_order: 2,
  },
  {
    symbol: "USDCAD",
    name: "US Dollar / Canadian Dollar",
    asset_class: "Forex",
    point_value: 100_000,
    tick_size: 0.00001,
    tick_value: null,
    sort_order: 3,
  },
  {
    symbol: "AUDUSD",
    name: "Aussie / US Dollar",
    asset_class: "Forex",
    point_value: 100_000,
    tick_size: 0.00001,
    tick_value: null,
    sort_order: 4,
  },
  {
    symbol: "SP500",
    name: "S&P 500 Index",
    asset_class: "Index CFD",
    point_value: 1,
    tick_size: 0.1,
    tick_value: null,
    sort_order: 5,
  },
  {
    symbol: "NAS100",
    name: "Nasdaq 100 Index",
    asset_class: "Index CFD",
    point_value: 1,
    tick_size: 0.25,
    tick_value: null,
    sort_order: 6,
  },
  {
    symbol: "XAUUSD",
    name: "Gold / US Dollar",
    asset_class: "Metals",
    point_value: 1,
    tick_size: 0.01,
    tick_value: null,
    sort_order: 7,
  },
  {
    symbol: "HG",
    name: "Copper (HG)",
    asset_class: "Commodities",
    point_value: 1,
    tick_size: 0.0001,
    tick_value: null,
    sort_order: 8,
  },
  {
    symbol: "RTY",
    name: "Russell 2000 Index",
    asset_class: "Index CFD",
    point_value: 1,
    tick_size: 0.1,
    tick_value: null,
    sort_order: 9,
  },
];

/** Legacy symbols removed in B6 — kept for import/position migration reference. */
export const ARCHIVED_INSTRUMENT_SYMBOLS = [
  "DXY",
  "GBPJPY",
  "EURJPY",
  "NAS100USD",
  "SPX500USD",
  "USDCHF",
  "NZDUSD",
  "EURGBP",
  "AUDNZD",
  "XAG",
] as const;

export const DEFAULT_INSTRUMENT_SYMBOLS = DEFAULT_INSTRUMENTS.map(
  (i) => i.symbol,
);
