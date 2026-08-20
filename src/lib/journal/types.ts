// Client-safe shared types (no server-only imports here).

import type { Database } from "@/lib/supabase/types";
import type { TradeImageKind } from "./tradingview-snapshot";

export type OptionItem = {
  id: string;
  value: string;
  label: string;
  color: string | null;
  is_active: boolean;
  sort_order: number;
};

export type OptionList = {
  id: string;
  key: string;
  label: string;
  category: string | null;
  sort_order: number;
  items: OptionItem[];
};

export type OptionsMap = Record<string, OptionItem[]>;

export type Instrument = {
  id: string;
  symbol: string;
  name: string | null;
  asset_class: string | null;
  point_value: number;
  tick_size: number | null;
  tick_value: number | null;
  /** Valuta u kojoj je instrument KOTIRAN — valuta `point_value`, pa i bruto P&L-a pre konverzije. */
  quote_currency: string;
  is_active: boolean;
  sort_order: number;
};

export type Account = {
  id: string;
  name: string;
  broker: string | null;
  /** Broker-side account number the bot bridge reports under, e.g. a cTrader
   * Account.Number. Null until mapped in Settings; an unmapped number
   * quarantines the bot's events rather than guessing an account. */
  broker_account_id: string | null;
  currency: string;
  starting_balance: number;
  default_asset_class: string | null;
  timezone: string;
  is_active: boolean;
  // Breakeven band — asymmetric on purpose (e.g. -37.50 .. 0), not a tolerance.
  breakeven_from: number;
  breakeven_to: number;
  breakeven_unit: "currency" | "pct";
  // Cost defaults applied to new execution rows in the trade form.
  default_commission_per_unit: number;
  default_fee_fixed: number;
  default_swap_per_day: number;
  // Risk plan defaults applied when stop / target are left empty.
  default_stop_pct: number | null;
  default_target_pct: number | null;
  // FTMO / prop-firm challenge mode (per account).
  ftmo_mode: boolean;
  ftmo_daily_loss_enabled: boolean;
  ftmo_daily_loss_pct: number;
  /** What the daily-loss % is OF: a fixed starting balance, or the previous
   * trading day's closing equity. Real FTMO account types use both, depending
   * on the challenge purchased. */
  ftmo_daily_loss_basis: "starting_balance" | "prev_close";
  ftmo_max_loss_enabled: boolean;
  ftmo_max_loss_pct: number;
  ftmo_profit_target_enabled: boolean;
  ftmo_profit_target_pct: number;
  ftmo_min_days_enabled: boolean;
  ftmo_min_days: number;
  ftmo_reset_at: string | null;
};

/** Where `point_value` came from. `missing` means the money columns are null. */
export const POINT_VALUE_SOURCES = ["snapshot", "instrument", "missing"] as const;
export type PointValueSource = (typeof POINT_VALUE_SOURCES)[number];

/**
 * Odakle kurs. `missing` i `no_account` znače da su novčane kolone null — isto
 * pravilo kao `point_value_source`, i isti razlog: bolje ništa nego jen sabran
 * sa dolarom.
 */
export const FX_RATE_SOURCES = [
  "snapshot",
  "same_currency",
  "no_account",
  "missing",
] as const;
export type FxRateSource = (typeof FX_RATE_SOURCES)[number];

type StatsViewRow = Database["public"]["Views"]["tj_position_stats"]["Row"];

/**
 * Jedan red `tj_position_stats` — IZVEDEN iz generisanog tipa, ne prepisan.
 *
 * Ovo je do sada bio ručni spisak od 22 polja naspram 29 kolona view-a, pa je
 * `statRows as PositionStat[]` u `trades.ts` bio tvrdnja koju ništa nije
 * proveravalo: sedam kolona (`user_id`, `account_id`, `instrument`,
 * `direction`, `status`, `dir_mult`, `gross_points`) tip nije ni poznavao, a
 * `position_id` i dva `*_source` polja su bila sužena na ne-null iako
 * PostgREST za view ne garantuje ništa.
 *
 * Sada izmena view-a menja i ovaj tip. Kolona koja nestane ili promeni tip
 * obara typecheck ovde — što je tačno ono što ručni spisak nije mogao.
 *
 * `Pick`, a ne ceo red: view nosi i `user_id`, `account_id`, `instrument`,
 * `direction`, `status`, `dir_mult` i `gross_points`, koje aplikacija čita sa
 * SAME POZICIJE a ne odavde (provereno grep-om — nijedno mesto ne dodiruje
 * `stats.instrument` ni ostale). Projekcija je poštenija od `Omit`-a: govori
 * šta se zaista troši, a nova kolona u view-u ne postaje obaveza za svaki
 * fixture koji je nikad neće pročitati.
 *
 * Tri sužavanja ostaju, i to su jedina tri:
 *   • `position_id` je `p.id`, primarni ključ — nikad null u praksi;
 *   • dva `*_source` polja su `CASE` sa `ELSE` granom, pa uvek vrate vrednost.
 * `narrowPositionStat` ih proverava u vreme izvršavanja, i to ne slepo.
 */
export type PositionStat = Pick<
  StatsViewRow,
  | "avg_entry"
  | "avg_exit"
  | "entry_qty"
  | "exit_qty"
  | "gross_pl"
  | "net_pl"
  | "total_fees"
  | "total_swap"
  | "realized_r"
  | "realized_r_net"
  | "opened_at"
  | "closed_at"
  | "duration_seconds"
  | "point_value"
  | "tick_size"
  | "quote_currency"
  | "account_currency"
  | "fx_rate"
  | "money_overridden"
> & {
  position_id: string;
  point_value_source: PointValueSource;
  fx_rate_source: FxRateSource;
};

/**
 * Suzi jedan red view-a u `PositionStat`, ili odbij red bez `position_id`.
 *
 * Nepoznata vrednost u `*_source` polju pada na `"missing"` — namerno u smeru
 * OPREZA: `missing` je oznaka koja kaže „novac ovde nije pouzdan", pa nepoznato
 * stanje čita kao neprocenjeno umesto da ga tiho prizna kao snimljeno. Obrnut
 * izbor bi vrednost nepoznatog porekla predstavio kao proverenu.
 */
export function narrowPositionStat(row: StatsViewRow): PositionStat | null {
  if (!row.position_id) return null;
  return {
    ...row,
    position_id: row.position_id,
    point_value_source: (POINT_VALUE_SOURCES as readonly string[]).includes(
      row.point_value_source ?? "",
    )
      ? (row.point_value_source as PointValueSource)
      : "missing",
    fx_rate_source: (FX_RATE_SOURCES as readonly string[]).includes(
      row.fx_rate_source ?? "",
    )
      ? (row.fx_rate_source as FxRateSource)
      : "missing",
  };
}

export type TradeTvImages = Partial<Record<TradeImageKind, string>>;

export type TradeRow = {
  id: string;
  account_id: string | null;
  trade_no: number | null;
  status: string;
  source: string;
  needs_review: boolean;
  created_at: string;
  stats: PositionStat | null;
  tv_images?: TradeTvImages;
} & Record<string, unknown>;
