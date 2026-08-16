// Client-safe shared types (no server-only imports here).

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
  ftmo_max_loss_enabled: boolean;
  ftmo_max_loss_pct: number;
  ftmo_profit_target_enabled: boolean;
  ftmo_profit_target_pct: number;
  ftmo_min_days_enabled: boolean;
  ftmo_min_days: number;
  ftmo_reset_at: string | null;
};

export type PositionStat = {
  position_id: string;
  avg_entry: number | null;
  avg_exit: number | null;
  entry_qty: number | null;
  exit_qty: number | null;
  gross_pl: number | null;
  net_pl: number | null;
  total_fees: number | null;
  total_swap: number | null;
  realized_r: number | null;
  realized_r_net: number | null;
  opened_at: string | null;
  closed_at: string | null;
  duration_seconds: number | null;
  /**
   * Point value actually used to price this trade. Null when neither a snapshot
   * nor an instrument row could supply one — in that case every money column is
   * null too, rather than silently pricing the trade in raw points.
   */
  point_value: number | null;
  tick_size: number | null;
  /** Where `point_value` came from. `missing` means the money columns are null. */
  point_value_source: "snapshot" | "instrument" | "missing";
  /**
   * Valuta u kojoj je instrument kotiran, i valuta naloga uz nju.
   *
   * Bruto nastaje u prvoj, prikazuje se u drugoj. Kad se razlikuju, novac je
   * prošao kroz `fx_rate` — ili je null ako kurs nije bio poznat.
   */
  quote_currency: string | null;
  account_currency: string | null;
  /** Kurs kotacija → nalog, kojim je ovaj trejd zaista vrednovan. */
  fx_rate: number | null;
  /**
   * Odakle kurs. `missing` i `no_account` znače da su novčane kolone null —
   * isto pravilo kao `point_value_source`, i isti razlog: bolje ništa nego
   * jen sabran sa dolarom.
   */
  fx_rate_source: "snapshot" | "same_currency" | "no_account" | "missing";
  /**
   * Da li je bruto UPISAN umesto izračunat iz cena.
   *
   * `true` znači da broj dolazi sa brokerovog izvoda i da ga ni ugovorna
   * specifikacija ni kurs nisu dodirnuli. R je i tada računat iz cena.
   */
  money_overridden: boolean | null;
};

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
